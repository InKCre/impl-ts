<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { InkButton, InkDropdown, InkForm, InkInput } from '@inkcre/ui-web'
import {
  BrowserAccess,
  Job,
  JobManager,
  Source,
  SourceForm,
  Block,
  Relation,
  getInfoBaseRouter,
  type BrowserProviderBinding,
} from '@inkcre/core'
import {
  CollectConfigSchema,
  SourceConfigSchema,
  sourceType,
  resolverTypes,
  UserSchema,
  type Folder,
  type User,
} from './schema.ts'
import { ProgressSchema, scopeKey } from './progress.ts'
import { discoverFavorites } from './site.ts'

const providers = shallowRef<BrowserProviderBinding[]>(BrowserAccess.bindings())
const provider = ref('')
const sources = shallowRef<Source[]>([])
const sourceRef = ref('')
const nickname = ref('B 站收藏夹')
const account = shallowRef<User | null>(null)
const folders = shallowRef<Folder[]>([])
const selectedFolders = ref<string[]>([])
const maxPages = ref('10')
const latestJob = shallowRef<Job | null>(null)
const busy = ref<'discover' | 'read' | 'save' | 'submit' | 'cancel' | 'refresh' | 'open' | null>(
  null
)
const error = ref('')
const notice = ref('')
const requiresRefresh = ref(false)
const cancellationTarget = ref<number | null>(null)
const controller = new AbortController()
const router = getInfoBaseRouter()
const jobStatus: Record<string, string> = {
  pending: '等待领取',
  running: '采集中',
  finished: '任务已结束',
  failed: '采集失败',
  timed_out: '采集超时',
  aborted: '已取消',
}
let mounted = true
let generation = 0
let poll: ReturnType<typeof setTimeout> | undefined

const current = computed(() =>
  sources.value.find((source) => String(source.id) === sourceRef.value)
)
const sourceOptions = computed(() => [
  { label: '新建采集源', value: '' },
  ...sources.value.map((source) => ({
    label: source.nickname || `采集源 #${source.id}`,
    value: String(source.id),
  })),
])
const providerOptions = computed(() =>
  providers.value.map((value) => ({ label: value.name, value: value.provider }))
)
const draftConfig = computed(() =>
  SourceConfigSchema.safeParse({
    provider: provider.value,
    account_mid: account.value?.mid,
    folder_ids: [...selectedFolders.value].sort(),
  })
)
const dirty = computed(() => {
  if (!current.value || !draftConfig.value.success) return true
  const saved = SourceConfigSchema.safeParse(current.value.config)
  return (
    !saved.success ||
    scopeKey(saved.data) !== scopeKey(draftConfig.value.data) ||
    nickname.value !== (current.value.nickname ?? '')
  )
})
const activeJob = computed(() => !!latestJob.value && !latestJob.value.isTerminal)
const eligibilityIssue = computed(() => {
  if (!current.value) return ''
  const config = SourceConfigSchema.safeParse(current.value.config)
  if (!config.success) return '此采集源的配置不完整，请重新确认账号和收藏夹。'
  return BrowserAccess.hasBinding(config.data.provider)
    ? ''
    : '此 Web Peer 尚未绑定所选浏览器，因此不会领取此采集源的任务。请查找浏览器并读取收藏夹完成绑定。'
})
const progress = computed(() => {
  const value = ProgressSchema.safeParse(current.value?.state.bilibili)
  return value.success ? value.data : null
})

watch(sourceRef, () => {
  generation++
  const value = current.value
  const config = SourceConfigSchema.safeParse(value?.config)
  const sameSession =
    config.success &&
    provider.value === config.data.provider &&
    account.value?.mid === config.data.account_mid
  const knownAccount = account.value
  const knownFolders = folders.value
  nickname.value = value?.nickname ?? 'B 站收藏夹'
  provider.value = config.success ? config.data.provider : ''
  account.value = config.success
    ? sameSession
      ? knownAccount
      : { mid: config.data.account_mid }
    : null
  folders.value = sameSession ? knownFolders : []
  selectedFolders.value = config.success ? [...config.data.folder_ids] : []
  latestJob.value = null
  notice.value = ''
  error.value = ''
  void refreshStatus()
})

function changedProvider() {
  generation++
  account.value = null
  folders.value = []
  selectedFolders.value = []
  notice.value = ''
}

function schedulePoll() {
  if (poll) clearTimeout(poll)
  if (mounted && activeJob.value) poll = setTimeout(() => void refreshStatus(), 2000)
}

async function refreshStatus() {
  const id = current.value?.id
  const epoch = generation
  if (!id) return
  try {
    const [source, jobs] = await Promise.all([Source.get(id), Job.getBySource(id, 1)])
    if (!mounted || epoch !== generation) return
    sources.value = sources.value.map((value) => (value.id === id ? source : value))
    const observed = jobs[0] ?? null
    latestJob.value = observed
    if (observed?.isTerminal) {
      notice.value = `任务 #${observed.id} 当前为${jobStatus[observed.status]}。`
    } else if (observed?.abort_requested) {
      notice.value = `任务 #${observed.id} 的取消请求已记录，等待任务实际结束。`
    }
  } catch {
    if (mounted && epoch === generation) error.value = '无法刷新采集状态，请检查信息库连接后重试。'
  } finally {
    if (mounted && epoch === generation) schedulePoll()
  }
}

async function refresh() {
  if (busy.value) return
  busy.value = 'refresh'
  error.value = ''
  try {
    const result = await Source.dbApi
      .from()
      .select()
      .eq('type', sourceType)
      .order('id', { ascending: false })
      .throwOnError()
    if (!mounted) return
    sources.value = (result.data ?? []).map((row) => Source.parse(row))
    providers.value = BrowserAccess.bindings()
    await refreshStatus()
    if (cancellationTarget.value !== null) {
      const observed = await Job.get(cancellationTarget.value)
      if (!mounted) return
      notice.value = observed.isTerminal
        ? `原任务 #${observed.id} 当前为${jobStatus[observed.status]}。`
        : observed.abort_requested
          ? `原任务 #${observed.id} 的取消请求已记录，等待任务结束。`
          : `原任务 #${observed.id} 尚未记录取消请求，可根据当前状态重新操作。`
      cancellationTarget.value = null
    }
    requiresRefresh.value = false
  } catch {
    if (mounted) error.value = '无法读取采集源，请检查信息库连接后刷新。'
  } finally {
    if (mounted) busy.value = null
  }
}

async function discover() {
  if (busy.value) return
  busy.value = 'discover'
  error.value = ''
  try {
    const found = await BrowserAccess.discover(controller.signal)
    if (!mounted) return
    const all = new Map(BrowserAccess.bindings().map((value) => [value.provider, value]))
    for (const value of found) all.set(value.provider, value)
    providers.value = [...all.values()]
    notice.value = found.length
      ? `找到 ${found.length} 个已授权此网页的浏览器，请选择后读取收藏夹。`
      : '未发现浏览器。请在 InKCre 浏览器扩展设置中授权当前网页地址，再重新查找。'
  } catch (cause) {
    if (mounted) error.value = cause instanceof Error ? cause.message : '无法查找浏览器。'
  } finally {
    if (mounted) busy.value = null
  }
}

async function readFolders() {
  const binding = providers.value.find((value) => value.provider === provider.value)
  if (busy.value || !binding) return
  busy.value = 'read'
  error.value = ''
  const epoch = ++generation
  try {
    BrowserAccess.bind(binding)
    const value = await discoverFavorites(binding.provider, controller.signal)
    if (!mounted || epoch !== generation) return
    const sameAccount = account.value?.mid === value.account.mid
    account.value = value.account
    folders.value = value.folders
    selectedFolders.value = sameAccount
      ? selectedFolders.value.filter((id) => value.folders.some((folder) => folder.id === id))
      : []
    notice.value = `已读取 ${value.folders.length} 个自建收藏夹，请确认账号并选择要保存的收藏夹。`
  } catch (cause) {
    if (mounted && epoch === generation)
      error.value = cause instanceof Error ? cause.message : '无法读取 B 站收藏夹。'
  } finally {
    if (mounted && epoch === generation) busy.value = null
  }
}

async function save() {
  if (busy.value || !draftConfig.value.success || activeJob.value || requiresRefresh.value) return
  busy.value = 'save'
  error.value = ''
  try {
    const config = draftConfig.value.data
    const source = current.value
      ? Source.parse(
          (
            await Source.dbApi
              .update({ nickname: nickname.value, config })
              .eq('id', current.value.id)
              .select()
              .single()
              .throwOnError()
          ).data
        )
      : await SourceForm.parse({ type: sourceType, nickname: nickname.value, config }).create()
    if (!mounted) return
    sources.value = [source, ...sources.value.filter((value) => value.id !== source.id)]
    sourceRef.value = String(source.id)
    notice.value = '采集源已保存，可以开始采集。'
  } catch (cause) {
    if (mounted) {
      requiresRefresh.value = true
      error.value = `${cause instanceof Error ? cause.message : '保存失败。'} 请先刷新并检查保存结果，再继续操作。`
    }
  } finally {
    if (mounted) busy.value = null
  }
}

async function collect() {
  if (busy.value || !current.value || dirty.value || activeJob.value || requiresRefresh.value)
    return
  const options = CollectConfigSchema.safeParse({ max_pages: Number(maxPages.value) })
  if (!options.success) {
    error.value = '单次采集分页应为 1 至 100 的整数。'
    return
  }
  busy.value = 'submit'
  error.value = ''
  try {
    const job = await JobManager.create(
      'core.source.collect.v1',
      { source: current.value.id, config: options.data },
      900
    )
    if (!mounted) return
    latestJob.value = job
    notice.value = `采集任务 #${job.id} 已提交。保持此 Web Peer 和所选浏览器运行。`
    schedulePoll()
  } catch (cause) {
    if (mounted) {
      requiresRefresh.value = true
      error.value = `${cause instanceof Error ? cause.message : '提交失败。'} 请刷新任务状态后再继续，不会自动重复提交。`
    }
  } finally {
    if (mounted) busy.value = null
  }
}

async function requestCancellation() {
  const target = latestJob.value
  if (busy.value || !target || target.isTerminal || target.abort_requested || requiresRefresh.value)
    return
  busy.value = 'cancel'
  error.value = ''
  cancellationTarget.value = target.id
  try {
    const result = await Job.dbApi
      .update({ abort_requested: true })
      .eq('id', target.id)
      .in('status', ['pending', 'running'])
      .select()
      .maybeSingle()
      .throwOnError()
    const observed = result.data ? Job.parse(result.data) : await Job.get(target.id)
    if (!mounted) return
    if (latestJob.value?.id === target.id) latestJob.value = observed
    cancellationTarget.value = null
    notice.value = observed.isTerminal
      ? `任务 #${observed.id} 当前为${jobStatus[observed.status]}。`
      : `任务 #${observed.id} 的取消请求已记录，等待任务实际结束。`
    schedulePoll()
  } catch {
    if (mounted) {
      requiresRefresh.value = true
      error.value = `无法确认任务 #${target.id} 的取消结果，请刷新原任务状态；不会自动重复发送取消请求。`
    }
  } finally {
    if (mounted) busy.value = null
  }
}

async function openSaved() {
  const source = current.value
  if (busy.value || !source?.block) return
  const config = SourceConfigSchema.safeParse(source.config)
  if (!config.success) {
    error.value = '采集源配置无法识别。'
    return
  }
  busy.value = 'open'
  error.value = ''
  try {
    const links = await Relation.dbApi
      .from()
      .select()
      .eq('from_', source.block)
      .eq('content', 'collects')
      .throwOnError()
    const roots = await Block.getMany((links.data ?? []).map((link) => Relation.parse(link).to_))
    let root: Block | undefined
    for (const block of roots) {
      if (block.resolver !== resolverTypes.user) continue
      const content = await block.getHydratedContent()
      if (typeof content !== 'string') continue
      const user = UserSchema.parse(JSON.parse(content))
      if (user.mid === config.data.account_mid) root = block
    }
    if (!mounted) return
    if (!root) throw new Error('尚未找到此采集源已保存的 B 站账号资料。')
    router.push({ name: 'solved-content', block: root.id })
  } catch (cause) {
    if (mounted) error.value = cause instanceof Error ? cause.message : '无法打开已保存资料。'
  } finally {
    if (mounted) busy.value = null
  }
}

onMounted(() => void refresh())
onUnmounted(() => {
  mounted = false
  generation++
  controller.abort()
  if (poll) clearTimeout(poll)
})
</script>

<template>
  <section class="bilibili-setup">
    <header>
      <h2>B 站收藏夹</h2>
      <p>将自己的收藏夹、视频资料与收藏关系保存到当前信息库。</p>
    </header>
    <InkForm layout="col" @submit="save">
      <InkDropdown v-model="sourceRef" label="采集源" :options="sourceOptions" :disabled="!!busy" />
      <InkInput v-model="nickname" label="名称" :disabled="!!busy || activeJob" />
      <div class="bilibili-actions">
        <InkButton
          text="查找本机浏览器"
          :is-loading="busy === 'discover'"
          :disabled="!!busy"
          @click="discover"
        />
      </div>
      <InkDropdown
        v-model="provider"
        label="使用的浏览器"
        :options="providerOptions"
        :disabled="!!busy || activeJob"
        @change="changedProvider"
      />
      <div class="bilibili-actions">
        <InkButton
          text="读取 B 站收藏夹"
          :is-loading="busy === 'read'"
          :disabled="!!busy || !provider || activeJob"
          @click="readFolders"
        />
      </div>
      <p v-if="account">账号：{{ account.name || '已保存账号' }} · UID {{ account.mid }}</p>
      <fieldset v-if="folders.length" :disabled="!!busy || activeJob">
        <legend>选择自己的收藏夹</legend>
        <div class="bilibili-actions">
          <InkButton
            text="全选"
            size="sm"
            :disabled="!!busy || activeJob"
            @click="selectedFolders = folders.map((folder) => folder.id)"
          /><InkButton
            text="清空选择"
            size="sm"
            :disabled="!!busy || activeJob"
            @click="selectedFolders = []"
          />
        </div>
        <label v-for="folder in folders" :key="folder.id" class="bilibili-folder-choice">
          <input v-model="selectedFolders" type="checkbox" :value="folder.id" />
          <span
            >{{ folder.title || `收藏夹 ${folder.id}` }}
            <small
              >{{
                folder.is_private === undefined
                  ? '可见性未知'
                  : folder.is_private
                    ? '私密'
                    : '公开'
              }}<template v-if="folder.reported_count !== undefined">
                · {{ folder.reported_count }} 条</template
              ></small
            ></span
          >
        </label>
      </fieldset>
      <p v-else-if="selectedFolders.length">
        已选择 {{ selectedFolders.length }} 个收藏夹。读取收藏夹可查看名称并调整范围。
      </p>
      <p v-if="account" class="bilibili-help">
        仅保存所选收藏夹的资料和关系，不保存视频文件。私密收藏夹的资料也会进入当前信息库。
      </p>
      <InkButton
        native-type="submit"
        text="保存采集源"
        theme="primary"
        :is-loading="busy === 'save'"
        :disabled="!!busy || !draftConfig.success || !dirty || activeJob || requiresRefresh"
      />
    </InkForm>
    <section v-if="current" class="bilibili-run">
      <h3>采集</h3>
      <InkInput
        v-model="maxPages"
        label="单次最多采集分页"
        native-type="number"
        :disabled="!!busy || activeJob"
      />
      <p class="bilibili-help">
        每页由 B 站返回最多 20
        条。未完成时可再次执行，继续已确认的进度；已全部完成后再次执行会重新核对收藏夹。
      </p>
      <div class="bilibili-actions">
        <InkButton
          text="开始采集"
          theme="primary"
          :is-loading="busy === 'submit'"
          :disabled="!!busy || dirty || activeJob || requiresRefresh"
          @click="collect"
        />
        <InkButton
          text="刷新状态"
          :is-loading="busy === 'refresh'"
          :disabled="!!busy"
          @click="refresh"
        />
        <InkButton
          v-if="activeJob"
          :text="latestJob?.abort_requested ? '已请求取消' : '请求取消'"
          :is-loading="busy === 'cancel'"
          :disabled="!!busy || !!latestJob?.abort_requested || requiresRefresh"
          @click="requestCancellation"
        />
        <InkButton
          v-if="current.block"
          text="查看已保存资料"
          :is-loading="busy === 'open'"
          :disabled="!!busy"
          @click="openSaved"
        />
      </div>
      <p v-if="latestJob">
        任务 #{{ latestJob.id }} · {{ jobStatus[latestJob.status] || latestJob.status }}
      </p>
      <p v-if="eligibilityIssue">{{ eligibilityIssue }}</p>
      <p v-if="latestJob && typeof latestJob.state.error === 'string'" role="alert">
        {{ latestJob.state.error }}
      </p>
      <p v-if="progress">
        {{
          progress.last_run.status === 'complete'
            ? '已遍历所选收藏夹的可见分页'
            : progress.last_run.status === 'partial'
              ? '本次预算已用完，仍有未完成范围'
              : '尚未确认本轮完成'
        }}；本轮已保存 {{ progress.last_run.items }} 条，失效
        {{ progress.last_run.unavailable }} 条，未支持
        {{ progress.last_run.unsupported }} 条，未解析 {{ progress.last_run.unresolved }} 条。
      </p>
      <ul v-if="progress" class="bilibili-folder-progress">
        <li v-for="(cursor, id) in progress.folders" :key="id">
          <strong>{{ folders.find((folder) => folder.id === id)?.title || `收藏夹 ${id}` }}</strong>
          <p>
            {{ cursor.complete ? '分页已遍历' : '仍有未完成分页' }}；累计返回
            {{ cursor.rows }} 条，其中视频 {{ cursor.items }} 条、失效
            {{ cursor.unavailable }} 条、未支持 {{ cursor.unsupported }} 条、未解析
            {{ cursor.unresolved }} 条。
          </p>
          <p v-if="cursor.reported_count !== undefined">
            来源报告 {{ cursor.reported_count }} 条。<template
              v-if="cursor.complete && cursor.reported_count !== cursor.rows"
              >与分页返回数量相差
              {{ Math.abs(cursor.reported_count - cursor.rows) }}
              条；差额原因未确认，可能涉及来源隐藏项或异步计数，不能据此声明已取得全部条目。</template
            >
          </p>
        </li>
      </ul>
    </section>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.bilibili-setup {
  display: grid;
  gap: 1rem;
  max-width: 48rem;
  min-width: 0;
}
.bilibili-setup h2,
.bilibili-setup h3,
.bilibili-setup p {
  margin: 0;
}
.bilibili-setup header,
.bilibili-run {
  display: grid;
  gap: 0.75rem;
}
.bilibili-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}
.bilibili-help,
.bilibili-folder-choice small {
  opacity: 0.65;
  font-size: 0.875rem;
}
.bilibili-setup fieldset {
  display: grid;
  gap: 0.5rem;
  border: 0;
  padding: 0;
  margin: 0;
  max-height: 22rem;
  overflow: auto;
}
.bilibili-setup legend {
  margin-bottom: 0.5rem;
}
.bilibili-folder-choice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.25rem 0;
  overflow-wrap: anywhere;
}
.bilibili-folder-choice input {
  margin-top: 0.25rem;
}
.bilibili-folder-progress {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
