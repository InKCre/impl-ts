import { decodeJwt } from 'jose'
import { ref, watch } from 'vue'
import { configStore } from '../config'

import { signDatabaseToken } from './sign'
export { signDatabaseToken } from './sign'

/** Create reactive authentication for the currently selected connection. */
export function createAuthStore(configStoreIns = configStore) {
  const token = ref<string | undefined>(undefined)
  let current = snapshot()

  function snapshot() {
    return {
      baseUrl: configStoreIns.metaConfig.INKCRE_PGREST_URL,
      secret: configStoreIns.metaConfig.INKCRE_JWT_SECRET,
      expiresAt: 0,
      pending: undefined as Promise<string> | undefined,
    }
  }

  function assertCurrent(connection: typeof current, requestUrl?: string) {
    if (connection !== current)
      throw new Error('Database connection changed during authentication.')
    if (!requestUrl) return
    if (!connection.baseUrl) throw new Error('PostgREST URL is not configured.')
    const base = new URL(connection.baseUrl)
    const target = new URL(requestUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    const matchesPath = target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)
    if (target.origin !== base.origin || !matchesPath) {
      throw new Error('Database request does not match the selected connection.')
    }
  }

  async function sign(connection: typeof current): Promise<string> {
    token.value = undefined
    connection.expiresAt = 0
    try {
      const signedToken = await signDatabaseToken(connection.secret)
      assertCurrent(connection)
      const { exp } = decodeJwt(signedToken)
      if (typeof exp !== 'number') throw new Error('Database token has no expiration.')
      connection.expiresAt = exp * 1000
      token.value = signedToken
      return signedToken
    } catch {
      // Signing failures must not retain a usable cache or expose signing credentials.
      throw new Error('Failed to sign a new token')
    }
  }

  async function newToken(): Promise<string> {
    const connection = current
    if (!connection.pending) {
      connection.pending = sign(connection).finally(() => {
        connection.pending = undefined
      })
    }
    return connection.pending
  }

  async function getToken(): Promise<string> {
    const connection = current
    const signedToken =
      token.value && Date.now() < connection.expiresAt ? token.value : await newToken()
    // A connection can change while WebCrypto signs or another caller awaits the same promise.
    assertCurrent(connection)
    return signedToken
  }

  function requestAuthorizer() {
    const connection = current
    return async (requestUrl: string) => {
      const assertRequestConnection = () => assertCurrent(connection, requestUrl)
      assertRequestConnection()
      const signedToken = await getToken()
      return { token: signedToken, assertCurrent: assertRequestConnection }
    }
  }

  async function refreshToken(): Promise<string> {
    return newToken()
  }

  watch(
    () => [
      configStoreIns.metaConfig.INKCRE_PGREST_URL,
      configStoreIns.metaConfig.INKCRE_JWT_SECRET,
    ],
    () => {
      current = snapshot()
      token.value = undefined
    },
    { flush: 'sync' }
  )

  return { token, newToken, getToken, refreshToken, requestAuthorizer }
}

/** Global authentication for the application-selected connection. */
export const authStore = createAuthStore()
