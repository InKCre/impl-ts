import { SignJWT } from 'jose'
import { peerJwtContract } from '../database'
import { DEFAULT_PEER_JWT_LIFETIME_SECONDS } from './defaults'

const JWT_CLOCK_SKEW_SECONDS = 5

export async function signDatabaseToken(jwtSecret: string): Promise<string> {
  if (!jwtSecret) throw new Error('JWT_SECRET not configured')

  const secret = new TextEncoder().encode(jwtSecret)
  // A Peer and its PostgREST boundary may not share an exact wall clock.
  const issuedAt = Math.floor(Date.now() / 1000) - JWT_CLOCK_SKEW_SECONDS
  return new SignJWT({ role: peerJwtContract.role })
    .setProtectedHeader({ alg: peerJwtContract.algorithm })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + DEFAULT_PEER_JWT_LIFETIME_SECONDS)
    .setIssuer(peerJwtContract.issuer)
    .setAudience(peerJwtContract.audience)
    .sign(secret)
}
