import { Block, Relation, Resolver, ResolverCache, TextResolver } from '@inkcre/core'
import { collectionMessage } from '../../apps/client-webext/logic/collection/messages'
import type { CommandHandlers } from '../../apps/client-webext/logic/collection/commands'

// Historical extension constructors remain assignable to the registration contract.
class LegacyConstructor extends TextResolver {
  constructor(block: Block, relations?: Relation[]) {
    super(block, relations)
  }
}
Resolver.register(LegacyConstructor.type, LegacyConstructor)
const block = Block.parse({ id: 1, resolver: 'core.text.v1', content: '', storage: null })
const reader = await ResolverCache.borrow(block)
await reader.getText()
// @ts-expect-error A borrowed instance cannot be destroyed by a view.
await reader.dispose()
new TextResolver(block, { complete: true, relations: [] })
Resolver.createOwned(block, { complete: true, relations: [] })

const material = await collectionMessage({
  type: 'collection-read',
  connectionId: 'id',
  blockId: 1,
})
material.parts.map((part) => part.base64)
// @ts-expect-error Return types belong to the selected command, not the caller's assertion.
void material.anyInventedField
// @ts-expect-error An omitted command field is a local type error.
void collectionMessage({ type: 'collection-read', blockId: 1 })
// @ts-expect-error Payload types follow the background's schema.
void collectionMessage({ type: 'collection-read', connectionId: 'id', blockId: '1' })
// @ts-expect-error A newly declared command needs an implementation.
const missingHandlers: CommandHandlers<unknown> = {}
void missingHandlers
