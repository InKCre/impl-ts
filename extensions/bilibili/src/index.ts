import { z } from 'zod'
import { Resolver, SourceManager, SourceType, type ExtensionModule } from '@inkcre/core'
import { UserResolver, FolderResolver, VideoResolver, MembershipResolver } from './resolver.ts'
import { SourceConfigSchema, CollectConfigSchema, sourceType } from './schema.ts'
import { bilibiliSource } from './source.ts'
import BilibiliSetup from './BilibiliSetup.vue'

const resolvers = [UserResolver, FolderResolver, VideoResolver, MembershipResolver]
const extension: ExtensionModule = {
  setup: { component: BilibiliSetup },
  async initialize() {
    for (const resolver of resolvers) Resolver.register(resolver.type, resolver)
    SourceManager.register(sourceType, bilibiliSource)
    await SourceType.dbApi
      .upsert({
        id: sourceType,
        description: '采集自己的 B 站收藏夹，包括所选私密收藏夹。',
        config_schema: z.toJSONSchema(SourceConfigSchema),
        collect_config_schema: z.toJSONSchema(CollectConfigSchema),
        backfill_config_schema: null,
      })
      .throwOnError()
  },
  async activate() {},
  async deactivate() {},
  async dispose() {
    SourceManager.unregister(sourceType, bilibiliSource)
    for (const resolver of resolvers) Resolver.unregister(resolver.type, resolver)
  },
}
export default extension
