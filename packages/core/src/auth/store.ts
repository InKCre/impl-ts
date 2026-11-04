import { ref, watch } from 'vue'
import { configStore } from '../config'

import { signDatabaseToken } from './sign'
export { signDatabaseToken } from './sign'

/**
 * Create an auth store instance.
 * Returns reactive token and token management functions.
 */
export function createAuthStore(configStoreIns = configStore) {
  const token = ref<string | undefined>(undefined)

  async function newToken(): Promise<string> {
    try {
      const signedToken = await signDatabaseToken(configStoreIns.metaConfig.INKCRE_JWT_SECRET)

      token.value = signedToken
      return signedToken
    } catch (error) {
      console.error('[Auth] Failed to sign a new token:', error)
      throw new Error('Failed to sign a new token')
    }
  }

  async function getToken(): Promise<string> {
    if (!token.value) {
      return await newToken()
    }
    return token.value
  }

  async function refreshToken(): Promise<string> {
    return await newToken()
  }

  // Watch for JWT secret changes and regenerate token
  watch(
    () => configStoreIns.metaConfig.INKCRE_JWT_SECRET,
    async (newSecret) => {
      if (newSecret) {
        try {
          await newToken()
        } catch (error) {
          console.error('[Auth] Failed to generate token on secret change:', error)
        }
      } else {
        token.value = undefined
      }
    },
    { immediate: true }
  )

  return {
    token,
    newToken,
    getToken,
    refreshToken,
  }
}

/**
 * Global auth store singleton.
 * All applications share this instance for authentication.
 */
export const authStore = createAuthStore()
