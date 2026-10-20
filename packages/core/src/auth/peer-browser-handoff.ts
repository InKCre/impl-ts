import { authStore } from './store'
import { PeerManager } from '../peer/manager'
import {
  PEER_BROWSER_FORM_PROTOCOL,
  PeerBrowserFormInboundParametersSchema,
} from '../peer/contracts'
import type { PeerRef } from '../peer/peer'

export type BrowserHandoffResult = { status: 'initiated'; peerRef: PeerRef }

type FormDocument = Pick<Document, 'body' | 'createElement'>

function targetForPeer(peerConfig: Record<string, unknown>, path: string): string {
  const baseValue = peerConfig.http_public_base_url
  if (typeof baseValue !== 'string') throw new Error('Selected Peer has no public HTTP base URL')

  let base: URL
  try {
    base = new URL(baseValue)
  } catch {
    throw new Error('Selected Peer has an invalid public HTTP base URL')
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('Selected Peer public base URL must be HTTPS without credentials or suffixes')
  }

  const target = new URL(base.origin)
  target.pathname = `${base.pathname.replace(/\/+$/, '')}${path}`
  if (
    target.origin !== base.origin ||
    !target.pathname.startsWith(base.pathname.replace(/\/+$/, ''))
  ) {
    throw new Error('Peer browser handoff route escaped its public base URL')
  }
  return target.toString()
}

export const PeerAuth = {
  /** Must be called only after an explicit user action; does not mean the Peer accepted the session. */
  async navigateWithCredential(
    peerRef: PeerRef,
    capability: string
  ): Promise<BrowserHandoffResult> {
    const { peer, advertisement } = await PeerManager.resolveLiveCapability(peerRef, capability)
    if (advertisement.inbound.protocol !== PEER_BROWSER_FORM_PROTOCOL) {
      throw new Error(`Capability ${capability} does not use browser form handoff`)
    }
    const parameters = PeerBrowserFormInboundParametersSchema.parse(
      advertisement.inbound.parameters
    )
    const action = targetForPeer(peer.config, parameters.path)
    const document = globalThis.document as FormDocument
    const credential = await authStore.refreshToken()
    if (!credential) throw new Error('Peer credential is unavailable')

    const form = document.createElement('form')
    form.method = parameters.method.toLowerCase()
    form.enctype = 'application/x-www-form-urlencoded'
    form.action = action
    form.target = '_top'
    const submit = form.submit.bind(form)

    const field = document.createElement('input')
    field.type = 'hidden'
    field.name = parameters.credential_field
    field.value = credential
    form.append(field)
    document.body.append(form)
    try {
      submit()
    } finally {
      form.remove()
    }

    return { status: 'initiated', peerRef }
  },
}
