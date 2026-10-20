<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { InkButton, InkDropdown, InkForm, InkInput } from '@inkcre/ui-web'
import { ExtensionModel, PeerOutcomeUnknown } from '@inkcre/core'
import {
  ConnectionError,
  extensionName,
  prepareConnection,
  readCandidates,
  readConnection,
  runtimeReady,
  savedPassword,
  waitingForRuntime,
  type Candidate,
} from './setup'
import { useText } from './locale'

const emit = defineEmits<{ close: [] }>()
const tr = useText()
const candidates = shallowRef<Candidate[]>([])
const selected = ref('')
const password = ref<string | null>(null)
const connection = shallowRef<{ server_url: string; username: string } | null>(null)
const busy = ref<'read' | 'prepare' | null>(null)
const loaded = ref(false)
const reveal = ref(false)
const requiresRefresh = ref(false)
const unavailable = ref(0)
const error = ref('')
const notice = ref('')
let mounted = true
let generation = 0
onUnmounted(() => {
  mounted = false
  generation++
  password.value = null
})

const candidate = computed(() => candidates.value.find((value) => value.peer.id === selected.value))
const waiting = computed(() => waitingForRuntime(candidate.value?.status ?? null))
const ready = computed(
  () => runtimeReady(candidate.value?.status ?? null) && !!connection.value && !!password.value
)
const options = computed(() =>
  candidates.value.map(({ peer }) => ({ label: peer.name, value: peer.id }))
)

function connectionFailure(cause: unknown) {
  return cause instanceof ConnectionError && cause.status === 409
    ? tr(
        'The service is running. Set this Peer’s Public HTTP Base URL in Peers → Edit Config, then refresh.',
        '服务已运行。请在 Peer → 编辑配置中设置公共 HTTP 基址，再刷新。'
      )
    : tr(
        'The saved password is preserved, but connection details are unavailable. Check this Peer and refresh.',
        '已保存的密码保持不变，但暂时无法读取连接信息。请检查此 Peer 后刷新。'
      )
}

async function loadConnection(epoch: number) {
  connection.value = null
  const target = candidate.value
  if (!target || !password.value || !runtimeReady(target.status)) return
  try {
    const value = await readConnection(target.peer.id)
    if (mounted && epoch === generation) connection.value = value
  } catch (cause) {
    if (mounted && epoch === generation) error.value = connectionFailure(cause)
  }
}

async function refresh() {
  if (busy.value) return
  const epoch = ++generation
  busy.value = 'read'
  error.value = ''
  notice.value = ''
  reveal.value = false
  connection.value = null
  try {
    const [current, extension] = await Promise.all([
      readCandidates(),
      ExtensionModel.get(extensionName),
    ])
    if (!mounted || epoch !== generation) return
    if (!extension) throw new Error('CalDAV is not installed.')
    password.value = savedPassword(extension)
    candidates.value = current.candidates
    unavailable.value = current.unavailable
    if (!selected.value && current.candidates.length === 1)
      selected.value = current.candidates[0]!.peer.id
    loaded.value = true
    // An unavailable original target cannot resolve an unknown write outcome.
    if (candidate.value) requiresRefresh.value = false
    await loadConnection(epoch)
  } catch {
    if (mounted && epoch === generation) {
      loaded.value = false
      error.value = tr(
        'Unable to read setup. Check the instance connection and refresh.',
        '无法读取配置，请检查实例连接后刷新。'
      )
    }
  } finally {
    if (mounted && epoch === generation) busy.value = null
  }
}

async function changePeer() {
  const epoch = ++generation
  reveal.value = false
  error.value = ''
  notice.value = ''
  busy.value = 'read'
  try {
    await loadConnection(epoch)
  } finally {
    if (mounted && epoch === generation) busy.value = null
  }
}

async function prepare() {
  if (busy.value || !candidate.value || requiresRefresh.value) return
  const epoch = ++generation
  const target = candidate.value.peer
  busy.value = 'prepare'
  error.value = ''
  notice.value = ''
  connection.value = null
  reveal.value = false
  try {
    const status = await prepareConnection(target)
    const extension = await ExtensionModel.get(extensionName)
    if (!mounted || epoch !== generation) return
    candidates.value = candidates.value.map((value) =>
      value.peer.id === target.id ? { ...value, status } : value
    )
    password.value = extension ? savedPassword(extension) : null
    if (waitingForRuntime(status)) {
      notice.value = tr(
        'Installation is restarting the Peer. Refresh its status before continuing.',
        '安装正在重启此 Peer。请刷新状态，重启结束后继续准备连接。'
      )
    } else if (!runtimeReady(status)) {
      notice.value = tr(
        'The request completed, but the service is not running yet. Refresh to check its status.',
        '请求已完成，但服务尚未运行。请刷新查看实际状态。'
      )
    }
    await loadConnection(epoch)
  } catch (cause) {
    if (!mounted || epoch !== generation) return
    requiresRefresh.value = true
    error.value =
      cause instanceof PeerOutcomeUnknown
        ? tr(
            'The request outcome is unknown. Refresh this Peer before continuing; the request will not be repeated automatically.',
            '请求结果未知。请先刷新此 Peer 的状态；不会自动重复发送请求。'
          )
        : tr(
            'Connection preparation did not finish. Saved settings are preserved. Refresh this Peer before retrying.',
            '连接准备未完成，已保存的设置仍保留。请刷新此 Peer 后重试。'
          )
  } finally {
    if (mounted && epoch === generation) busy.value = null
  }
}

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notice.value = tr('Copied.', '已复制。')
  } catch {
    notice.value = tr(
      'Clipboard unavailable. Select and copy the value manually.',
      '剪贴板不可用，请选中文字手动复制。'
    )
  }
}
onMounted(refresh)
</script>

<template>
  <section class="dav-setup" :aria-busy="!!busy">
    <p>
      {{
        tr(
          'Connect your calendar, task and contacts apps to InKCre with DAVx⁵.',
          '通过 DAVx⁵ 将日历、任务和联系人应用连接到 InKCre。'
        )
      }}
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="unavailable" class="muted">
      {{
        tr(
          'Some Peers could not be reached. Refresh when they are available.',
          '部分 Peer 暂时无法访问，恢复连接后可刷新。'
        )
      }}
    </p>
    <template v-if="loaded">
      <InkForm v-if="candidates.length" layout="col" @submit="prepare">
        <h3>{{ tr('1. Choose the service Peer', '1. 选择提供服务的 Peer') }}</h3>
        <InkDropdown
          v-model="selected"
          :options="options"
          :label="tr('CalDAV service Peer', 'CalDAV 服务 Peer')"
          :disabled="!!busy || requiresRefresh"
          @change="changePeer"
        />
        <p v-if="candidate?.status?.version" class="muted">
          Python {{ candidate.status.version }} ·
          {{
            runtimeReady(candidate.status)
              ? tr('Running', '运行中')
              : waiting
                ? tr('Restarting', '正在重启')
                : tr('Not running', '未运行')
          }}
        </p>
        <template v-if="!ready">
          <p>
            {{
              tr(
                'Preparation installs and starts CalDAV on this Peer. An existing password is reused; otherwise a new dedicated password is created.',
                '准备连接会在此 Peer 上安装并启用 CalDAV。已有密码会继续使用；尚未配置时才生成专用密码。'
              )
            }}
          </p>
          <InkButton
            native-type="submit"
            theme="primary"
            :text="tr('Prepare connection', '准备连接')"
            :disabled="!candidate || !!busy || waiting || requiresRefresh"
            :is-loading="busy === 'prepare'"
          />
        </template>
        <template v-else-if="connection">
          <h3>{{ tr('2. Add a DAVx⁵ account', '2. 添加 DAVx⁵ 账户') }}</h3>
          <p role="status">
            {{
              tr(
                'Connection details are ready. Choose “Login with URL and username” in DAVx⁵.',
                '连接信息已准备好。在 DAVx⁵ 中选择“使用 URL 和用户名登录”。'
              )
            }}
          </p>
          <InkInput
            :model-value="connection.server_url"
            :label="tr('Server URL', '服务地址')"
            readonly
          />
          <InkButton
            :text="tr('Copy server URL', '复制服务地址')"
            @click="copy(connection.server_url)"
          />
          <InkInput :model-value="connection.username" :label="tr('Username', '用户名')" readonly />
          <InkInput
            :model-value="password"
            :label="tr('DAV password', 'DAV 专用密码')"
            :native-type="reveal ? 'text' : 'password'"
            readonly
            autocomplete="off"
          />
          <div class="actions">
            <InkButton
              :text="reveal ? tr('Hide password', '隐藏密码') : tr('Show password', '显示密码')"
              :aria-pressed="reveal"
              @click="reveal = !reveal"
            />
            <InkButton :text="tr('Copy password', '复制密码')" @click="copy(password!)" />
          </div>
          <p class="muted">
            {{
              tr(
                'All DAV clients share this password and the same collections. Keep it private.',
                '所有 DAV 客户端共享此密码和集合，请妥善保管。'
              )
            }}
          </p>
          <h3>{{ tr('3. Choose what to sync', '3. 选择同步内容') }}</h3>
          <p>
            {{
              tr(
                'Select InKCre calendars and tasks under CalDAV, and contacts under CardDAV. Install Tasks.org and allow DAVx⁵ to access tasks, calendars and contacts, then sync.',
                '在 CalDAV 页勾选 InKCre 日历和任务，在 CardDAV 页勾选联系人。安装 Tasks.org，并授予 DAVx⁵ 任务、日历和联系人权限，然后同步。'
              )
            }}
          </p>
          <details>
            <summary>{{ tr('Connection troubleshooting', '连接问题排查') }}</summary>
            <p>
              {{
                tr(
                  'The phone must be able to reach this URL. For all-day events on Huawei JKM-AL00a, use Etar if the system calendar produces an invalid time zone.',
                  '手机需要能够访问此地址。华为 JKM-AL00a 系统日历若在创建全天事件时报无效时区，可使用 Etar。'
                )
              }}
            </p>
          </details>
        </template>
      </InkForm>
      <p v-else role="status">
        {{
          tr(
            'No online Peer supporting Python was found. Start a Python Peer and refresh.',
            '未找到支持 Python 的在线 Peer。请启动 Python Peer 后刷新。'
          )
        }}
      </p>
    </template>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div class="actions">
      <InkButton
        :text="tr('Refresh status', '刷新状态')"
        :is-loading="busy === 'read'"
        :disabled="!!busy"
        @click="refresh"
      />
      <InkButton :text="tr('Close', '关闭')" :disabled="!!busy" @click="emit('close')" />
    </div>
  </section>
</template>

<style scoped>
.dav-setup {
  display: grid;
  gap: 1rem;
  min-width: 0;
  max-width: 42rem;
  overflow-wrap: anywhere;
}
p,
h3 {
  margin: 0;
}
h3 {
  font-size: var(--sys-font-title-sm-font-size);
}
.muted {
  color: var(--sys-color-text-subtle);
}
.error {
  color: var(--sys-color-feedback-error);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
summary {
  cursor: pointer;
}
details p {
  margin-top: 0.6rem;
}
</style>
