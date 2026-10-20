import { Resolver, type ExtensionModule } from '@inkcre/core'
import CalDAVSetup from './CalDAVSetup.vue'
import { CalendarResolver, CollectionResolver, ContactResolver } from './resolver'

const resolvers = [CalendarResolver, CollectionResolver, ContactResolver]
const extension: ExtensionModule = {
  setup: { component: CalDAVSetup },
  async initialize() {
    for (const resolver of resolvers) Resolver.register(resolver.type, resolver)
  },
  async dispose() {
    for (const resolver of resolvers) Resolver.unregister(resolver.type, resolver)
  },
}
export default extension
