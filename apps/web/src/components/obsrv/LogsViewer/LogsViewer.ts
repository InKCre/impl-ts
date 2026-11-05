export const logsViewerProps = {
  /** Business Job correlation also includes legacy job.N log records. */
  jobId: { type: Number, default: undefined },
  traceId: { type: String, default: undefined },
  createdAt: { type: String, default: undefined },
  closedAt: { type: String, default: undefined },
  pollingInterval: { type: Number, default: 5000 },
  enablePolling: { type: Boolean, default: true },
}

export const logsViewerEmits = {} as const
