const deploymentId = process.env.CLOUDFLARE_PAGES_DEPLOYMENT_ID
const deploymentUrl = process.env.CLOUDFLARE_PAGES_DEPLOYMENT_URL
const productionUrl = process.env.INKCRE_CLIENT_WEB_ORIGIN
const expectedPagesOrigin = process.env.INKCRE_EXPECTED_PAGES_ORIGIN
const previewProducer = process.env.INKCRE_PREVIEW_PRODUCER

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
if (expectedPagesOrigin && origin.origin !== new URL(expectedPagesOrigin).origin) {
  throw new Error(
    `Pages returned ${origin.origin}, expected deterministic alias ${new URL(expectedPagesOrigin).origin}`
  )
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
        throw new Error(`Pages smoke ${path} did not return the client-web shell`)
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

async function readPreviewResponse(path, attempts = 5) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(new URL(path, origin), {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        throw new Error(`Pages native smoke ${path} returned HTTP ${response.status}`)
      }
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }
  throw lastError
}

if (previewProducer) {
  const { readFile } = await import('node:fs/promises')
  const producer = JSON.parse(await readFile(previewProducer, 'utf8'))
  const extensionName = producer.inkcre?.name
  const extensionVersion = producer.version
  if (typeof extensionName !== 'string' || typeof extensionVersion !== 'string') {
    throw new Error('preview producer is missing inkcre.name or version')
  }
  const [namespace, name] = extensionName.split('/')
  const releasePath = `/v2/extensions/${namespace}/${name}/distributions/module_federation/releases/${extensionVersion}`
  const release = await readPreviewResponse(releasePath).then((response) => response.json())
  if (release.name !== extensionName || release.version !== extensionVersion) {
    throw new Error('preview exact Release differs from its producer metadata')
  }
  const manifestPath = release.module_federation?.manifest_url
  if (typeof manifestPath !== 'string') {
    throw new Error('preview exact Release has no Module Federation manifest URL')
  }
  const manifest = await readPreviewResponse(manifestPath).then((response) => response.json())
  const distributionPrefix = new URL('.', new URL(manifestPath, origin)).href
  if (manifest.metaData?.publicPath !== distributionPrefix) {
    throw new Error('preview manifest publicPath does not use the deterministic Pages alias')
  }
  const remoteEntry = manifest.metaData?.remoteEntry
  const remoteEntryPath = [remoteEntry?.path, remoteEntry?.name].filter(Boolean).join('/')
  if (!remoteEntryPath) {
    throw new Error('preview manifest has no remote entry')
  }
  await readPreviewResponse(new URL(remoteEntryPath, distributionPrefix).pathname)
}

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
      ...(previewProducer ? ['- Exact Release, MF manifest, and remote entry smoke: passed'] : []),
      '',
    ].join('\n')
  )
}
