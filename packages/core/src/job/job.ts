import { z } from 'zod'
import { Z } from 'zod-class'
import { APIError, DBAPIClient } from '../base/db-api'

export const JobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  FINISHED: 'finished',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  ABORTED: 'aborted',
} as const
export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus]

export type JobRef = number
export const JobRefSchema = z.number().int()
export type JobTypeRef = string

const JsonObjectSchema = z.record(z.string(), z.unknown())

export class JobType extends Z.class({
  id: z.string(),
  description: z.string(),
  parameters_schema: JsonObjectSchema,
  default_timeout_seconds: z.number().int().positive(),
}) {
  static dbApi = new DBAPIClient<'job_types', JobType>('job_types', JobType)

  static async get(id: JobTypeRef): Promise<JobType> {
    return JobType.parse((await this.dbApi.from().select().eq('id', id).single()).data)
  }

  static async getAll(): Promise<JobType[]> {
    return ((await this.dbApi.from().select().throwOnError()).data ?? []).map((item) =>
      JobType.parse(item)
    )
  }
}

export class Job extends Z.class({
  id: JobRefSchema,
  type: z.string(),
  parameters: JsonObjectSchema,
  state: JsonObjectSchema.default(() => ({})),
  abort_requested: z.boolean(),
  timeout_seconds: z.number().int().positive(),
  status: z.enum([
    JobStatus.PENDING,
    JobStatus.RUNNING,
    JobStatus.FINISHED,
    JobStatus.FAILED,
    JobStatus.TIMED_OUT,
    JobStatus.ABORTED,
  ]),
  submission_traceparent: z.string().nullable().default(null),
  submission_tracestate: z.string().nullable().default(null),
  created_at: z.coerce.date(),
  started_at: z.coerce.date().nullable(),
  closed_at: z.coerce.date().nullable(),
}) {
  static dbApi = new DBAPIClient<'jobs', Job>('jobs', Job)

  static async get(id: JobRef): Promise<Job> {
    const { data } = await this.dbApi.from().select().eq('id', id).maybeSingle().throwOnError()
    if (!data) throw new APIError(`Job #${id} was not found.`, 404)
    return Job.parse(data)
  }

  static async getAll(
    options: { limit?: number; status?: JobStatusValue | JobStatusValue[]; type?: JobTypeRef } = {}
  ): Promise<Job[]> {
    let query = this.dbApi
      .from()
      .select()
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(options.limit ?? 20)
    if (options.type) query = query.eq('type', options.type)
    if (typeof options.status === 'string') query = query.eq('status', options.status)
    if (Array.isArray(options.status)) query = query.in('status', options.status)
    return ((await query.throwOnError()).data ?? []).map((item) => Job.parse(item))
  }

  static async getBySource(source: number, limit = 20): Promise<Job[]> {
    const result = await this.dbApi
      .from()
      .select()
      .contains('parameters', { source })
      .order('created_at', { ascending: false })
      .limit(limit)
      .throwOnError()
    return (result.data ?? []).map((item) => Job.parse(item))
  }

  static isTerminal(status: string): boolean {
    const terminal: readonly string[] = [
      JobStatus.FINISHED,
      JobStatus.FAILED,
      JobStatus.TIMED_OUT,
      JobStatus.ABORTED,
    ]
    return terminal.includes(status)
  }

  get isTerminal(): boolean {
    return Job.isTerminal(this.status)
  }
}
