/**
 * Browser-extension-owned configuration and storage.
 */

import { AIConfigSchema, configStore, createWebextAdapter } from '@inkcre/core'
import { storage } from '@wxt-dev/storage'
import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

const defaultAIConfig = AIConfigSchema.parse({})
export const DEFAULT_LLM_PROVIDERS = defaultAIConfig.llmProviders
export const DEFAULT_EXPLAIN_INSTRUCTION = defaultAIConfig.explainInstruction

const metaAdapter = createWebextAdapter({
  getItem: (key) => storage.getItem(`local:${key}`),
  setItem: (key, value) => storage.setItem(`local:${key}`, value),
})

export async function initializeExtensionConfig(): Promise<void> {
  await configStore.initializeMeta(metaAdapter)
  await configStore.loadPeerConfig()
}

// Re-export the schema-owned types while keeping persistence extension-local.
export type { ProviderType, LLMProviderConfig } from '@inkcre/core'

// Default English stopwords list (loaded from JSON)
import stopwordsList from './stopwords.json'

export const DEFAULT_STOPWORDS: string[] = stopwordsList

/**
 * Stopwords storage (extension-specific, not in core).
 * Used for text processing and content extraction.
 */
export const { data: stopwords, dataReady: stopwordsReady } = useWebExtensionStorage(
  'stopwords',
  DEFAULT_STOPWORDS
)

export { inkcreApi, apiConnectionsReady as inkcreApiReady } from './api-connections'

/**
 * LLM provider credentials and model lists.
 */
export const { data: llmProviders, dataReady: llmProvidersReady } = useWebExtensionStorage(
  'llmProviders',
  DEFAULT_LLM_PROVIDERS
)

/**
 * Default model selection.
 */
export const { data: defaultModel, dataReady: defaultModelReady } = useWebExtensionStorage(
  'defaultModel',
  'openai-default:gpt-4o-mini'
)

/**
 * Explain instruction.
 */
export const { data: explainInstruction, dataReady: explainInstructionReady } =
  useWebExtensionStorage('explainInstruction', DEFAULT_EXPLAIN_INSTRUCTION)
