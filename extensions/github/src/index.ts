import { Resolver, type ExtensionModule } from '@inkcre/core'
import { AccountResolver, RepositoryResolver, ListResolver } from './resolver'

const resolvers = [AccountResolver, RepositoryResolver, ListResolver]
const extension: ExtensionModule = {
  async initialize() {
    for (const resolver of resolvers) Resolver.register(resolver.type, resolver)
  },
  async activate() {},
  async deactivate() {},
  async dispose() {
    // The Host also disposes after a partially failed initialize.
    for (const resolver of resolvers) Resolver.unregister(resolver.type, resolver)
  },
}
export default extension
