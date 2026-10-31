// Base resolver and utilities
export {
  // Main resolver class and helpers
  Resolver,
  // Protocol interfaces
  type ResolverContentState,
  type ResolverReader,
  type CompleteResolverRelations,
  type RecallTarget,
  type SolvedContentRendererProps,
} from './base'

export {
  CORE_RESOLVER_IDS,
  DuplicateResolverRegistrationError,
  ResolverContentError,
  ResolverContractError,
  UnknownResolverError,
  UnsupportedResolverCapability,
  type CoreResolverId,
  type ProjectionOptions,
  type TextProjectionContext,
} from './contracts'

// Cache system
export { ResolverCache } from './cache'

// Concrete resolver implementations
export { TextResolver } from './text'
export { MarkdownResolver } from './markdown'
export { HtmlResolver, type HtmlRawContent } from './html'
export { ImageResolver, type ImageSolvedContent } from './image'
export { AudioResolver, type AudioSolvedContent } from './audio'
export { VideoResolver, type VideoSolvedContent } from './video'
export { PdfResolver, type PdfSolvedContent } from './pdf'
export { EpubResolver, type EpubSolvedContent } from './epub'
export { ZipResolver, type ZipSolvedContent } from './zip'
export { FileResolver, type FileSolvedContent } from './file'
export type {
  ByteSolvedContent,
  ByteContentSource,
  ByteContentOptions,
  ByteContentResource,
} from './actual-content'

import { AudioResolver } from './audio'
import { Resolver } from './base'
import { EpubResolver } from './epub'
import { FileResolver } from './file'
import { HtmlResolver } from './html'
import { ImageResolver } from './image'
import { PdfResolver } from './pdf'
import { TextResolver } from './text'
import { MarkdownResolver } from './markdown'
import { VideoResolver } from './video'
import { ZipResolver } from './zip'

export function registerCoreResolvers(): void {
  for (const resolverClass of [
    TextResolver,
    MarkdownResolver,
    HtmlResolver,
    ImageResolver,
    AudioResolver,
    VideoResolver,
    PdfResolver,
    EpubResolver,
    ZipResolver,
    FileResolver,
  ]) {
    Resolver.register(resolverClass.type, resolverClass)
  }
}
