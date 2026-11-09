import {
  observeOperation,
  emitJobEvent,
  SpanStatusCode,
  captureSubmission,
  submissionLinks,
  ROOT_CONTEXT,
  type Context,
} from '../obsrv/telemetry'
import { z } from 'zod'
import { Job, JobStatus, JobType, type JobRef, type JobTypeRef } from './job'

export interface JobHandler<Parameters extends z.ZodType = z.ZodType> {
  parameters: Parameters
  canHandle(parameters: z.output<Parameters>): boolean | Promise<boolean>
  handle(job: Job, parameters: z.output<Parameters>, signal: AbortSignal): Promise<void>
}

export class DuplicateJobHandlerError extends Error {}

export class JobManager {
  private static handlers = new Map<JobTypeRef, JobHandler>()
  private static admissions = new Map<JobRef, Promise<boolean>>()
  private static active = new Map<
    JobRef,
    { controller: AbortController; completion: Promise<void> }
  >()
  private static worker: ReturnType<typeof setInterval> | null = null
  private static abortWatcher: ReturnType<typeof setInterval> | null = null
  private static workerIntervalMilliseconds: number | null = null
  private static accepting = true

  static registerHandler<Parameters extends z.ZodType>(
    type: JobTypeRef,
    handler: JobHandler<Parameters>
  ): void {
    const existing = this.handlers.get(type)
    if (existing === handler) return
    if (existing) throw new DuplicateJobHandlerError(`Job type ${type} already has a handler`)
    this.handlers.set(type, handler)
  }

  static unregisterHandler(type: JobTypeRef): void {
    this.handlers.delete(type)
  }

  static async create(
    type: JobTypeRef,
    parameters: Record<string, unknown>,
    timeoutSeconds?: number,
    parent?: Context
  ): Promise<Job> {
    return observeOperation(
      'job.submit',
      async (active, span) => {
        const jobType = await JobType.get(type)
        const handler = this.handlers.get(type)
        const normalized = handler ? handler.parameters.parse(parameters) : parameters
        const timeout = timeoutSeconds ?? jobType.default_timeout_seconds
        if (!Number.isInteger(timeout) || timeout <= 0) {
          throw new TypeError('Job timeout must be a positive number of seconds')
        }
        const result = await Job.dbApi
          .insert({
            type,
            parameters: normalized,
            timeout_seconds: timeout,
            state: {},
            ...captureSubmission(active),
          })
          .select()
          .single()
        const job = Job.parse(result.data)
        span?.setAttribute('inkcre.job.id', job.id)
        emitJobEvent('job.submitted', job.id, active)
        return job
      },
      {},
      parent
    )
  }

  private static async prepare(job: Job): Promise<[JobHandler, unknown] | null> {
    const handler = this.handlers.get(job.type)
    if (!handler) return null
    const parameters = handler.parameters.parse(job.parameters)
    return (await handler.canHandle(parameters)) ? [handler, parameters] : null
  }

  private static async claim(job: Job): Promise<Job | null> {
    const result = await Job.dbApi
      .update({ status: JobStatus.RUNNING })
      .eq('id', job.id)
      .eq('status', JobStatus.PENDING)
      .select()
      .maybeSingle()
    return result.data ? Job.parse(result.data) : null
  }

  private static async close(job: Job, status: string): Promise<boolean> {
    const result = await Job.dbApi
      .update({ status, state: job.state })
      .eq('id', job.id)
      .eq('status', JobStatus.RUNNING)
      .select('id')
    const closed = (result.data?.length ?? 0) > 0
    if (closed) job.status = status as Job['status']
    return closed
  }

  static run(id: JobRef): Promise<boolean> {
    if (!this.accepting || this.admissions.has(id)) return Promise.resolve(false)
    const completion = this.runAdmitted(id).finally(() => this.admissions.delete(id))
    this.admissions.set(id, completion)
    return completion
  }

  private static async runAdmitted(id: JobRef): Promise<boolean> {
    const candidate = await Job.get(id)
    if (!this.accepting || candidate.status !== JobStatus.PENDING) return false
    if (candidate.abort_requested) {
      const claimed = await this.claim(candidate)
      if (!claimed) return false
      await this.observeExecution(claimed, () => this.close(claimed, JobStatus.ABORTED))
      return true
    }
    let prepared: [JobHandler, unknown] | null
    try {
      prepared = await this.prepare(candidate)
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error
      if (!this.accepting) return false
      const claimed = await this.claim(candidate)
      if (!claimed) return false
      if (!this.accepting || claimed.abort_requested) {
        await this.observeExecution(claimed, () => this.close(claimed, JobStatus.ABORTED))
        return true
      }
      console.error('Persisted Job parameters are invalid', id, error)
      claimed.state = { ...claimed.state, error: error.message }
      await this.observeExecution(claimed, () => this.close(claimed, JobStatus.FAILED))
      return true
    }
    if (!this.accepting || !prepared) return false
    const claimed = await this.claim(candidate)
    if (!claimed) return false
    // stopWorker may have run while claim was in flight. Do not start a handler
    // after its Extension resources have been disposed.
    if (!this.accepting || claimed.abort_requested) {
      await this.observeExecution(claimed, () => this.close(claimed, JobStatus.ABORTED))
      return true
    }

    const [handler, parameters] = prepared
    const controller = new AbortController()
    const completion = this.observeExecution(claimed, () =>
      this.execute(claimed, handler, parameters, controller)
    )
    this.active.set(id, { controller, completion })
    try {
      await completion
    } finally {
      this.active.delete(id)
    }
    return true
  }

  private static async observeExecution(
    claimed: Job,
    execute: () => Promise<unknown>
  ): Promise<void> {
    await observeOperation(
      'job.execute',
      async (active, span, result) => {
        emitJobEvent('job.started', claimed.id, active)
        await execute()
        switch (claimed.status) {
          case JobStatus.FINISHED:
            result.outcome = 'success'
            break
          case JobStatus.ABORTED:
            result.outcome = 'cancelled'
            break
          case JobStatus.TIMED_OUT:
            result.outcome = 'timeout'
            break
          default:
            result.outcome = 'error'
        }
        span?.setAttribute('inkcre.job.status', claimed.status)
        if (claimed.status === JobStatus.FAILED || claimed.status === JobStatus.TIMED_OUT)
          span?.setStatus({ code: SpanStatusCode.ERROR })
        if (claimed.isTerminal) emitJobEvent('job.closed', claimed.id, active, claimed.status)
      },
      { ...submissionLinks(claimed), attributes: { 'inkcre.job.id': claimed.id } },
      ROOT_CONTEXT
    )
  }

  private static async execute(
    claimed: Job,
    handler: JobHandler,
    parameters: unknown,
    controller: AbortController
  ): Promise<void> {
    const timeout = setTimeout(
      () => controller.abort(JobStatus.TIMED_OUT),
      claimed.timeout_seconds * 1000
    )
    try {
      // An abort signal is only a request. Await actual handler settlement;
      // Promise.race would report closure while side effects were still running.
      await handler.handle(claimed, parameters, controller.signal)
      await this.close(
        claimed,
        controller.signal.aborted ? String(controller.signal.reason) : JobStatus.FINISHED
      )
    } catch (error) {
      claimed.state = {
        ...claimed.state,
        error: error instanceof Error ? error.message : String(error),
      }
      await this.close(
        claimed,
        controller.signal.aborted ? String(controller.signal.reason) : JobStatus.FAILED
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  static async checkAbortRequests(): Promise<void> {
    const active = new Map(this.active)
    if (active.size === 0) return
    const result = await Job.dbApi
      .from()
      .select('id')
      .in('id', [...active.keys()])
      .eq('abort_requested', true)
    for (const job of result.data ?? []) {
      active.get(job.id)?.controller.abort(JobStatus.ABORTED)
    }
  }

  static async check(): Promise<void> {
    if (!this.accepting) return
    const pending = await Job.getAll({ status: JobStatus.PENDING, limit: 100 })
    for (const job of pending) {
      if (this.active.has(job.id) || !this.handlers.has(job.type)) continue
      void this.run(job.id).catch((error: unknown) => console.error('Job worker failed', error))
    }
  }

  static startWorker(intervalMilliseconds = 30_000): void {
    if (this.worker && this.workerIntervalMilliseconds === intervalMilliseconds) return
    if (this.worker) clearInterval(this.worker)
    this.workerIntervalMilliseconds = intervalMilliseconds
    this.accepting = true
    const scan = () => {
      void this.check().catch((error: unknown) => console.error('Job scan failed', error))
    }
    scan()
    this.worker = setInterval(scan, intervalMilliseconds)
    if (this.abortWatcher !== null) return
    this.abortWatcher = setInterval(() => {
      void this.checkAbortRequests().catch((error: unknown) =>
        console.error('Job abort observation failed', error)
      )
    }, 2000)
  }

  static async stopWorker(): Promise<void> {
    this.accepting = false
    if (this.worker) clearInterval(this.worker)
    if (this.abortWatcher) clearInterval(this.abortWatcher)
    this.worker = null
    this.workerIntervalMilliseconds = null
    this.abortWatcher = null
    const active = [...this.active.values()]
    for (const execution of active) execution.controller.abort(JobStatus.ABORTED)
    // Admission can still be reading or claiming a Job; drain it before changing its connection.
    await Promise.allSettled(this.admissions.values())
  }
}
