/**
 * Info-Base Resolver System
 *
 * Resolvers provide a unified interface for block content display.
 * Each block specifies its resolver via the `resolver` field.
 * Resolvers can be extended through extensions (Module Federation).
 *
 * Architecture:
 * - Resolver instances are created per-block with optional relations
 * - Each resolver has explicit preview and solved-content presentation contracts
 * - Resolver stores resolver classes statically and provides factory methods
 * - This implementation integrates with Block, Relation, and Storage models
 */

import { ref, type Component, type Ref } from 'vue'
import type { Block } from '../block'
import type { Relation } from '../relation'
import type { LexicalRetrievalMatch } from '../../lexical-retrieval/main'
import {
  DuplicateResolverRegistrationError,
  type ProjectionOptions,
  UnknownResolverError,
} from './contracts'

// ============================================================================
// Resolver Content State
// ============================================================================

/**
 * State of resolver content fetching.
 * Used by UI wrappers to show loading/error states.
 */
export interface ResolverContentState {
  status: 'idle' | 'loading' | 'success' | 'error'
  error: Error | null
}

/** A reading destination; the original retrieval match remains the evidence. */
export interface RecallTarget {
  block: Block
  label: string
  description: string
  excerpt: string
}

// ============================================================================
// Content Component Props
// ============================================================================

/**
 * Props passed to presentation-neutral solved-content renderers.
 * Components receive the resolver instance and pre-resolved content.
 */
export interface SolvedContentRendererProps<
  SolvedContentT = any,
  ResolverT extends Resolver<any, SolvedContentT> = Resolver<any, SolvedContentT>,
> {
  /** The resolver instance (provides access to block and relations) */
  resolver: ResolverT
  solvedContent: SolvedContentT
}

// ============================================================================
// Resolver Base Class (with DB Integration)
// ============================================================================

export interface ResolverClass {
  new (block: Block, relations?: Relation[]): Resolver
  readonly type: string
  previewRenderer: Component
  solvedContentRenderer: Component
}

/**
 * Base class for resolver implementations with Block, Relation, and Storage integration.
 * Provides common functionality: lazy-loading, caching, state management, and DB access.
 *
 * This class merges the protocol-level BaseResolver with info-base-specific DB integration.
 *
 * Subclasses must:
 * - Set static `type`, `previewRenderer`, and `solvedContentRenderer`
 * - Override `_getSolvedContent()` for content transformation
 *
 * @template RawContentT - The type of raw content from storage
 * @template SolvedContentT - The type of content after processing
 */
export abstract class Resolver<RawContentT = unknown, SolvedContentT = RawContentT> {
  /** Resolver type identifier */
  static readonly type: string

  /** Vue component for rendering - settable by applications */
  static solvedContentRenderer: Component

  /** Interaction-free bounded renderer for InfoBase view previews. */
  static previewRenderer: Component

  private static resolverClasses: Map<string, ResolverClass> = new Map()
  static register(type: string, resolverClass: ResolverClass): void {
    if (resolverClass.type !== type) {
      throw new TypeError(
        `Resolver class ${resolverClass.name} declares ${resolverClass.type}, not ${type}.`
      )
    }
    if (!resolverClass.previewRenderer || !resolverClass.solvedContentRenderer) {
      throw new TypeError(
        `Resolver class ${resolverClass.name} must declare previewRenderer and solvedContentRenderer.`
      )
    }
    const existing = this.resolverClasses.get(type)
    if (existing === resolverClass) return
    if (existing) {
      throw new DuplicateResolverRegistrationError(type, existing.name, resolverClass.name)
    }
    this.resolverClasses.set(type, resolverClass)
  }

  /** Release only the exact class registered by this native module. */
  static unregister(type: string, resolverClass: ResolverClass): boolean {
    if (this.resolverClasses.get(type) !== resolverClass) return false
    this.resolverClasses.delete(type)
    return true
  }

  static getClass(type: string): ResolverClass {
    const resolverClass = this.resolverClasses.get(type)
    if (!resolverClass) throw new UnknownResolverError(type)
    return resolverClass
  }

  static matchMediaType(mediaType: string | null | undefined): string | null {
    if (mediaType == null) return null
    const normalized = mediaType.split(';', 1)[0]!.trim().toLowerCase()
    if (
      !normalized ||
      ['application/octet-stream', 'binary/octet-stream', 'application/binary'].includes(normalized)
    ) {
      return null
    }

    const exact: Record<string, string> = {
      'text/plain': 'core.text.v1',
      'text/markdown': 'core.markdown.v1',
      'text/html': 'core.html.v1',
      'application/xhtml+xml': 'core.html.v1',
      'application/pdf': 'core.pdf.v1',
      'application/epub+zip': 'core.epub.v1',
      'application/zip': 'core.zip.v1',
      'application/x-zip-compressed': 'core.zip.v1',
    }
    const family: Record<string, string> = {
      image: 'core.image.v1',
      audio: 'core.audio.v1',
      video: 'core.video.v1',
    }
    const resolverId = exact[normalized] ?? family[normalized.split('/', 1)[0]!]
    return resolverId && this.resolverClasses.has(resolverId) ? resolverId : null
  }

  readonly block: Block
  protected _relations: Relation[] | null

  readonly solvedContentState: Ref<ResolverContentState> = ref({
    status: 'idle',
    error: null,
  })
  declare protected _solvedContent: SolvedContentT
  private _hasSolvedContent = false
  private disposed = false
  private pendingContent: {
    options: Required<ProjectionOptions>
    promise: Promise<SolvedContentT>
  } | null = null

  /**
   * Create a resolver instance for a block.
   * @param block - The block to resolve
   * @param relations - Optional pre-loaded relations (lazy-loads if not provided)
   */
  constructor(block: Block, relations?: Relation[]) {
    this.block = block as Block
    this._relations = relations ?? null // null means not loaded yet
  }

  /**
   * Get relations for this block (lazy-loaded from database).
   * @param options.refresh - Reload relations from database
   * @param options.includeIn - Include relations where block is to_ (incoming relations)
   * @param options.includeOut - Include relations where block is from_ (outgoing relations)
   */
  async getRelations(
    options: { refresh?: boolean; includeIn?: boolean; includeOut?: boolean } = {}
  ): Promise<Relation[]> {
    const { refresh = false, includeIn = true, includeOut = true } = options

    if (this._relations === null || refresh) {
      // Dynamic import to avoid circular dependency
      const { Relation } = await import('../relation')
      this._relations = (await Relation.getByBlock(this.block.id)) as Relation[]
    }

    // Filter by direction if needed
    if (!includeIn || !includeOut) {
      return this._relations!.filter((rel) => {
        const isIncoming = rel.to_ === this.block.id
        const isOutgoing = rel.from_ === this.block.id
        if (includeIn && isIncoming) return true
        if (includeOut && isOutgoing) return true
        return false
      })
    }

    return this._relations as Relation[]
  }

  /**
   * Get raw content (lazy-loaded).
   * Fetches from Storage if block.storage is set, otherwise returns block.content.
   */
  async getRawContent(options: Pick<ProjectionOptions, 'refresh'> = {}): Promise<RawContentT> {
    return this.block.getHydratedContent(options) as Promise<RawContentT>
  }

  /**
   * Read the local solved snapshot. Matching concurrent requests share a load;
   * different options run in order without widening materialization permission.
   * A disposed resolver cannot be read again.
   */
  async getSolvedContent(options: ProjectionOptions = {}): Promise<SolvedContentT> {
    this.ensureNotDisposed()
    const requested = {
      context: options.context ?? 'default',
      refresh: options.refresh ?? false,
      materializeMissing: options.materializeMissing ?? false,
    }
    const pending = this.pendingContent
    if (
      pending &&
      pending.options.context === requested.context &&
      pending.options.refresh === requested.refresh &&
      pending.options.materializeMissing === requested.materializeMissing
    ) {
      return pending.promise
    }
    if (!pending && this._hasSolvedContent && !requested.refresh) {
      return this._solvedContent
    }

    const promise = this.loadSolvedContent(requested, pending?.promise).finally(() => {
      if (this.pendingContent?.promise === promise) this.pendingContent = null
    })
    this.pendingContent = { options: requested, promise }
    return promise
  }

  private async loadSolvedContent(
    options: ProjectionOptions,
    previous?: Promise<SolvedContentT>
  ): Promise<SolvedContentT> {
    if (previous) {
      // A failed read must not cancel a separately requested refresh or derivation.
      await previous.catch(() => undefined)
    }
    this.ensureNotDisposed()
    try {
      this.solvedContentState.value.status = 'loading'
      this.solvedContentState.value.error = null
      const content = await this._getSolvedContent(options)
      this.ensureNotDisposed()
      this._solvedContent = content
      this._hasSolvedContent = true
      this.solvedContentState.value.status = 'success'
      return this._solvedContent
    } catch (error) {
      if (!this.disposed) {
        this.solvedContentState.value.status = 'error'
        this.solvedContentState.value.error =
          error instanceof Error ? error : new Error(String(error))
      }
      throw error
    }
  }

  /**
   * Transform raw content into solved content.
   * Override in subclasses to implement specific logic.
   */
  protected _getSolvedContent(options: ProjectionOptions): Promise<SolvedContentT> {
    return this.getRawContent(options) as unknown as Promise<SolvedContentT>
  }

  abstract getText(options?: ProjectionOptions): Promise<string | null>

  /** Return null when this match has no unambiguous contextual reading destination. */
  async getRecallTarget(_match: LexicalRetrievalMatch): Promise<RecallTarget | null> {
    return null
  }

  /**
   * Permanently release this instance. Pending I/O may finish, but cannot publish
   * a solved snapshot. Overrides must also call super.dispose().
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this._hasSolvedContent = false
    this.solvedContentState.value = { status: 'idle', error: null }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) throw new Error('Resolver is disposed.')
  }
}
