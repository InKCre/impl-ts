import type { ExtensionRuntimeStatus, InstalledExtension } from '@inkcre/core'

import { runtimeFailed, waitingForRuntime } from '@inkcre/ext-dev-utils/selection'
export {
  configuredRegistry,
  RegistryConfigurationError,
  runtimeFailed,
  waitingForRuntime,
} from '@inkcre/ext-dev-utils/selection'

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
