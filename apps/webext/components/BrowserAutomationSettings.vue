<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import { InkButton, InkForm, InkInput } from '@inkcre/ui-web'
import { siteMatchPattern } from '~/logic/collection/permissions'

const props = defineProps<{ provider?: string }>()
const origin = ref('')
const grants = ref<Array<{ origin: string; provider: string }>>([])
const busy = ref(false)
const error = ref('')
const feedback = ref('')
const supported = import.meta.env.CHROME

async function update(type: string, value: Record<string, unknown> = {}) {
  const result = (await browser.runtime.sendMessage({ type, ...value })) as {
    ok: boolean
    error?: string
    value?: { grants: Array<{ origin: string; provider: string }> }
  }
  if (!result.ok || !result.value) throw new Error(result.error ?? '浏览器设置读取失败。')
  grants.value = result.value.grants
}

async function action(run: () => Promise<void>) {
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    await run()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
  } finally {
    busy.value = false
  }
}

async function grant() {
  if (!props.provider) throw new Error('请先配置当前信息库连接。')
  const exactOrigin = new URL(origin.value).origin
  if (!(await browser.permissions.request({ origins: [siteMatchPattern(exactOrigin)] })))
    throw new Error('未取得此 Web 站点的访问权限。')
  await update('browser-automation-grant', { origin: exactOrigin, provider: props.provider })
  origin.value = ''
  feedback.value = '已授权。回到该 Web 页面查找并绑定此浏览器。'
}

onMounted(() => void action(() => update('browser-automation-state')))
</script>

<template>
  <section class="section" aria-labelledby="browser-automation-heading">
    <h2 id="browser-automation-heading">浏览器操作</h2>
    <p v-if="!supported">此浏览器尚不支持自动化操作。请使用 Chromium 版本的扩展。</p>
    <template v-else>
      <p>授权的 InKCre Web 站点可操作此浏览器的标签页，使用其中的登录状态采集信息。</p>
      <p v-if="!provider">请先加入信息库，再授权可信任的 InKCre Web 地址。</p>
      <InkForm v-else layout="col" @submit="action(grant)">
        <InkInput
          v-model="origin"
          label="InKCre Web 地址"
          native-type="url"
          required
          :disabled="busy"
        />
        <InkButton text="授权此站点" native-type="submit" :disabled="busy || !origin" />
      </InkForm>
      <div
        v-for="grantItem in grants"
        :key="`${grantItem.origin}:${grantItem.provider}`"
        class="row"
      >
        <div class="stack">
          <span>{{ grantItem.origin }}</span>
          <code class="item-url">{{ grantItem.provider }}</code>
        </div>
        <InkButton
          text="撤销授权"
          size="sm"
          :disabled="busy"
          @click="action(() => update('browser-automation-revoke', grantItem))"
        />
      </div>
    </template>
    <p v-if="error" role="alert" class="feedback error">{{ error }}</p>
    <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
  </section>
</template>
