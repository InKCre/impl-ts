import { configStore } from '../config'
import { signDatabaseToken } from '../auth/sign'
import { ObservabilityClient } from './client'

/** The compatibility entry snapshots App selection; the SDK constructor stays explicit. */
export function createObservabilityClient(): ObservabilityClient {
  const { INKCRE_PGREST_URL, INKCRE_JWT_SECRET } = configStore.metaConfig
  return new ObservabilityClient({
    baseUrl: INKCRE_PGREST_URL,
    tokenProvider: () => signDatabaseToken(INKCRE_JWT_SECRET),
  })
}
