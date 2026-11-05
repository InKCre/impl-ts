import { OBSERVATION_MAX_WINDOW_MS } from '@inkcre/core'

export interface ObservationExplorerProps {
  embedded?: boolean
  jobId?: number
  traceId?: string
  jobCreatedAt?: string
  jobClosedAt?: string
  enablePolling?: boolean
  pollingInterval?: number
}

const hour = 60 * 60 * 1000

/** Job state and observation timestamps can come from different Peer clocks. */
export function defaultObservationWindow(
  now: number,
  hours: number,
  jobCreatedAt?: string,
  jobClosedAt?: string
): { since: string; until: string; limited: boolean } {
  let until = now
  let since = now - hours * hour
  if (jobCreatedAt) {
    const created = Date.parse(jobCreatedAt)
    const end = jobClosedAt ? Date.parse(jobClosedAt) : now
    until = Math.max(created, end) + hour
    since = Math.min(created, end) - hour
  }
  const limited = until - since > OBSERVATION_MAX_WINDOW_MS
  since = Math.max(since, until - OBSERVATION_MAX_WINDOW_MS)
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString(), limited }
}
