import { z } from 'zod'

export const BROWSER_AUTOMATION_PROTOCOL = 'inkcre.browser.v1'
export const BROWSER_AUTOMATION_PORT = 'inkcre-browser-v1'

export const BrowserProviderBindingSchema = z.object({
  provider: z.uuid(),
  instance: z.uuid(),
  name: z.string(),
  extensionVersion: z.string(),
  protocol: z.literal(1),
})
export type BrowserProviderBinding = z.infer<typeof BrowserProviderBindingSchema>

export const BrowserTabRefSchema = z.object({
  provider: z.uuid(),
  instance: z.uuid(),
  epoch: z.uuid(),
  reference: z.uuid(),
  tabId: z.number().int().nonnegative(),
  title: z.string().optional(),
  url: z.string().optional(),
})
export type BrowserTabRef = z.infer<typeof BrowserTabRefSchema>

export const BrowserBridgeRequestSchema = z.object({
  protocol: z.literal(BROWSER_AUTOMATION_PROTOCOL),
  kind: z.literal('request'),
  client: z.uuid(),
  request: z.uuid(),
  provider: z.uuid().optional(),
  instance: z.uuid().optional(),
  operation: z.enum(['discover', 'tabs', 'open', 'cdp', 'close']),
  parameters: z.record(z.string(), z.unknown()).default({}),
})
export type BrowserBridgeRequest = z.infer<typeof BrowserBridgeRequestSchema>

export const BrowserBridgeResponseSchema = z.object({
  protocol: z.literal(BROWSER_AUTOMATION_PROTOCOL),
  kind: z.literal('response'),
  client: z.uuid(),
  request: z.uuid(),
  provider: z.uuid(),
  instance: z.uuid(),
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().optional(),
})
export type BrowserBridgeResponse = z.infer<typeof BrowserBridgeResponseSchema>

export const BrowserBridgeEventSchema = z.object({
  protocol: z.literal(BROWSER_AUTOMATION_PROTOCOL),
  kind: z.literal('event'),
  client: z.uuid(),
  provider: z.uuid(),
  instance: z.uuid(),
  session: z.uuid(),
  event: z.enum(['message', 'closed']),
  data: z.string().optional(),
})
export type BrowserBridgeEvent = z.infer<typeof BrowserBridgeEventSchema>
