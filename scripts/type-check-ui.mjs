import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { createUiSourceTsconfig, readUiSourceInput, resolveUiSourcePackage } from './ui-source.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const appRoot = resolve(repoRoot, 'apps/web')
const runtimeRoot = resolve(repoRoot, '.runtime/ui-source')
const configPath = resolve(runtimeRoot, 'tsconfig.json')

let uiSource
try {
  const input = readUiSourceInput(process.argv.slice(2))
  uiSource = await resolveUiSourcePackage(input, { cwd: repoRoot })
} catch (error) {
  console.error(`[ui-source] ${error.message}`)
  process.exit(2)
}

await mkdir(runtimeRoot, { recursive: true })
await writeFile(
  configPath,
  `${JSON.stringify(createUiSourceTsconfig(uiSource, appRoot, runtimeRoot), null, 2)}\n`
)

const child = spawn(
  'pnpm',
  ['--dir', appRoot, 'exec', 'vue-tsc', '--noEmit', '--project', configPath],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  }
)

const exitCode = await new Promise((resolveExit) => {
  child.once('error', (error) => {
    console.error(`[ui-source] Failed to start vue-tsc: ${error.message}`)
    resolveExit(1)
  })
  child.once('close', (code, signal) => {
    resolveExit(signal ? 1 : (code ?? 1))
  })
})

await rm(runtimeRoot, { recursive: true, force: true })
process.exitCode = exitCode
