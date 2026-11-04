<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAsyncState } from '@vueuse/core'
import {
  InkInput,
  InkDropdown,
  InkForm,
  InkButton,
  InkLoading,
  type JsonEditorValidation,
} from '@inkcre/ui-web'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'
import { sourceFormProps } from './sourceForm'
import { SourceType } from '@inkcre/core'
import { useI18n } from 'vue-i18n'

const props = defineProps(sourceFormProps)
const { t } = useI18n()
const {
  state: sourceTypes,
  isLoading: typesLoading,
  error: typesError,
  execute: loadTypes,
} = useAsyncState(() => SourceType.getAll(), [], {
  // The form renders the error and retains its draft for retry.
  onError: () => undefined,
})
const typeOptions = computed(() =>
  sourceTypes.value.map((type) => ({ label: type.id, value: type.id }))
)
const currentSourceType = computed(() =>
  sourceTypes.value.find((type) => type.id === props.modelValue.type)
)
const configJson = ref('')
const validation = ref<JsonEditorValidation>()
const initial = ref({
  nickname: props.modelValue.nickname,
  type: props.modelValue.type,
  config: '',
})
watch(
  () => props.modelValue,
  (source) => {
    configJson.value = JSON.stringify(source.config, null, 2)
    initial.value = { nickname: source.nickname, type: source.type, config: configJson.value }
    validation.value = undefined
  },
  { immediate: true }
)
watch(
  currentSourceType,
  () => {
    validation.value = undefined
  },
  { flush: 'sync' }
)
const isDirty = computed(
  () =>
    props.modelValue.nickname !== initial.value.nickname ||
    props.modelValue.type !== initial.value.type ||
    configJson.value !== initial.value.config
)
const canSave = computed(
  () =>
    !typesLoading.value &&
    !typesError.value &&
    Boolean(currentSourceType.value) &&
    validation.value?.status === 'valid' &&
    validation.value.text === configJson.value
)
function readConfig(): unknown {
  if (!canSave.value) throw new Error(t('common.invalidConfig'))
  return JSON.parse(configJson.value)
}
defineExpose({ canSave, isDirty, readConfig, sourceTypes })
</script>

<template>
  <InkForm class="source-form" layout="col">
    <InkInput v-model="modelValue.nickname" :label="t('source.nickname')" :disabled="disabled" />
    <InkDropdown
      v-model="modelValue.type"
      :options="typeOptions"
      :label="t('source.type')"
      :disabled="disabled || typesLoading"
    />
    <InkLoading v-if="typesLoading" variant="spinner" size="xs" :label="t('source.typesLoading')" />
    <div v-else-if="typesError" class="source-form__error">
      <p role="alert" class="text-feedback-error">{{ t('source.typesFailed') }}</p>
      <InkButton :text="t('source.retry')" theme="subtle" size="sm" @click="loadTypes()" />
    </div>
    <p
      v-else-if="!sourceTypes.length || (modelValue.type && !currentSourceType)"
      role="alert"
      class="text-feedback-error"
    >
      {{ t('source.typeUnavailable') }}
    </p>
    <SchemaConfigEditor
      v-model="configJson"
      :schema="currentSourceType?.config_schema"
      :label="t('source.config')"
      :placeholder="t('source.configPlaceholder')"
      :rows="8"
      :disabled="disabled"
      @validation="validation = $event"
    />
    <slot />
  </InkForm>
</template>

<style lang="scss" scoped src="./sourceForm.scss" />
