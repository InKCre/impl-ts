<script setup lang="ts">
import { getInfoBaseRouter, type SolvedContentRendererProps } from '@inkcre/core'
import { InkButton } from '@inkcre/ui-web'
import { safeHttpUrl, type CalendarDate, type DAVContent } from './content'
import { useText } from './locale'

defineProps<SolvedContentRendererProps<DAVContent>>()
const tr = useText()
function displayDate(value: CalendarDate) {
  const zone = value.zone === 'floating' ? tr('No time zone', '未指定时区') : value.zone
  return [value.value, zone].filter(Boolean).join(' · ')
}
function label(name: string) {
  const labels: Record<string, [string, string]> = {
    tel: ['Phone', '电话'],
    email: ['Email', '邮箱'],
    adr: ['Address', '地址'],
    org: ['Organization', '组织'],
    title: ['Job title', '职务'],
    bday: ['Birthday', '生日'],
    note: ['Notes', '备注'],
    url: ['Website', '网站'],
  }
  const value = labels[name]
  return value ? tr(...value) : name
}
function status(value: string) {
  const labels: Record<string, [string, string]> = {
    COMPLETED: ['Completed', '已完成'],
    'NEEDS-ACTION': ['Not completed', '未完成'],
    'IN-PROCESS': ['In progress', '进行中'],
    CANCELLED: ['Cancelled', '已取消'],
    CONFIRMED: ['Confirmed', '已确认'],
    TENTATIVE: ['Tentative', '暂定'],
  }
  return labels[value] ? tr(...labels[value]) : value
}
</script>

<template>
  <article class="dav-content">
    <p v-if="solvedContent.kind === 'invalid'" role="alert">
      {{
        tr(
          'This record could not be parsed. Its original content remains available below.',
          '无法解析此记录。完整原文仍保留在下方。'
        )
      }}
    </p>

    <template v-else-if="solvedContent.kind === 'calendar'">
      <section v-for="(item, index) in solvedContent.items" :key="index" class="calendar-item">
        <header>
          <p class="muted">
            {{ item.kind === 'vtodo' ? tr('Task', '任务') : tr('Event', '日程')
            }}<span v-if="item.recurrenceId"> · {{ tr('Recurrence exception', '重复例外') }}</span
            ><span v-else-if="item.recurrence.length">
              · {{ tr('Recurring series', '重复系列') }}</span
            >
          </p>
          <h2>{{ item.title || tr('Untitled', '未命名') }}</h2>
          <p v-if="item.status">{{ status(item.status) }}</p>
        </header>
        <dl>
          <template v-if="item.start"
            ><dt>
              {{
                item.start.dateOnly ? tr('Starts · all day', '开始 · 全天') : tr('Starts', '开始')
              }}
            </dt>
            <dd>{{ displayDate(item.start) }}</dd></template
          >
          <template v-if="item.end"
            ><dt>
              {{
                item.end.dateOnly ? tr('Ends · exclusive', '结束 · 不含该日') : tr('Ends', '结束')
              }}
            </dt>
            <dd>{{ displayDate(item.end) }}</dd></template
          >
          <template v-if="item.duration"
            ><dt>{{ tr('Duration', '时长') }}</dt>
            <dd>{{ item.duration }}</dd></template
          >
          <template v-if="item.due"
            ><dt>{{ tr('Due', '到期') }}</dt>
            <dd>{{ displayDate(item.due) }}</dd></template
          >
          <template v-if="item.completed"
            ><dt>{{ tr('Completed', '完成时间') }}</dt>
            <dd>{{ displayDate(item.completed) }}</dd></template
          >
          <template v-if="item.recurrenceId"
            ><dt>{{ tr('Original occurrence', '原始发生时间') }}</dt>
            <dd>{{ displayDate(item.recurrenceId) }}</dd></template
          >
          <template v-if="item.location"
            ><dt>{{ tr('Location', '地点') }}</dt>
            <dd>{{ item.location }}</dd></template
          >
          <template v-if="item.priority && item.priority !== '0'"
            ><dt>{{ tr('Priority · 1 highest, 9 lowest', '优先级 · 1 最高，9 最低') }}</dt>
            <dd>{{ item.priority }}</dd></template
          >
          <template v-if="item.progress"
            ><dt>{{ tr('Progress', '完成进度') }}</dt>
            <dd>{{ item.progress }}%</dd></template
          >
          <template v-if="item.recurrence.length"
            ><dt>{{ tr('Recurrence rule', '重复规则') }}</dt>
            <dd>
              <div v-for="rule in item.recurrence" :key="rule">{{ rule }}</div>
            </dd></template
          >
          <template v-if="item.excluded.length"
            ><dt>{{ tr('Excluded dates', '排除日期') }}</dt>
            <dd>
              <div v-for="value in item.excluded" :key="value">{{ value }}</div>
            </dd></template
          >
          <template v-if="item.added.length"
            ><dt>{{ tr('Additional dates', '补充日期') }}</dt>
            <dd>
              <div v-for="value in item.added" :key="value">{{ value }}</div>
            </dd></template
          >
          <template v-if="item.alarms.length"
            ><dt>{{ tr('Reminders', '提醒') }}</dt>
            <dd>
              <div v-for="value in item.alarms" :key="value">{{ value }}</div>
            </dd></template
          >
          <template v-if="item.parents.length"
            ><dt>{{ tr('Related task UID', '关联任务 UID') }}</dt>
            <dd>
              <div v-for="value in item.parents" :key="value">{{ value }}</div>
            </dd></template
          >
        </dl>
        <p v-if="item.description" class="description">{{ item.description }}</p>
        <a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer">{{
          item.url
        }}</a>
      </section>
    </template>

    <template v-else-if="solvedContent.kind === 'contact'">
      <header class="contact-header">
        <img
          v-if="solvedContent.photo"
          :src="solvedContent.photo"
          :alt="tr('Contact photo', '联系人照片')"
          width="80"
          height="80"
        />
        <h2>{{ solvedContent.title || tr('Unnamed contact', '未命名联系人') }}</h2>
      </header>
      <dl>
        <template v-for="field in solvedContent.fields" :key="field.name">
          <dt>{{ label(field.name) }}</dt>
          <dd>
            <div v-for="(value, index) in field.values" :key="index">
              <a
                v-if="field.name === 'url' && safeHttpUrl(value.value)"
                :href="safeHttpUrl(value.value)!"
                target="_blank"
                rel="noopener noreferrer"
                >{{ value.value }}</a
              >
              <span v-else class="description">{{ value.value }}</span>
              <small v-if="value.label" class="muted"> · {{ value.label }}</small>
            </div>
          </dd>
        </template>
      </dl>
      <a
        v-if="solvedContent.photoLink"
        :href="solvedContent.photoLink"
        target="_blank"
        rel="noopener noreferrer"
        >{{ tr('Open remote contact photo', '打开外部联系人照片') }}</a
      >
    </template>

    <template v-else-if="solvedContent.kind === 'collection'">
      <header>
        <p class="muted">
          {{
            solvedContent.tag === 'VADDRESSBOOK'
              ? tr('Address book', '通讯录')
              : solvedContent.tag === 'VCALENDAR'
                ? solvedContent.components === 'VTODO'
                  ? tr('Task list', '任务列表')
                  : tr('Calendar', '日历')
                : tr('DAV account', 'DAV 账户')
          }}
        </p>
        <h2>{{ solvedContent.title }}</h2>
      </header>
      <p v-if="solvedContent.description" class="description">{{ solvedContent.description }}</p>
      <p>{{ solvedContent.members.length }} {{ tr('items', '项内容') }}</p>
      <ul v-if="solvedContent.members.length" class="members">
        <li v-for="member in solvedContent.members" :key="member.id">
          <InkButton
            :text="member.title || tr('Untitled item', '未命名内容')"
            @click="getInfoBaseRouter().push({ name: 'solved-content', block: member.id })"
          />
        </li>
      </ul>
    </template>

    <details>
      <summary>{{ tr('Original content', '完整原文') }}</summary>
      <pre>{{ solvedContent.text }}</pre>
    </details>
  </article>
</template>

<style scoped>
.dav-content {
  display: grid;
  gap: 1.25rem;
  min-width: 0;
  max-width: 48rem;
  overflow-wrap: anywhere;
  color: var(--sys-color-text-base);
}
header,
.calendar-item {
  display: grid;
  gap: 0.6rem;
}
h2,
p {
  margin: 0;
}
h2 {
  font-size: var(--sys-font-title-lg-font-size);
}
.muted,
dt {
  color: var(--sys-color-text-subtle);
}
.calendar-item + .calendar-item {
  padding-top: 1.25rem;
  border-top: 1px solid var(--sys-color-border-base);
}
dl {
  display: grid;
  grid-template-columns: minmax(7rem, max-content) minmax(0, 1fr);
  gap: 0.6rem 1rem;
  margin: 0;
}
dd {
  margin: 0;
}
.description,
pre {
  white-space: pre-wrap;
}
.contact-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.contact-header img {
  object-fit: contain;
  border-radius: 0.5rem;
}
summary {
  cursor: pointer;
}
pre {
  overflow-wrap: anywhere;
  font-size: 0.85rem;
}
.members {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.4rem;
  justify-items: start;
}
@media (max-width: 480px) {
  dl {
    grid-template-columns: 1fr;
    gap: 0.3rem;
  }
  dd {
    margin-bottom: 0.5rem;
  }
}
</style>
