import type { ExtensionRuntimeStatus, InstalledExtension } from '@inkcre/core'

export class RegistryConfigurationError extends Error {}

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
  // A remote Python Peer's process-level default is not observable from the browser.
  return value
}

export function savedPassword(extension: InstalledExtension): string | null {
  const value = extension.config.password
  if (value == null) return null
  if (typeof value !== 'string' || Array.from(value).length < 32 || Array.from(value).length > 128)
    throw new Error('Invalid DAV password configuration.')
  return value
}

export function generatePassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
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

export function runtimeReady(status: ExtensionRuntimeStatus | null): boolean {
  return (
    !!status &&
    status.enabled &&
    status.running &&
    !waitingForRuntime(status) &&
    !!status.version &&
    status.loaded_version === status.version &&
    !runtimeFailed(status)
  )
}
