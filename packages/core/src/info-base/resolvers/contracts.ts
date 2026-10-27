export const CORE_RESOLVER_IDS = [
  'core.text.v1',
  'core.markdown.v1',
  'core.html.v1',
  'core.image.v1',
  'core.audio.v1',
  'core.video.v1',
  'core.pdf.v1',
  'core.epub.v1',
  'core.zip.v1',
  'core.file.v1',
] as const

export type CoreResolverId = (typeof CORE_RESOLVER_IDS)[number]

export type TextProjectionContext = 'default' | 'lexical'

export type ProjectionOptions = {
  context?: TextProjectionContext
  refresh?: boolean
  materializeMissing?: boolean
}

export class ResolverContractError extends Error {}

export class ResolverContentError extends ResolverContractError {
  constructor(
    readonly resolverId: string,
    readonly reason: string
  ) {
    super(`Resolver ${resolverId} rejected content: ${reason}.`)
    this.name = 'ResolverContentError'
  }
}

export class UnknownResolverError extends ResolverContractError {
  constructor(readonly resolverId: string) {
    super(`Unknown resolver ID: ${resolverId}`)
    this.name = 'UnknownResolverError'
  }
}

export class DuplicateResolverRegistrationError extends ResolverContractError {
  constructor(
    readonly resolverId: string,
    readonly existing: string,
    readonly attempted: string
  ) {
    super(
      `Resolver ID ${resolverId} is already registered by ${existing}; cannot register ${attempted}.`
    )
    this.name = 'DuplicateResolverRegistrationError'
  }
}

export class UnsupportedResolverCapability extends ResolverContractError {
  constructor(
    readonly resolverId: string,
    readonly capability: string
  ) {
    super(`Resolver ${resolverId} does not support ${capability}.`)
    this.name = 'UnsupportedResolverCapability'
  }
}
