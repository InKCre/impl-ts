<script setup lang="ts">
import ObservationExplorer from '../ObservationExplorer/ObservationExplorer.vue'
import { logsViewerEmits, logsViewerProps } from './LogsViewer'

const props = defineProps(logsViewerProps)
defineEmits(logsViewerEmits)
</script>

<template>
  <ObservationExplorer
    embedded
    :job-id="props.jobId"
    :trace-id="props.traceId"
    :since="props.since"
    :enable-polling="props.enablePolling"
    :polling-interval="props.pollingInterval"
  />
</template>
