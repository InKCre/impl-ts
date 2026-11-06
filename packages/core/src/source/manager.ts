import { z } from 'zod'
import { JobManager, type Job } from '../job'
import { Source } from './source'

export const SOURCE_COLLECT_JOB_TYPE = 'core.source.collect.v1'
export const SOURCE_BACKFILL_JOB_TYPE = 'core.source.backfill.v1'

const SourceCommandParameters = z.object({
  source: z.number().int(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export interface SourceImplementation<
  CollectConfig extends z.ZodType = z.ZodType,
  BackfillConfig extends z.ZodType | null = z.ZodType | null,
> {
  collectConfig: CollectConfig
  backfillConfig: BackfillConfig
  canCollect?(source: Source, config: z.output<CollectConfig>): boolean | Promise<boolean>
  canBackfill?(source: Source, config: unknown): boolean | Promise<boolean>
  collect(
    source: Source,
    job: Job,
    config: z.output<CollectConfig>,
    signal: AbortSignal
  ): Promise<void>
  backfill?: BackfillConfig extends z.ZodType
    ? (
        source: Source,
        job: Job,
        config: z.output<BackfillConfig>,
        signal: AbortSignal
      ) => Promise<void>
    : never
}

export class SourceManager {
  private static implementations = new Map<string, SourceImplementation>()

  static register(type: string, implementation: SourceImplementation): void {
    const existing = this.implementations.get(type)
    if (existing === implementation) return
    if (existing) throw new Error(`Source type ${type} is already registered`)
    this.implementations.set(type, implementation)
  }

  static unregister(type: string, implementation?: SourceImplementation): void {
    if (implementation && this.implementations.get(type) !== implementation) return
    this.implementations.delete(type)
  }

  static async resolve(sourceRef: number): Promise<[Source, SourceImplementation] | null> {
    try {
      const source = await Source.get(sourceRef)
      const implementation = this.implementations.get(source.type)
      return implementation ? [source, implementation] : null
    } catch {
      return null
    }
  }
}

JobManager.registerHandler(SOURCE_COLLECT_JOB_TYPE, {
  parameters: SourceCommandParameters,
  async canHandle(parameters) {
    const resolved = await SourceManager.resolve(parameters.source)
    if (!resolved) return false
    const [source, implementation] = resolved
    const config = implementation.collectConfig.safeParse(parameters.config)
    // Invalid commands must be claimed and fail in handle, rather than remain pending forever.
    if (!config.success) return true
    return implementation.canCollect ? implementation.canCollect(source, config.data) : true
  },
  async handle(job, parameters, signal) {
    const resolved = await SourceManager.resolve(parameters.source)
    if (!resolved) throw new Error('Source implementation is unavailable')
    const [source, implementation] = resolved
    const config = implementation.collectConfig.parse(parameters.config)
    await implementation.collect(source, job, config, signal)
  },
})

JobManager.registerHandler(SOURCE_BACKFILL_JOB_TYPE, {
  parameters: SourceCommandParameters,
  async canHandle(parameters) {
    const resolved = await SourceManager.resolve(parameters.source)
    if (!resolved) return false
    const [source, implementation] = resolved
    if (!implementation.backfillConfig || !implementation.backfill) return false
    const config = implementation.backfillConfig.safeParse(parameters.config)
    if (!config.success) return true
    return implementation.canBackfill ? implementation.canBackfill(source, config.data) : true
  },
  async handle(job, parameters, signal) {
    const resolved = await SourceManager.resolve(parameters.source)
    if (!resolved) {
      throw new Error('Source backfill implementation is unavailable')
    }
    const [source, implementation] = resolved
    const { backfillConfig, backfill } = implementation
    if (!backfillConfig || !backfill) {
      throw new Error('Source backfill implementation is unavailable')
    }
    const config = backfillConfig.parse(parameters.config)
    await backfill(source, job, config, signal)
  },
})
