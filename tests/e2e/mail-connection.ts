import type { Page } from '@playwright/test'
import { SignJWT } from 'jose'

export function mailDatabaseToken(secret: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(secret))
}

export async function connectMailHost(
  page: Page,
  connection: { postgrestUrl: string; jwtSecret: string; browserPeer: string }
): Promise<void> {
  await page.addInitScript(
    ({ origin, postgrestUrl, jwtSecret, browserPeer }) => {
      if (window !== window.top || location.origin !== origin) return
      const previous = JSON.parse(localStorage.getItem('inkcre_app_config') ?? '{}')
      if (previous.INKCRE_PEER_ID === browserPeer) return
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({
          INKCRE_PGREST_URL: postgrestUrl,
          INKCRE_JWT_SECRET: jwtSecret,
          INKCRE_PEER_ID: browserPeer,
        })
      )
    },
    { ...connection, origin: new URL(process.env.INKCRE_E2E_WEB_URL!).origin }
  )
}
