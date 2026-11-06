import { Source, type Json } from '@inkcre/core'
import { z } from 'zod'
import { extensionName } from './schema.ts'
import type { SourceGraphBatch } from './graph.ts'
import type { Progress } from './progress.ts'

const committedBatch = z.object({
  blocks: z.record(z.string(), z.number().int().positive()),
  state: z.record(z.string(), z.unknown()),
  source_block: z.number().int().positive().nullable(),
})

function json(value: unknown): Json {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('采集批次需要可序列化的 JSON。')
  return z.json().parse(JSON.parse(encoded))
}

export async function commitBatch(source: Source, graph: SourceGraphBatch, progress: Progress) {
  const result = await Source.dbApi
    .rpc('commit_source_batch', {
      source_id: source.id,
      namespace: extensionName,
      expected_config: json(source.config),
      expected_state: json(source.state),
      root_key: `user:${progress.scope.account_mid}`,
      next_state: json({ ...source.state, bilibili: progress }),
      records: json(graph.records),
      relations: json(graph.relations),
    })
    .throwOnError()
  // An ambiguous transport failure is deliberately not retried here.
  const committed = committedBatch.parse(result.data)
  source.state = committed.state
  source.block = committed.source_block
  return committed
}
