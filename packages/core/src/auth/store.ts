import { decodeJwt } from 'jose'
import { ref, watch } from 'vue'
import { configStore } from '../config'

import { signDatabaseToken } from './sign'
export { signDatabaseToken } from './sign'

const token = ref<string | undefined>(undefined)
let signingSecret: string | undefined
let expiresAt = 0

async function newToken(): Promise<string> {
  const secret = configStore.metaConfig.INKCRE_JWT_SECRET
  try {
    const signedToken = await signDatabaseToken(secret)

    if (secret === configStore.metaConfig.INKCRE_JWT_SECRET) {
      signingSecret = secret
      expiresAt = decodeJwt<{ exp: number }>(signedToken).exp * 1000
      token.value = signedToken
    }
    return signedToken
  } catch (error) {
    console.error('[Auth] Failed to sign a new token:', error)
    throw new Error('Failed to sign a new token')
  }
}

async function getToken(): Promise<string> {
  if (
    !token.value ||
    signingSecret !== configStore.metaConfig.INKCRE_JWT_SECRET ||
    Date.now() >= expiresAt
  ) {
    return await newToken()
  }
  return token.value
}

async function refreshToken(): Promise<string> {
  return await newToken()
}

// Watch for JWT secret changes and regenerate token
watch(
  () => configStore.metaConfig.INKCRE_JWT_SECRET,
  async (newSecret) => {
    token.value = undefined
    signingSecret = undefined
    if (!newSecret) return
    try {
      await newToken()
    } catch (error) {
      console.error('[Auth] Failed to generate token on secret change:', error)
    }
  },
  { immediate: true }
)

export const authStore = { token, newToken, getToken, refreshToken }
