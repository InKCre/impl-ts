import { execFileSync } from 'node:child_process'
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { inspectBrowserArtifact } from './browser-runtime-contract.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const jsonOutput = process.argv.includes('--json')
const coreRoot = `${repoRoot}/packages/core`
const errors = []

try {
  execFileSync(process.execPath, ['scripts/check-local-runtime-contract.mjs'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  errors.push(`browser source contract failed: ${error.stderr?.toString() || error.message}`)
}

async function requireFile(path) {
  try {
    await access(path)
  } catch {
    errors.push(`missing build output: ${path.slice(repoRoot.length + 1)}`)
  }
}

await Promise.all(
  [
    'packages/core/dist/index.js',
    'packages/core/dist/index.js.map',
    'packages/core/dist/index.d.ts',
    'packages/core/dist/index.d.ts.map',
    'apps/client-web/dist/index.html',
    'apps/client-webext/.output/chrome-mv3/manifest.json',
    'apps/client-webext/.output/chrome-mv3/content-scripts/content.js',
    'apps/client-webext/.output/chrome-mv3/content-scripts/content.css',
    'extensions/github/dist/client-web/remoteEntry.js',
    'extensions/caldav/dist/client-web/remoteEntry.js',
    'extensions/capture/dist/client-web/remoteEntry.js',
    'extensions/local-files/dist/client-web/remoteEntry.js',
    'extensions/mail/dist/client-web/remoteEntry.js',
    'extensions/memos/dist/client-web/remoteEntry.js',
    'extensions/twitter/dist/client-web/remoteEntry.js',
  ].map((path) => requireFile(`${repoRoot}/${path}`))
)

const twitterRemoteEntry = `${repoRoot}/extensions/twitter/dist/client-web/remoteEntry.js`
try {
  const content = await readFile(twitterRemoteEntry, 'utf8')
  if (content.includes('/twitter/client-web/')) {
    errors.push('Twitter remote entry retains an absolute /twitter/client-web/ artifact base')
  }
  if (!content.includes('./assets/')) {
    errors.push(
      'Twitter remote entry does not reference its chunks through a relative artifact base'
    )
  }
} catch (error) {
  errors.push(`Twitter remote entry inspection failed: ${error.message}`)
}

try {
  await access(`${coreRoot}/dist/index.cjs`)
  errors.push('unexpected CommonJS output: packages/core/dist/index.cjs')
} catch {
  // ESM-only is the intended package contract.
}

async function builtFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await builtFiles(path)))
    } else {
      files.push(path)
    }
  }

  return files
}

const webDist = `${repoRoot}/apps/client-web/dist`
const webextDist = `${repoRoot}/apps/client-webext/.output/chrome-mv3`
try {
  await access(`${webDist}/_worker.js`)
  errors.push('unexpected Worker output: apps/client-web/dist/_worker.js')
} catch {
  // The web application is a static Pages artifact.
}

for (const [label, directory] of [
  ['static web', webDist],
  ['browser extension', webextDist],
]) {
  try {
    const files = await builtFiles(directory)
    for (const file of files) {
      if (!/\.(?:css|html|js|json|map)$/.test(file)) {
        continue
      }

      const content = await readFile(file, 'utf8')
      for (const reason of inspectBrowserArtifact(content)) {
        errors.push(`${label} output contains ${reason}: ${file.slice(repoRoot.length + 1)}`)
      }
    }
  } catch (error) {
    errors.push(`${label} artifact inspection failed: ${error.message}`)
  }
}

const packageJson = JSON.parse(await readFile(`${coreRoot}/package.json`, 'utf8'))
const expectedImport = './dist/index.js'
const expectedTypes = './dist/index.d.ts'
if (
  packageJson.main !== expectedImport ||
  packageJson.module !== expectedImport ||
  packageJson.types !== expectedTypes ||
  packageJson.exports?.['.']?.import !== expectedImport ||
  packageJson.exports?.['.']?.types !== expectedTypes ||
  packageJson.exports?.['.']?.require
) {
  errors.push('packages/core/package.json does not match the ESM-only dist contract')
}

const consumerPackage = `${repoRoot}/apps/client-web/node_modules/@inkcre/core`
try {
  const resolvedPackage = await realpath(consumerPackage)
  const expectedPackage = await realpath(coreRoot)
  if (resolvedPackage !== expectedPackage) {
    errors.push(`@inkcre/core workspace link resolves to unexpected path: ${resolvedPackage}`)
  }
} catch (error) {
  errors.push(`@inkcre/core workspace resolution failed: ${error.message}`)
}

try {
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', "await import('@inkcre/core')"],
    {
      cwd: `${repoRoot}/apps/client-web`,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }
  )
} catch (error) {
  errors.push(`@inkcre/core ESM consumer smoke failed: ${error.message}`)
}

const result = {
  ok: errors.length === 0,
  package: '@inkcre/core',
  format: 'esm',
  entry: 'packages/core/dist/index.js',
  types: 'packages/core/dist/index.d.ts',
  errors,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  console.log(
    '[OK] browser artifacts are environment-neutral and @inkcre/core resolves through its ESM dist contract'
  )
} else {
  for (const error of errors) {
    console.error(`[ERROR] ${error}`)
  }
}

process.exitCode = result.ok ? 0 : 1
