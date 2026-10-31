import { z } from 'zod'
import type { MaterialRead } from '@inkcre/web-collection'
import { PageCaptureSchema } from './capture'
import {
  ConnectionSchema,
  SettingsSchema,
  type CollectionSettings,
  type Connection,
  type OutboxItem,
} from './store'
import type { ImportRun } from './imports'

export type CollectionStatus = {
  config: CollectionSettings
  connections: Omit<Connection, 'secret'>[]
  peerErrors: Record<string, string>
  items: Omit<OutboxItem, 'command'>[]
  imports: (Omit<ImportRun, 'remaining' | 'failures'> & {
    remainingCount: number
    failuresCount: number
    failures: ImportRun['failures']
    sample: ImportRun['remaining']
    origins: string[]
  })[]
  migrationWarning: string
  legacyWarning: string
  legacyTasks: { id: string; state: string; text: string; url: string }[]
  tabErrors: Record<string, string>
}

function command<Schema extends z.ZodType, Result>(
  sender: 'content' | 'page',
  request: Schema,
  result: Result
) {
  return { sender, request, result }
}
// Result witnesses are type-only values. The handler map checks every actual response.
const result = <T>() => undefined as T
const empty = z.object({})
export const collectionCommands = {
  'collection-observe': command(
    'content',
    z.object({ capture: PageCaptureSchema }),
    result<string | false>()
  ),
  'collection-auto-allowed': command('content', empty, result<{ allowed: boolean }>()),
  'collection-observation-error': command(
    'content',
    z.object({ error: z.string().max(1000) }),
    result<void>()
  ),
  'collection-status': command('page', empty, result<CollectionStatus>()),
  'collection-wake': command('page', empty, result<void>()),
  'collection-connect': command(
    'page',
    z.object({
      connectionId: z.uuid().optional(),
      connection: ConnectionSchema.omit({ id: true, peerId: true }),
    }),
    result<string>()
  ),
  'collection-check-connection': command(
    'page',
    z.object({ connectionId: z.uuid() }),
    result<void>()
  ),
  'collection-settings': command('page', z.object({ settings: SettingsSchema }), result<void>()),
  'collection-enable-origin': command('page', z.object({ origin: z.string() }), result<void>()),
  'collection-read': command(
    'page',
    z.object({ connectionId: z.uuid(), blockId: z.number().int() }),
    result<MaterialRead>()
  ),
  'collection-retry': command('page', z.object({ id: z.uuid() }), result<void>()),
  'collection-folders': command('page', empty, result<{ label: string; value: string }[]>()),
  'collection-preview-import': command(
    'page',
    z.object({
      options: z.object({
        kind: z.enum(['bookmarks', 'history']),
        folder: z.string(),
        since: z.number().nonnegative(),
        until: z.number(),
        site: z.string(),
        minVisits: z.number().nonnegative(),
        fetchContent: z.boolean(),
      }),
    }),
    result<ImportRun>()
  ),
  'collection-control-import': command(
    'page',
    z.object({ id: z.uuid(), action: z.enum(['start', 'pause', 'resume', 'retry']) }),
    result<void>()
  ),
  'collection-save-draft': command(
    'page',
    z.object({
      draft: z.object({
        text: z.string().min(1),
        url: z.string(),
        title: z.string(),
        captured_at: z.string(),
        method: z.enum(['selected-text', 'legacy-note-recovery']).optional(),
      }),
      note: z.string().max(1_048_576).default(''),
    }),
    result<string>()
  ),
  'collection-save': command(
    'page',
    z.object({
      tabId: z.number().int().positive().optional(),
      expectedURL: z.string().optional(),
      kind: z.enum(['page', 'selection', 'pdf', 'link']),
      note: z.string().max(1_048_576).default(''),
    }),
    result<string>()
  ),
} as const

export type CollectionCommand = keyof typeof collectionCommands
export type CommandRequest<K extends CollectionCommand> = (z.input<
  (typeof collectionCommands)[K]['request']
> extends Record<string, never>
  ? {}
  : z.input<(typeof collectionCommands)[K]['request']>) & { type: K }
export type CommandResult<K extends CollectionCommand> = (typeof collectionCommands)[K]['result']
export type CommandHandlers<Sender> = {
  [K in CollectionCommand]: (
    message: z.output<(typeof collectionCommands)[K]['request']>,
    sender: Sender
  ) => Promise<CommandResult<K>>
}
export function isCollectionCommand(value: unknown): value is { type: CollectionCommand } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    Object.hasOwn(collectionCommands, value.type)
  )
}
