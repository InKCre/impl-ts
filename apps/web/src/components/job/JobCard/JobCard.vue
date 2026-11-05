<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { jobCardProps, jobCardEmits } from './JobCard'
import { JobStatus } from '@inkcre/core'
import dayjs from 'dayjs'

const props = defineProps(jobCardProps)
const emit = defineEmits(jobCardEmits)
const { t } = useI18n()

// --- computed ---
const statusColor = computed(() => {
  switch (props.job.status) {
    case JobStatus.TIMED_OUT:
    case JobStatus.FAILED:
      return 'status--failed'
    default:
      return ''
  }
})

// --- methods ---
const formatDate = (date: Date | null) => {
  if (!date) return t('job.notAvailable')
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

const onClick = () => {
  emit('click')
}
</script>

<template>
  <div class="job-card" @click="onClick">
    <div class="job-card__header">
      <span class="job-card__id">#{{ job.id }}</span>
      <span class="job-card__status" :class="statusColor">
        {{ job.status }}
      </span>
    </div>
    <div class="job-card__dates">
      <span class="job-card__date">
        {{ t('job.createdAt') }}: {{ formatDate(job.created_at) }}
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./JobCard.scss" />
