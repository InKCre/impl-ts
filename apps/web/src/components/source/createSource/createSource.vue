<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { InkButton, InkPopup } from '@inkcre/ui-web'
import sourceForm from '../sourceForm/sourceForm.vue'
import { createSourceEmits } from './createSource'
import { SourceForm } from '@inkcre/core'
import { useI18n } from 'vue-i18n'

const emit = defineEmits(createSourceEmits)
const { t } = useI18n()
const editor = useTemplateRef('editor')
const open = ref(false)
const saving = ref(false)
const error = ref('')
const form = ref(SourceForm.parse({ type: '', nickname: '' }))
function canDiscard() {
  return !saving.value && (!editor.value?.isDirty || window.confirm(t('source.discardChanges')))
}
function onClose() {
  if (!canDiscard()) return
  open.value = false
  form.value = SourceForm.parse({ type: '', nickname: '' })
  error.value = ''
}
onBeforeRouteLeave(canDiscard)
async function onCreate() {
  if (saving.value || !editor.value?.canSave) return
  saving.value = true
  error.value = ''
  try {
    const candidate = SourceForm.parse({ ...form.value, config: editor.value.readConfig() })
    const created = await candidate.create()
    emit('create', created)
    open.value = false
    form.value = SourceForm.parse({ type: '', nickname: '' })
  } catch {
    error.value = t('source.createFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <InkButton :text="t('source.create')" theme="primary" @click="open = true" />
  <InkPopup
    :open="open"
    position="center"
    :aria-label="t('source.create')"
    :close-on-scrim="!saving"
    :close-on-escape="!saving"
    @update:open="onClose"
  >
    <div class="create-source">
      <h2>{{ t('source.create') }}</h2>
      <sourceForm ref="editor" :model-value="form" :disabled="saving" @submit="onCreate">
        <p v-if="error" role="alert" class="text-feedback-error">{{ error }}</p>
        <div class="create-source__actions">
          <InkButton
            :text="t('common.cancel')"
            theme="subtle"
            :disabled="saving"
            @click="onClose"
          />
          <InkButton
            :text="t('source.create')"
            theme="primary"
            native-type="submit"
            :is-loading="saving"
            :disabled="!editor?.canSave"
          />
        </div>
      </sourceForm>
    </div>
  </InkPopup>
</template>

<style lang="scss" scoped src="./createSource.scss" />
