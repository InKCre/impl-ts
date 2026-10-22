<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { InkButton } from '@inkcre/ui-web'
import { getInfoBaseRouter, type SolvedContentRendererProps } from '@inkcre/core'

import type { EmailResolver } from '../../resolver'
import MimePartItem from '../contentMimePart/MimePartItem.vue'
import type { SolvedEmail } from '../../schema'
import { readingBodies } from '../../newsletter'
import MailBody from '../MailBody.vue'

const props = defineProps<SolvedContentRendererProps<SolvedEmail, EmailResolver>>()
const router = getInfoBaseRouter()
const email = ref(props.solvedContent)
const materializing = ref<Set<number>>(new Set())
const materializeErrors = ref<Map<number, string>>(new Map())

watch(
  () => props.solvedContent,
  (value) => {
    email.value = value
  }
)

const participants = computed(() => {
  const grouped = new Map<string, string[]>()
  for (const participant of [...email.value.participants].sort(
    (left, right) => left.relation.order - right.relation.order
  )) {
    const values = grouped.get(participant.relation.role) ?? []
    const name = participant.relation.display_name
    const address = participant.address.solvedContent.address
    values.push(name ? `${name} <${address}>` : address)
    grouped.set(participant.relation.role, values)
  }
  return [...grouped.entries()]
})

const sender = computed(() => {
  const from = email.value.participants.filter(
    (participant) => participant.relation.role === 'from'
  )
  const senders = from.length
    ? from
    : email.value.participants.filter((participant) => participant.relation.role === 'sender')
  return senders
    .sort((left, right) => left.relation.order - right.relation.order)
    .map(
      (participant) =>
        participant.relation.display_name || participant.address.solvedContent.address
    )
    .join(', ')
})
const attachments = computed(() =>
  email.value.mimeParts.filter((part) => part.relation.role === 'attachment')
)
const inlineParts = computed(() =>
  email.value.mimeParts.filter((part) => part.relation.role === 'inline')
)
const conversations = computed(() => {
  const parents = new Set(email.value.parents.map((part) => part.block.id))
  return [
    ...email.value.parents,
    ...email.value.references.filter((part) => !parents.has(part.block.id)),
  ]
})

const bodies = computed(() => readingBodies(email.value.bodies))

async function materialize(block: number): Promise<void> {
  if (materializing.value.has(block)) return
  materializing.value = new Set(materializing.value).add(block)
  const errors = new Map(materializeErrors.value)
  errors.delete(block)
  materializeErrors.value = errors
  try {
    email.value = await props.resolver.materializeMimePart(block)
  } catch (cause) {
    materializeErrors.value = new Map(materializeErrors.value).set(
      block,
      cause instanceof Error ? cause.message : String(cause)
    )
  } finally {
    const active = new Set(materializing.value)
    active.delete(block)
    materializing.value = active
  }
}

function navigate(block: number): void {
  void router.push({ name: 'block', block })
}
</script>

<template>
  <article class="content-email">
    <header class="content-email__header">
      <h2>{{ email.root.subject || '(no subject)' }}</h2>
      <p v-if="sender" class="content-email__sender">{{ sender }}</p>
      <time v-if="email.root.authored_at" :datetime="email.root.authored_at.toISOString()">{{
        email.root.authored_at.toLocaleString()
      }}</time>
      <details
        v-if="participants.length || email.mailboxes.length || email.flags.length"
        class="content-email__details"
      >
        <summary>Message details</summary>
        <dl>
          <template v-for="[role, values] in participants" :key="role">
            <dt>{{ role.replace(/_/g, ' ') }}</dt>
            <dd>{{ values.join(', ') }}</dd>
          </template>
          <template v-if="email.mailboxes.length"
            ><dt>Mailboxes</dt>
            <dd>
              {{ email.mailboxes.map((item) => item.mailbox.solvedContent.name).join(', ') }}
            </dd></template
          >
          <template v-if="email.flags.length"
            ><dt>Flags</dt>
            <dd>
              {{ email.flags.map((item) => item.flag.solvedContent.name).join(', ') }}
            </dd></template
          >
        </dl>
      </details>
    </header>
    <nav v-if="email.mailingLists.length" aria-label="所属刊物">
      <InkButton
        v-for="publication in email.mailingLists"
        :key="publication.block.id"
        @click="router.push({ name: 'solved-content', block: publication.block.id })"
      >
        {{ publication.solvedContent.name || publication.solvedContent.list_id }} · 查看各期
      </InkButton>
    </nav>
    <MailBody
      v-for="body in bodies"
      :key="body.block.id"
      :block="body.block"
      :content="body.solvedContent"
      :embedded="email.embedded"
    />
    <p v-if="!bodies.length" class="content-email__empty">No body content</p>
    <section v-if="attachments.length" class="content-email__parts" aria-label="Attachments">
      <h3>
        Attachments <span>{{ attachments.length }}</span>
      </h3>
      <ul>
        <li v-for="part in attachments" :key="part.block.id" class="content-email__part">
          <MimePartItem
            :content="part.solvedContent"
            :loading="materializing.has(part.block.id)"
            :error="materializeErrors.get(part.block.id)"
            @download="materialize(part.block.id)"
          />
        </li>
      </ul>
    </section>
    <details v-if="inlineParts.length" class="content-email__details">
      <summary>Inline content · {{ inlineParts.length }}</summary>
      <ul>
        <li v-for="part in inlineParts" :key="part.block.id" class="content-email__part">
          <MimePartItem
            :content="part.solvedContent"
            :loading="materializing.has(part.block.id)"
            :error="materializeErrors.get(part.block.id)"
            @download="materialize(part.block.id)"
          />
        </li>
      </ul>
    </details>
    <details v-if="conversations.length" class="content-email__details">
      <summary>Related messages · {{ conversations.length }}</summary>
      <ul>
        <li v-for="target in conversations" :key="target.block.id">
          <button
            type="button"
            class="content-email__message-link"
            @click="navigate(target.block.id)"
          >
            {{
              target.solvedContent.subject ||
              target.solvedContent.message_id ||
              `Message #${target.block.id}`
            }}
          </button>
        </li>
      </ul>
    </details>
  </article>
</template>

<style scoped lang="scss" src="./contentEmail.scss" />
