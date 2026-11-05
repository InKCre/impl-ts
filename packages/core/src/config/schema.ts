import { z } from 'zod'

/**
 * LLM Provider types
 */
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible'

/**
 * LLM Provider configuration schema
 */
export const LLMProviderConfigSchema = z.object({
  id: z.string().meta({ title: 'Provider ID' }), // Unique identifier for the provider
  name: z.string().meta({ title: 'Name' }), // Display name (e.g., "My OpenAI")
  type: z
    .enum(['openai', 'anthropic', 'google', 'openai-compatible'])
    .meta({ title: 'Provider type' }),
  apiKey: z.string().meta({ format: 'password', title: 'API key' }),
  baseURL: z.string().optional().meta({ title: 'Base URL' }), // Optional base URL for OpenAI-compatible providers
  models: z.array(z.string()).meta({ title: 'Models' }), // List of available models
})

export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>

/**
 * AI configuration schema (from webext)
 */
export const AIConfigSchema = z.object({
  llmProviders: z.array(LLMProviderConfigSchema).default([]).meta({ title: 'AI providers' }),
  defaultModel: z.string().default('openai-default:gpt-4o-mini').meta({ title: 'Default model' }),
  explainInstruction: z
    .string()
    .default('Explain user given text based on page content in a concise, clear, simple way.')
    .meta({ title: 'Explanation instruction' }),
})

/**
 * Meta configuration schema (bootstrap/runtime)
 * Contains URLs and secrets needed to fetch and initialize app config
 */
const UnconfiguredUrlSchema = z.union([z.literal(''), z.url()])
const GeneratedPeerIdSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.uuid().default(() => crypto.randomUUID())
)

const CurrentMetaConfigSchema = z.object({
  INKCRE_PGREST_URL: UnconfiguredUrlSchema.default(''),
  INKCRE_JWT_SECRET: z.string().default(''),
  INKCRE_PEER_ID: GeneratedPeerIdSchema,
  peer_lease_renew_interval_seconds: z.number().int().min(0).max(86400).default(30),
  peer_readiness_timeout_seconds: z.number().int().min(1).max(300).default(5),
  telemetry_enabled: z.boolean().default(false),
  telemetry_peer_relay_url: z
    .union([
      z.literal(''),
      z.url().refine((value) => {
        const url = new URL(value)
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      }, 'Peer relay URL must be HTTP(S) without credentials, query or fragment'),
    ])
    .default(''),
})

/** Preserve one browser origin's old technical identity during the Peer cutover. */
export const MetaConfigSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const input = value as Record<string, unknown>
  if (input.INKCRE_PEER_ID !== undefined) return input
  const priorIdentity = input.client_id ?? input.INKCRE_CLIENT_ID
  return priorIdentity === undefined ? input : { ...input, INKCRE_PEER_ID: priorIdentity }
}, CurrentMetaConfigSchema)

export type MetaConfig = z.infer<typeof MetaConfigSchema>

/**
 * App configuration schema (runtime)
 * Contains extension registry URL, AI settings, and runtime app configuration
 */
export const PeerConfigSchema = z
  .object({
    // Deployment-owned Peer configuration supplies this URL. Static artifacts
    // deliberately keep the unconfigured state instead of embedding an origin.
    extension_registry_url: UnconfiguredUrlSchema.default('').meta({
      title: 'Extension registry URL',
    }),
    peer_http_timeout_ms: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .meta({ title: 'Peer response timeout (ms)' }),
    ai: AIConfigSchema.default(() => AIConfigSchema.parse({})).meta({ title: 'AI' }),
  })
  .passthrough()

/**
 * Config type
 */
export type PeerConfig = z.infer<typeof PeerConfigSchema>
