import { execFileSync } from 'node:child_process'
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { inspectBrowserArtifact } from './browser-runtime-contract.mjs'
import { inspectNativeModuleFederation } from './verify-native-extension-distribution.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const jsonOutput = process.argv.includes('--json')
const coreRoot = `${repoRoot}/packages/core`
const errors = []

try {
  execFileSync(process.execPath, ['scripts/verify-web-release.mjs'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  errors.push(`static Web release failed: ${error.stderr?.toString() || error.message}`)
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
    'apps/webext/.output/chrome-mv3/manifest.json',
    'apps/webext/.output/chrome-mv3/content-scripts/collection.js',
    'apps/webext/.output/chrome-mv3/options.html',
    'apps/webext/.output/chrome-mv3/popup.html',
  ].map((path) => requireFile(`${repoRoot}/${path}`))
)

for (const entry of await readdir(`${repoRoot}/extensions`, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = `${repoRoot}/extensions/${entry.name}`
  let metadata
  try {
    metadata = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') continue
    throw error
  }
  try {
    await inspectNativeModuleFederation({
      packagePath: `${directory}/package.json`,
      corePackagePath: `${coreRoot}/package.json`,
      artifactDirectory: `${directory}/dist/web`,
    })
    if (entry.name === 'twitter') {
      const manifest = JSON.parse(await readFile(`${directory}/dist/web/mf-manifest.json`, 'utf8'))
      if (!manifest.shared?.some((shared) => shared.name === '@inkcre/ui-web')) {
        errors.push('Twitter UI components must share @inkcre/ui-web with the Host')
      }
    }
  } catch (error) {
    errors.push(`${metadata.name} native distribution inspection failed: ${error.message}`)
  }
}

const twitterRemoteEntry = `${repoRoot}/extensions/twitter/dist/web/remoteEntry.js`
try {
  const content = await readFile(twitterRemoteEntry, 'utf8')
  if (/\/twitter\/(?:client-web|web)\//.test(content)) {
    errors.push('Twitter remote entry retains an absolute application artifact base')
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

try {
  const files = await builtFiles(`${repoRoot}/apps/webext/.output/chrome-mv3`)
  for (const file of files) {
    if (!/\.(?:css|html|js|json|map)$/.test(file)) continue
    for (const reason of inspectBrowserArtifact(await readFile(file, 'utf8'))) {
      errors.push(`browser extension output contains ${reason}: ${file.slice(repoRoot.length + 1)}`)
    }
  }
} catch (error) {
  errors.push(`browser extension artifact inspection failed: ${error.message}`)
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

const consumerPackage = `${repoRoot}/apps/web/node_modules/@inkcre/core`
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
      cwd: `${repoRoot}/apps/web`,
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
