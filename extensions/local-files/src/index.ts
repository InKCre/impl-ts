import { Resolver, type ExtensionModule } from '@inkcre/core'
import { LocalFileResolver, LocalFileV2Resolver } from './resolver'

const resolvers = [LocalFileResolver, LocalFileV2Resolver]
const extension: ExtensionModule = {
  async initialize() {
    for (const resolver of resolvers) Resolver.register(resolver.type, resolver)
  },
  async dispose() {
    for (const resolver of resolvers) Resolver.unregister(resolver.type, resolver)
  },
}
export default extension
