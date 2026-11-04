import { configStore } from '../config'
import { createObservabilityClient } from './app'
import type { ObservabilityClient } from './client'
import type { ObservationRecord } from './contracts'

export interface ObservationRecorder {
  client: ObservabilityClient
  peerId: string
}

const pending = new Set<Promise<void>>()
let warned = false
let current: { url: string; secret: string; recorder: ObservationRecorder } | undefined

export function resetObservationRecorder(): void {
  current = undefined
}

/** Capture App ownership before await; callers must retain this recorder for their operation. */
export function captureObservationRecorder(): ObservationRecorder | undefined {
  const meta = configStore.metaConfig
  if (!meta.INKCRE_PGREST_URL) return undefined
  if (
    current?.url === meta.INKCRE_PGREST_URL &&
    current.secret === meta.INKCRE_JWT_SECRET &&
    current.recorder.peerId === meta.INKCRE_PEER_ID
  )
    return current.recorder
  if (pending.size >= 128) return undefined
  const recorder = { client: createObservabilityClient(), peerId: meta.INKCRE_PEER_ID }
  current = { url: meta.INKCRE_PGREST_URL, secret: meta.INKCRE_JWT_SECRET, recorder }
  const preparation = recorder.client
    .prepare()
    .catch(() => {
      if (!warned) console.warn('[Observability] Backend selection is unavailable.')
      warned = true
    })
    .finally(() => pending.delete(preparation))
  pending.add(preparation)
  return recorder
}

/** Diagnostic I/O is bounded and must not turn a completed business command into a failure. */
export function recordObservation(
  recorder: ObservationRecorder | undefined,
  record: ObservationRecord
): void {
  if (!recorder) return
  if (pending.size >= 128) {
    if (!warned) console.warn('[Observability] Recording queue is full; observations were dropped.')
    warned = true
    return
  }
  const completion = recorder.client
    .emit({
      ...record,
      attributes: { ...record.attributes, 'inkcre.peer.id': recorder.peerId },
    })
    .catch(() => {
      if (!warned)
        console.warn('[Observability] Recording failed; business work remains available.')
      warned = true
    })
    .finally(() => pending.delete(completion))
  pending.add(completion)
}

export async function flushObservations(): Promise<void> {
  await Promise.allSettled(pending)
}
