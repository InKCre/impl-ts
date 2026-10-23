import { APIError, MetaConfigSchema, WebPeerRuntime, signDatabaseToken } from '@inkcre/core'
import { WebMaterialClient } from '@inkcre/web-collection/client'
import { browser } from 'wxt/browser'
import { siteMatchPattern } from './permissions'
import type { Connection } from './store'

export { APIError as DatabaseFailure }
export function databaseURL(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('请填写不含账号、查询参数或片段的 PostgREST HTTP(S) 地址。')
  return url.href.replace(/\/$/, '')
}
export function materialClient(target: Connection): WebMaterialClient {
  return new WebMaterialClient(target.url, () => signDatabaseToken(target.secret))
}
const peers = new Map<
  string,
  { target: Connection; runtime: WebPeerRuntime; pending?: Promise<void>; error?: string }
>()
export function peerErrors(): Record<string, string> {
  return Object.fromEntries(
    [...peers].filter(([, peer]) => peer.error).map(([id, peer]) => [id, peer.error!])
  )
}
/** Registration is presence information, not permission to use the database. */
export function refreshPeer(target: Connection): Promise<void> {
  let peer = peers.get(target.id)
  if (
    !peer ||
    peer.target.url !== target.url ||
    peer.target.secret !== target.secret ||
    peer.target.peerId !== target.peerId
  ) {
    peer = {
      target,
      runtime: WebPeerRuntime.forConnection(
        MetaConfigSchema.parse({
          INKCRE_PGREST_URL: target.url,
          INKCRE_JWT_SECRET: target.secret,
          INKCRE_PEER_ID: target.peerId,
        }),
        { defaultName: 'InKCre WebExt', applicationVersion: browser.runtime.getManifest().version }
      ),
    }
    peers.set(target.id, peer)
  }
  const current = peer
  current.pending ??= (async () => {
    try {
      if (!(await browser.permissions.contains({ origins: [siteMatchPattern(target.url)] })))
        throw new Error('尚未取得数据库地址的访问权限，请检查连接并授权。')
      await current.runtime.register()
      await current.runtime.renew()
      current.error = undefined
    } catch (error) {
      current.error =
        error instanceof APIError && error.response?.code === 'PGRST301'
          ? '信息库认证失败（PGRST301）：当前地址未接受此密钥签发的 JWT。'
          : error instanceof Error
            ? error.message
            : String(error)
    }
  })().finally(() => {
    current.pending = undefined
  })
  return current.pending
}
