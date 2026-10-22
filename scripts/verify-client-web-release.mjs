import { execFileSync } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { inspectBrowserArtifact } from './browser-runtime-contract.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distRoot = `${repoRoot}/apps/client-web/dist`
const errors = []

try {
  execFileSync(process.execPath, ['scripts/check-local-runtime-contract.mjs'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  errors.push(`browser source contract failed: ${error.stderr?.toString() || error.message}`)
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

for (const relativePath of ['index.html']) {
  try {
    await access(`${distRoot}/${relativePath}`)
  } catch {
    errors.push(`missing web release output: apps/client-web/dist/${relativePath}`)
  }
}

for (const relativePath of ['_worker.js']) {
  try {
    await access(`${distRoot}/${relativePath}`)
    errors.push(`unexpected runtime output: apps/client-web/dist/${relativePath}`)
  } catch {
    // The client release is a static Pages artifact.
  }
}

try {
  const files = await builtFiles(distRoot)
  for (const file of files) {
    if (!/\.(?:css|html|js|json|map)$/.test(file)) {
      continue
    }

    const content = await readFile(file, 'utf8')
    for (const reason of inspectBrowserArtifact(content)) {
      errors.push(`web release contains ${reason}: ${file.slice(repoRoot.length + 1)}`)
    }
  }
} catch (error) {
  errors.push(`web release inspection failed: ${error.message}`)
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[ERROR] ${error}`)
  }
  process.exitCode = 1
} else {
  console.log('[OK] client-web release is a static, environment-neutral Pages artifact')
}
