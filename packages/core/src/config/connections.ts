import { z } from 'zod'
import { MetaConfigSchema, type MetaConfig } from './schema'

export const SavedConnectionSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  config: MetaConfigSchema,
})
export type SavedConnection = z.infer<typeof SavedConnectionSchema>

export const ConnectionSettingsSchema = z
  .object({
    connections: z.array(SavedConnectionSchema),
    activeConnectionId: z.uuid().nullable(),
  })
  .superRefine((settings, context) => {
    const ids = new Set(settings.connections.map((connection) => connection.id))
    if (
      ids.size !== settings.connections.length ||
      (settings.activeConnectionId !== null && !ids.has(settings.activeConnectionId))
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid connection selection' })
    }
  })
export type ConnectionSettings = z.infer<typeof ConnectionSettingsSchema>

/** Import the previous single-connection format without changing its Peer identity. */
export function readConnectionSettings(input: unknown, current: MetaConfig): ConnectionSettings {
  if (typeof input === 'object' && input !== null && 'connections' in input) {
    return ConnectionSettingsSchema.parse(input)
  }
  if (!current.INKCRE_PGREST_URL || !current.INKCRE_JWT_SECRET) {
    return { connections: [], activeConnectionId: null }
  }
  const id = crypto.randomUUID()
  return {
    activeConnectionId: id,
    connections: [{ id, name: new URL(current.INKCRE_PGREST_URL).host, config: current }],
  }
}
