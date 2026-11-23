<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { InkButton, InkDropdown, InkForm, InkInput } from '@inkcre/ui-web'
import {
  listGitHubExtensionReleases,
  searchGitHubExtensionRepositories,
  type GitHubExtensionRelease,
} from '@inkcre/core'

const { t } = useI18n()
const router = useRouter()
const repositoryUrl = ref('')
const repositories = ref<string[]>([])
const repositoryOptions = computed(() =>
  repositories.value.map((value) => ({ value, label: value.replace('https://github.com/', '') }))
)
const releases = ref<GitHubExtensionRelease[]>([])
const extensionName = ref('')
const releaseId = ref('')
const extensionOptions = computed(() =>
  [...new Set(releases.value.map(({ name }) => name))]
    .sort()
    .map((name) => ({ label: name, value: name }))
)
const extensionReleases = computed(() =>
  releases.value.filter((release) => release.name === extensionName.value)
)
const releaseOptions = computed(() =>
  extensionReleases.value.map((release) => ({
    label: `v${release.version} · ${t(release.distribution === 'python' ? 'extension.hostCore' : 'extension.hostWeb')}`,
    value: release.tag,
  }))
)
const pending = ref(false)
const message = ref('')
const error = ref('')

async function browse(request: () => Promise<void>): Promise<void> {
  if (pending.value) return
  pending.value = true
  releases.value = []
  extensionName.value = ''
  releaseId.value = ''
  error.value = ''
  message.value = ''
  try {
    await request()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    pending.value = false
  }
}

async function listReleases(repository: string): Promise<void> {
  await browse(async () => {
    releases.value = await listGitHubExtensionReleases(repository)
    chooseExtension(extensionOptions.value[0]?.value ?? '')
    if (!releases.value.length) message.value = t('extension.noRepositoryReleases')
  })
}

async function findRepositories(): Promise<void> {
  repositories.value = []
  await browse(async () => {
    repositories.value = await searchGitHubExtensionRepositories()
    if (!repositories.value.length) message.value = t('extension.noRepositories')
  })
}

function chooseExtension(name: string | number): void {
  extensionName.value = String(name)
  const preferred =
    extensionReleases.value.find(({ version }) => !version.includes('-')) ??
    extensionReleases.value[0]
  releaseId.value = preferred?.tag ?? ''
}

async function chooseRepository(value: string | number): Promise<void> {
  repositoryUrl.value = String(value)
  await listReleases(repositoryUrl.value)
}

function continueToInstall(): void {
  const release = releases.value.find((item) => item.tag === releaseId.value)
  if (!release) return
  void router.push({
    path: '/extensions',
    query: {
      install: release.name,
      version: release.version,
      distribution: release.distribution,
      source_repository: release.repository,
    },
  })
}
</script>

<template>
  <h2>{{ t('extension.browseRepositories') }}</h2>
  <InkForm layout="col" @submit="listReleases(repositoryUrl)">
    <InkInput
      v-model="repositoryUrl"
      :label="t('extension.repositoryUrl')"
      placeholder="https://github.com/owner/repository"
      :disabled="pending"
    />
    <div class="repository-browser__actions">
      <InkButton
        native-type="submit"
        :text="t('extension.loadReleases')"
        :disabled="pending || !repositoryUrl.trim()"
      />
      <InkButton
        :text="t('extension.searchRepositories')"
        :disabled="pending"
        @click="findRepositories"
      />
    </div>
  </InkForm>
  <p v-if="pending" role="status">{{ t('common.loading') }}</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-if="message" role="status">{{ message }}</p>
  <InkDropdown
    v-if="repositoryOptions.length"
    :model-value="repositoryUrl"
    :label="t('extension.repository')"
    :options="repositoryOptions"
    :disabled="pending"
    @update:model-value="chooseRepository"
  />
  <template v-if="extensionOptions.length">
    <InkDropdown
      :model-value="extensionName"
      :label="t('extension.title')"
      :options="extensionOptions"
      @update:model-value="chooseExtension"
    />
    <InkDropdown v-model="releaseId" :label="t('extension.version')" :options="releaseOptions" />
    <InkButton
      theme="primary"
      :text="t('extension.continueToInstall')"
      :disabled="!releaseId"
      @click="continueToInstall"
    />
  </template>
</template>

<style scoped lang="scss">
.repository-browser__actions {
  display: flex;
  flex-wrap: wrap;
  gap: sys-var(space, sm);
}
</style>
