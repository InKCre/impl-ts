<script setup lang="ts">
import { computed } from 'vue'
import { getInfoBaseRouter, type SolvedContentRendererProps } from '@inkcre/core'
import { InkButton, InkPlaceholder } from '@inkcre/ui-web'
import type { SolvedMailingList } from '../schema'

const props = defineProps<SolvedContentRendererProps<SolvedMailingList>>()
const router = getInfoBaseRouter()
const issues = computed(() => {
  const groups = new Map<string, SolvedMailingList['emails']>()
  const emails = [...props.solvedContent.emails].sort(
    (left, right) =>
      (right.solvedContent.authored_at?.getTime() ?? 0) -
        (left.solvedContent.authored_at?.getTime() ?? 0) || left.block.id - right.block.id
  )
  for (const email of emails) {
    const root = email.solvedContent
    const key = root.message_id
      ? JSON.stringify([root.message_id, root.subject, root.authored_at])
      : `block:${email.block.id}`
    const copies = groups.get(key) ?? []
    copies.push(email)
    groups.set(key, copies)
  }
  return [...groups.values()].map((copies) => ({ email: copies[0]!, copies }))
})

function open(block: number): void {
  void router.push({ name: 'solved-content', block })
}
</script>

<template>
  <article class="mailing-list" aria-label="刊物归档">
    <header class="mailing-list__header">
      <div>
        <p class="mailing-list__eyebrow">刊物归档</p>
        <h2>{{ solvedContent.root.name || solvedContent.root.list_id }}</h2>
      </div>
      <p class="mailing-list__count">{{ issues.length }} 期</p>
    </header>
    <InkPlaceholder v-if="!issues.length" title="暂无已归档邮件" />
    <ol v-else class="mailing-list__issues" aria-label="各期邮件">
      <li v-for="{ email, copies } in issues" :key="email.block.id" class="mailing-list__issue">
        <button
          type="button"
          class="mailing-list__open"
          :aria-label="email.solvedContent.subject || '无主题'"
          :aria-describedby="`mail-issue-date-${email.block.id}`"
          @click="open(email.block.id)"
        >
          <span class="mailing-list__subject">{{ email.solvedContent.subject || '无主题' }}</span>
          <time
            v-if="email.solvedContent.authored_at"
            :id="`mail-issue-date-${email.block.id}`"
            :datetime="email.solvedContent.authored_at.toISOString()"
          >
            {{
              email.solvedContent.authored_at.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            }}
          </time>
          <span v-else :id="`mail-issue-date-${email.block.id}`" class="mailing-list__date"
            >日期未知</span
          >
          <span class="mailing-list__read" aria-hidden="true">阅读 <span>→</span></span>
        </button>
        <details v-if="copies.length > 1" class="mailing-list__copies">
          <summary>{{ copies.length }} 份投递副本</summary>
          <div class="mailing-list__copy-actions">
            <InkButton
              v-for="(copy, index) in copies"
              :key="copy.block.id"
              size="sm"
              :aria-label="`打开投递副本 ${index + 1}`"
              @click="open(copy.block.id)"
            >
              副本 {{ index + 1 }}
            </InkButton>
          </div>
        </details>
      </li>
    </ol>
    <details class="mailing-list__identity">
      <summary>刊物信息</summary>
      <dl>
        <dt>刊物标识</dt>
        <dd>{{ solvedContent.root.list_id }}</dd>
      </dl>
    </details>
  </article>
</template>

<style scoped lang="scss">
.mailing-list {
  container-type: inline-size;
  display: grid;
  gap: sys-var(space, lg);
  min-width: 0;
  overflow-wrap: anywhere;
  color: sys-var(color, text, base);
  @include apply-font(body-md);
  h2,
  p {
    margin: 0;
  }
  h2 {
    @include apply-font(title-lg);
  }
  &__header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: sys-var(space, lg);
    padding: sys-var(space, md);
  }
  &__eyebrow {
    @include apply-font(body-sm);
    color: sys-var(color, text, subtle);
    padding-bottom: sys-var(space, sm);
  }
  &__count {
    flex-shrink: 0;
    color: sys-var(color, text, subtle);
    font-variant-numeric: tabular-nums;
  }
  &__issues {
    list-style: none;
    margin: 0;
    padding: 0;
    border-bottom: 1px solid sys-var(color, border, subtle);
  }
  &__issue {
    border-top: 1px solid sys-var(color, border, subtle);
  }
  &__open {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: sys-var(space, lg);
    width: 100%;
    box-sizing: border-box;
    min-height: 5.5rem;
    padding: sys-var(space, lg) sys-var(space, md);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    &:hover {
      background: sys-var(color, surface, subtle);
      .mailing-list__subject {
        text-decoration: underline;
        text-underline-offset: 0.2em;
      }
    }
    &:focus-visible {
      outline: 2px solid sys-var(color, border, strong);
      outline-offset: -2px;
    }
  }
  &__subject {
    @include apply-font(title-sm);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  time,
  &__date,
  &__read {
    @include apply-font(body-sm);
    white-space: nowrap;
  }
  time,
  &__date {
    font-variant-numeric: tabular-nums;
    color: sys-var(color, text, subtle);
  }
  &__read span {
    margin-inline-start: sys-var(space, sm);
  }
  &__copies {
    margin: calc(-1 * #{sys-var(space, sm)}) sys-var(space, md) sys-var(space, lg);
    @include apply-font(body-sm);
  }
  &__copy-actions {
    display: flex;
    flex-wrap: wrap;
    gap: sys-var(space, sm);
    padding-top: sys-var(space, md);
  }
  &__identity {
    padding-inline: sys-var(space, md);
    @include apply-font(body-sm);
    dl {
      display: grid;
      gap: sys-var(space, sm);
      margin-bottom: 0;
    }
    dt {
      color: sys-var(color, text, subtle);
    }
    dd {
      margin: 0;
    }
  }
  summary {
    width: fit-content;
    cursor: pointer;
    color: sys-var(color, text, subtle);
    &:focus-visible {
      outline: 2px solid sys-var(color, border, strong);
      outline-offset: 4px;
    }
  }
}
@container (max-width: 560px) {
  .mailing-list__header {
    flex-direction: column;
    align-items: start;
    gap: sys-var(space, sm);
    h2 {
      @include apply-font(title-sm);
    }
  }
  .mailing-list__open {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: sys-var(space, sm) sys-var(space, md);
    time,
    .mailing-list__date {
      grid-column: 1;
      grid-row: 2;
    }
  }
  .mailing-list__read {
    grid-column: 2;
    grid-row: 1 / 3;
  }
}
</style>
