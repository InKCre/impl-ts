import {
  DBAPIClient,
  CORE_SDK_VERSION,
  ExtensionRegistryOriginResolver,
  Peer,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
  type ExtensionRuntimeStatus,
} from '@inkcre/core'
import { RegistryReleaseReader, sortPublishedReleases } from '@inkcre/extension-runtime-client-web'

export class RegistryConfigurationError extends Error {}

/** Remote process defaults are not observable from a browser. */
export function configuredRegistry(
  peerOverride: unknown,
  deployment: { schema: string; value: unknown } | null
): string {
  let value = peerOverride
  if (value == null || value === '') {
    if (deployment && deployment.schema !== 'extension.registry.config.v1')
      throw new RegistryConfigurationError()
    value =
      deployment?.value && typeof deployment.value === 'object'
        ? (deployment.value as Record<string, unknown>).extension_registry_url
        : null
  }
  if (typeof value !== 'string' || !value.trim()) throw new RegistryConfigurationError()
  return value
}

export function runtimeFailed(status: ExtensionRuntimeStatus | null): boolean {
  return !!status && (!!status.error || status.operation === 'failed')
}
export function waitingForRuntime(status: ExtensionRuntimeStatus | null): boolean {
  return (
    !!status &&
    !runtimeFailed(status) &&
    (status.restart_required ||
      ['downloading', 'applying', 'restarting'].includes(status.operation ?? ''))
  )
}

/** Concurrent writers remain governed by the target protocol; this is not a compare-and-set.
 * An explicit setup action may select a release; it preserves an observed pin and never enables it. */
export async function ensureExtensionSelection(
  peer: Peer,
  extension: string,
  distribution: 'python' | 'module_federation'
): Promise<ExtensionRuntimeStatus> {
  const observed = await readExtensionPeerStatus(peer.id, extension)
  if (!observed.supported_distributions.includes(distribution))
    throw new Error(`${distribution} is not supported.`)
  const existing = observed.extensions.find((item) => item.name === extension) ?? null
  if (existing) {
    if (runtimeFailed(existing) || waitingForRuntime(existing)) return existing
    if (existing.version) {
      if (existing.distribution !== distribution)
        throw new Error(`The selected distribution is not ${distribution}.`)
      return existing
    }
  }
  const override = peer.config.extension_registry_url
  let deployment = null
  if (override == null || override === '') {
    const response = await new DBAPIClient<'configs'>('configs')
      .from()
      .select('schema,value')
      .eq('key', 'extension.registry')
      .maybeSingle()
    if (response.error) throw new Error('Unable to read deployment Registry configuration.')
    deployment = response.data
  }
  const configured = configuredRegistry(override, deployment)
  const registryOrigin = await new ExtensionRegistryOriginResolver(() => configured).resolve()
  const reader = new RegistryReleaseReader({
    registryOrigin,
    hostSdk: { name: '@inkcre/core', version: CORE_SDK_VERSION },
  })
  const release = sortPublishedReleases(
    (await reader.getExtension(extension, distribution)).releases ?? []
  )[0]
  if (!release) throw new Error(`No published ${distribution} release.`)
  return manageExtensionOnPeer(peer.id, {
    action: 'select',
    extension,
    distribution,
    version: release.version,
  })
}
