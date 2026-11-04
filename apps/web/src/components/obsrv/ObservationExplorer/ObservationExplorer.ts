export interface ObservationExplorerProps {
  embedded?: boolean
  jobId?: number
  traceId?: string
  since?: string
  enablePolling?: boolean
  pollingInterval?: number
}
