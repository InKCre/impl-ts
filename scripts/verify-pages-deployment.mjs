const deploymentId = process.env.CLOUDFLARE_PAGES_DEPLOYMENT_ID
const deploymentUrl = process.env.CLOUDFLARE_PAGES_DEPLOYMENT_URL
// Retain the old deployment variable for externally owned invocation scripts.
const productionUrl = process.env.INKCRE_WEB_ORIGIN ?? process.env.INKCRE_CLIENT_WEB_ORIGIN

if (!deploymentId) {
  throw new Error('Wrangler did not report a Cloudflare Pages deployment ID')
}
if (!deploymentUrl) {
  throw new Error('Wrangler did not report a Cloudflare Pages deployment URL')
}

const origin = new URL(deploymentUrl)
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.pages.dev')) {
  throw new Error(`unexpected Cloudflare Pages deployment URL: ${origin.origin}`)
}

async function readStaticPage(targetOrigin, path, attempts = 5) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(new URL(path, targetOrigin), {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
      const body = await response.text()
      if (!response.ok) {
        throw new Error(`Pages smoke ${path} returned HTTP ${response.status}`)
      }
      if (!response.headers.get('content-type')?.startsWith('text/html')) {
        throw new Error(`Pages smoke ${path} did not return HTML`)
      }
      if (!body.includes('<div id="app"></div>')) {
        throw new Error(`Pages smoke ${path} did not return the web shell`)
      }
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  throw lastError
}

await readStaticPage(origin, '/')
await readStaticPage(origin, '/__inkcre_pages_spa_smoke')

if (productionUrl) {
  const productionOrigin = new URL(productionUrl)
  if (productionOrigin.protocol !== 'https:') {
    throw new Error(`unexpected production origin: ${productionOrigin.origin}`)
  }
  await readStaticPage(productionOrigin, '/', 60)
  await readStaticPage(productionOrigin, '/__inkcre_pages_spa_smoke', 60)
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Cloudflare Pages deployment',
      '',
      `- Deployment ID: \`${deploymentId}\``,
      `- URL: ${origin.origin}`,
      ...(productionUrl ? [`- Production URL: ${new URL(productionUrl).origin}`] : []),
      `- Root and SPA fallback smoke: passed`,
      '',
    ].join('\n')
  )
}
