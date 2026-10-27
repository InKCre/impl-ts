import { Resolver, type ExtensionModule } from '@inkcre/core'
import { CaptureResolver, AttachmentResolver } from './resolver'

const resolvers = [CaptureResolver, AttachmentResolver]
const extension: ExtensionModule = {
  async initialize() {
    for (const resolver of resolvers) Resolver.register(resolver.type, resolver)
  },
  async dispose() {
    for (const resolver of resolvers) Resolver.unregister(resolver.type, resolver)
  },
}
export default extension
