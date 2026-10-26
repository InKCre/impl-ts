<script setup lang="ts">
import logo from '@/assets/inkcre.svg'
import { type LLMProviderConfig, type ProviderType } from '@inkcre/core'
import { defaultModel, explainInstruction, llmProviders, stopwords } from '@/logic/storage'
import {
  apiConnections,
  apiConnectionsReady,
  apiConnectionIssue,
  saveApiConnection,
  selectApiConnection,
} from '@/logic/api-connections'
import 'uno.css'

const connectionId = ref<string>(crypto.randomUUID())
const connectionName = ref('')
const connectionUrl = ref('')
const connectionBusy = ref(true)
const connectionFeedback = ref('')

function showActiveConnection() {
  const current = apiConnections.value.connections.find(
    (item) => item.id === apiConnections.value.activeId
  )
  connectionId.value = current?.id ?? crypto.randomUUID()
  connectionName.value = current?.name ?? ''
  connectionUrl.value = current?.url ?? ''
}
onMounted(async () => {
  await apiConnectionsReady
  showActiveConnection()
  connectionBusy.value = false
})
watch(apiConnections, showActiveConnection)
function addConnection() {
  connectionId.value = crypto.randomUUID()
  connectionName.value = ''
  connectionUrl.value = ''
  connectionFeedback.value = ''
}
async function applyConnection(id?: string) {
  if (connectionBusy.value) return
  connectionBusy.value = true
  connectionFeedback.value = ''
  try {
    if (id) await selectApiConnection(id)
    else await saveApiConnection(connectionId.value, connectionName.value, connectionUrl.value)
    showActiveConnection()
    connectionFeedback.value = '已切换连接。'
  } catch {
    connectionFeedback.value = '无法保存连接，请检查名称和 HTTP(S) 地址。'
  } finally {
    connectionBusy.value = false
  }
}

// Computed property to handle stopwords array/string conversion
const stopwordsText = computed({
  get: () => (Array.isArray(stopwords.value) ? stopwords.value.join(', ') : ''),
  set: (value: string) => {
    const words = value
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word.length > 0)
    stopwords.value = words
  },
})

const getProviderTypeDisplayName = (type: ProviderType) => {
  const names: Record<ProviderType, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Generative AI',
    'openai-compatible': 'OpenAI Compatible',
  }
  return names[type]
}

const getProviderTypeHelpUrl = (type: ProviderType) => {
  const urls: Record<ProviderType, string> = {
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    google: 'https://aistudio.google.com/app/apikey',
    'openai-compatible': 'https://ai-sdk.dev/providers/openai-compatible-providers',
  }
  return urls[type]
}

// Add a new provider
const addProvider = () => {
  const newProvider: LLMProviderConfig = {
    id: `provider-${Date.now()}`,
    name: 'New Provider',
    type: 'openai',
    apiKey: '',
    models: [],
  }
  llmProviders.value = [...llmProviders.value, newProvider]
}

// Remove a provider
const removeProvider = (index: number) => {
  const providers = [...llmProviders.value]
  providers.splice(index, 1)
  llmProviders.value = providers
}

// Update provider field
const updateProvider = (index: number, field: keyof LLMProviderConfig, value: any) => {
  const providers = [...llmProviders.value]
  ;(providers[index] as any)[field] = value
  llmProviders.value = providers
}

// Update models (from comma-separated string)
const getModelsText = (models: string[]) => {
  return models.join(', ')
}

const setModelsText = (index: number, value: string) => {
  const models = value
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
  updateProvider(index, 'models', models)
}

// Compute available model options for default selection
const availableDefaultModels = computed(() => {
  const models: { value: string; label: string; disabled: boolean }[] = []

  llmProviders.value.forEach((provider) => {
    const hasApiKey = provider.apiKey && provider.apiKey.length > 0
    provider.models.forEach((model) => {
      models.push({
        value: `${provider.id}:${model}`,
        label: `${provider.name} - ${model}`,
        disabled: !hasApiKey,
      })
    })
  })

  return models
})

// Auto-set default model if current default is not valid
onMounted(() => {
  // Check if defaultModel is valid
  if (!defaultModel.value || !defaultModel.value.includes(':')) {
    // Try to find first configured provider
    const firstConfiguredModel = availableDefaultModels.value.find((m) => !m.disabled)
    if (firstConfiguredModel) {
      defaultModel.value = firstConfiguredModel.value
    }
  } else {
    // Check if current default model is still valid
    const [providerId] = defaultModel.value.split(':')
    const provider = llmProviders.value.find((p) => p.id === providerId)
    if (!provider || !provider.apiKey) {
      // Current default is invalid, try to find a configured one
      const firstConfiguredModel = availableDefaultModels.value.find((m) => !m.disabled)
      if (firstConfiguredModel) {
        defaultModel.value = firstConfiguredModel.value
      }
    }
  }
})
</script>

<template>
  <main class="px-4 py-10 text-center text-text">
    <img :src="logo" class="icon-btn mx-2 text-2xl" alt="InKCre Logo" />

    <!-- Extension-owned runtime configuration -->
    <div class="mt-6 p-4 bg-surface-2 rounded-none border border-border">
      <h3 class="text-lg font-semibold mb-2">Runtime configuration</h3>
      <div class="text-left space-y-4">
        <fieldset :disabled="connectionBusy" class="space-y-2">
          <legend class="font-semibold">连接</legend>
          <label for="current-connection">当前连接</label>
          <select
            id="current-connection"
            :value="apiConnections.activeId ?? ''"
            @change="applyConnection(($event.target as HTMLSelectElement).value)"
            class="w-full px-2 py-1 border border-border bg-surface"
          >
            <option v-if="!apiConnections.connections.length" value="" disabled>
              尚未保存连接
            </option>
            <option v-for="item in apiConnections.connections" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
          <button type="button" @click="addConnection" class="px-3 py-1 border border-border">
            添加连接
          </button>
          <label for="connection-name" class="block">连接名称</label>
          <input
            id="connection-name"
            v-model="connectionName"
            class="w-full px-2 py-1 border border-border bg-surface"
          />
          <label for="inkcre-api" class="block">API 地址</label>
          <input
            id="inkcre-api"
            v-model="connectionUrl"
            type="url"
            class="w-full px-2 py-1 border border-border bg-surface"
            placeholder="https://..."
          />
          <button type="button" @click="applyConnection()" class="px-3 py-1 border border-border">
            保存并使用连接
          </button>
          <p v-if="apiConnectionIssue" role="alert">{{ apiConnectionIssue }}</p>
          <p v-if="connectionFeedback" role="status">{{ connectionFeedback }}</p>
        </fieldset>

        <!-- LLM Provider Configuration -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-base">LLM 提供商配置</h4>
            <button
              @click="addProvider"
              class="px-3 py-1 text-sm border border-border rounded-none hover:bg-surface-2"
            >
              + 添加提供商
            </button>
          </div>
          <p class="text-xs text-muted mb-2">
            配置 LLM 提供商的 API Key、Base URL 和可用模型。在 Explain 侧边栏可以选择使用哪个模型。
          </p>

          <div class="space-y-2">
            <label for="default-model" class="font-medium block">默认模型:</label>
            <select
              id="default-model"
              v-model="defaultModel"
              class="w-full px-2 py-1 border border-border rounded-none bg-surface"
            >
              <option
                v-for="model in availableDefaultModels"
                :key="model.value"
                :value="model.value"
                :disabled="model.disabled"
              >
                {{ model.label }}
                {{ model.disabled ? '(未配置 API Key)' : '' }}
              </option>
            </select>
            <p class="text-xs text-muted">在 Explain 侧边栏未手动选择模型时使用此默认模型。</p>
          </div>

          <div
            v-for="(provider, index) in llmProviders"
            :key="provider.id"
            class="border border-border rounded-none p-3 space-y-2 bg-surface"
          >
            <div class="flex items-center justify-between">
              <input
                :value="provider.name"
                @input="(e) => updateProvider(index, 'name', (e.target as HTMLInputElement).value)"
                type="text"
                class="font-medium px-2 py-1 border border-border rounded-none text-sm flex-1 mr-2 bg-surface"
                placeholder="Provider Name"
              />
              <button
                @click="removeProvider(index)"
                class="px-2 py-1 text-xs border border-danger/50 text-danger rounded-none hover:bg-danger/10"
              >
                删除
              </button>
            </div>

            <div class="space-y-2">
              <div>
                <label class="text-sm font-medium block">类型:</label>
                <select
                  :value="provider.type"
                  @change="
                    (e) => updateProvider(index, 'type', (e.target as HTMLSelectElement).value)
                  "
                  class="w-full px-2 py-1 border border-border rounded-none bg-surface text-sm"
                >
                  <option value="openai">
                    {{ getProviderTypeDisplayName('openai') }}
                  </option>
                  <option value="anthropic">
                    {{ getProviderTypeDisplayName('anthropic') }}
                  </option>
                  <option value="google">
                    {{ getProviderTypeDisplayName('google') }}
                  </option>
                  <option value="openai-compatible">
                    {{ getProviderTypeDisplayName('openai-compatible') }}
                  </option>
                </select>
              </div>

              <div>
                <label class="text-sm font-medium block">API Key:</label>
                <input
                  :value="provider.apiKey"
                  @input="
                    (e) => updateProvider(index, 'apiKey', (e.target as HTMLInputElement).value)
                  "
                  type="password"
                  class="w-full px-2 py-1 border border-border rounded-none bg-surface text-sm"
                  placeholder="sk-..."
                />
              </div>

              <div>
                <label class="text-sm font-medium block">
                  Base URL
                  <span v-if="provider.type === 'openai-compatible'" class="text-danger">*</span>
                  <span v-else class="text-muted">(可选)</span>:
                </label>
                <input
                  :value="provider.baseURL || ''"
                  @input="
                    (e) =>
                      updateProvider(
                        index,
                        'baseURL',
                        (e.target as HTMLInputElement).value || undefined
                      )
                  "
                  type="url"
                  class="w-full px-2 py-1 border border-border rounded-none bg-surface text-sm"
                  :class="
                    provider.type === 'openai-compatible' && !provider.baseURL
                      ? 'border-danger'
                      : ''
                  "
                  placeholder="https://api.example.com/v1"
                  :required="provider.type === 'openai-compatible'"
                />
                <p class="text-xs text-muted mt-1">
                  <span v-if="provider.type === 'openai-compatible'">
                    必填：OpenAI Compatible 提供商需要指定 Base URL。例如：OpenRouter
                    (https://openrouter.ai/api/v1)、Ollama (http://localhost:11434/v1)、Together AI
                    (https://api.together.xyz/v1)
                  </span>
                  <span v-else-if="provider.type === 'openai'">
                    可选：留空使用 OpenAI 官方端点。设置自定义 URL 可使用其他 OpenAI 兼容的服务。
                  </span>
                  <span v-else> 此提供商类型不支持自定义 Base URL。 </span>
                </p>
              </div>

              <div>
                <label class="text-sm font-medium block">可用模型 (逗号分隔):</label>
                <input
                  :value="getModelsText(provider.models)"
                  @input="(e) => setModelsText(index, (e.target as HTMLInputElement).value)"
                  type="text"
                  class="w-full px-2 py-1 border border-border rounded-none bg-surface text-sm font-mono"
                  placeholder="gpt-4o, gpt-4o-mini"
                />
              </div>

              <p class="text-xs text-muted">
                获取 API key:
                <a :href="getProviderTypeHelpUrl(provider.type)" target="_blank" class="text-brand">
                  {{ getProviderTypeDisplayName(provider.type) }}
                </a>
              </p>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <label for="explain-instruction" class="font-medium block">Explain Instruction:</label>
          <textarea
            id="explain-instruction"
            v-model="explainInstruction"
            rows="10"
            class="w-full px-2 py-1 border border-border rounded-none bg-surface font-mono text-sm"
            placeholder="Enter the instruction for the explain agent..."
          ></textarea>
          <p class="text-xs text-muted">
            The system prompt for the explain agent. Changes are saved automatically.
          </p>
        </div>

        <div class="space-y-2">
          <label for="stopwords" class="font-medium block">Stopwords (comma-separated):</label>
          <textarea
            id="stopwords"
            v-model="stopwordsText"
            rows="6"
            class="w-full px-2 py-1 border border-border rounded-none bg-surface font-mono text-sm"
            placeholder="Enter stopwords separated by commas..."
          ></textarea>
          <p class="text-xs text-muted">
            These words will be excluded from writing suggestions. Changes are saved automatically.
          </p>
        </div>
      </div>
    </div>
  </main>
</template>
