import { BrowserAccess, type SourceImplementation } from '@inkcre/core'
import { CollectConfigSchema, SourceConfigSchema } from './schema.ts'
import { favoriteGraph } from './graph.ts'
import { startProgress } from './progress.ts'
import { commitBatch } from './repository.ts'
import { FavoriteSession } from './site.ts'
import { collectFavorites } from './collect.ts'

export const bilibiliSource: SourceImplementation<typeof CollectConfigSchema, null> = {
  collectConfig: CollectConfigSchema,
  backfillConfig: null,
  canCollect(source) {
    const config = SourceConfigSchema.safeParse(source.config)
    return config.success && BrowserAccess.hasBinding(config.data.provider)
  },
  async collect(source, _job, options, signal) {
    const config = SourceConfigSchema.parse(source.config)
    await BrowserAccess.withPage(
      { provider: config.provider, target: { kind: 'new' }, signal },
      async (page) => {
        await collectFavorites(
          config,
          startProgress(source.state, config),
          options,
          signal,
          new FavoriteSession(page, config),
          async (account, current, next) => {
            await commitBatch(source, favoriteGraph(account, current), next)
          }
        )
      }
    )
  },
}
