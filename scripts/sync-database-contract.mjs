import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  inspectCoreRelease,
  projectDatabaseCompatibilityContract,
  readJson,
  resolveConfiguredCoreRelease,
  stableJson,
  validateCoreReleaseConfig,
} from './core-release-lib.mjs'
import {
  ensureDatabaseRuntime,
  runtimeCredentials,
  stopDatabaseRuntime,
  waitForRuntime,
} from './database-runtime-lib.mjs'
import { resolveDatabaseProviderConfig, runDatabaseDocker } from './database-provider.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const imageIndex = args.indexOf('--image')
const requestedImage = imageIndex >= 0 ? args[imageIndex + 1] : null
const check = args.includes('--check')
const config = validateCoreReleaseConfig(await readJson(`${repoRoot}/contracts/core-release.json`))
const provider = resolveDatabaseProviderConfig()
const runDocker = (dockerArgs, options) => runDatabaseDocker(provider, dockerArgs, options)
const release = requestedImage
  ? inspectCoreRelease(runDocker, requestedImage, { allowLocalImage: true })
  : resolveConfiguredCoreRelease(runDocker, config)
const instance = `typegen-${createHash('sha256')
  .update(`${repoRoot}/${process.pid}/${Date.now()}`)
  .digest('hex')
  .slice(0, 16)}`
let runtimeStarted = false

function output(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeout ?? 180_000,
  })
}

function workspaceBinary(name) {
  return `${repoRoot}/node_modules/.bin/${name}`
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function generateTypes(state, credentials) {
  const port =
    state.provider.kind === 'ssh' ? state.remote_ports.postgres : state.local_ports.postgres
  const databaseUrl = `postgresql://postgres:${credentials.POSTGRES_PASSWORD}@127.0.0.1:${port}/inkcre?sslmode=disable`
  const args = ['gen', 'types', 'typescript', '--db-url', databaseUrl, '--schema', 'inkcre']
  if (state.provider.kind !== 'ssh') {
    return output(workspaceBinary('supabase'), args, { timeout: 300_000 })
  }

  const typegenCommand = ['npx', '--yes', 'supabase@2.112.0', ...args].map(shellQuote).join(' ')
  const remoteCommand = [
    'typegen_bin=$(mktemp -d)',
    `trap ${shellQuote('rm -rf "$typegen_bin"')} EXIT`,
    `ln -s ${shellQuote(state.provider.docker_bin)} "$typegen_bin/docker"`,
    `PATH="$typegen_bin:$PATH" ${typegenCommand}`,
  ].join('; ')
  return output('ssh', ['-T', '-o', 'BatchMode=yes', state.provider.target, remoteCommand], {
    timeout: 300_000,
  })
}

async function writeOrCompare(path, content, label) {
  if (check) {
    const checked = await readFile(path)
    if (!checked.equals(content)) throw new Error(`${label} is stale for ${release.image}`)
    return
  }
  await writeFile(path, content)
}

try {
  process.env.INKCRE_CORE_IMAGE = release.image
  const state = await ensureDatabaseRuntime(instance, { stdio: 'ignore' })
  runtimeStarted = true
  await waitForRuntime(state)
  const credentials = await runtimeCredentials(instance)

  const rawTypes = generateTypes(state, credentials)
  const generatedTypes = Buffer.from(
    output(workspaceBinary('oxfmt'), ['--stdin-filepath', 'database.generated.ts'], {
      input: rawTypes,
    })
  )
  await writeOrCompare(
    `${repoRoot}/packages/core/src/database/database.generated.ts`,
    generatedTypes,
    'generated database types'
  )
  const generatedRuntimeContract = Buffer.from(
    output(workspaceBinary('oxfmt'), ['--stdin-filepath', 'runtime-contract.generated.json'], {
      input: stableJson(projectDatabaseCompatibilityContract(release.runtime_contract)),
    })
  )
  await writeOrCompare(
    `${repoRoot}/packages/core/src/database/runtime-contract.generated.json`,
    generatedRuntimeContract,
    'generated runtime contract'
  )
  console.log(
    `[contract] ${check ? 'verified' : 'synchronized'} ${release.image} through Supabase CLI`
  )
} finally {
  if (runtimeStarted) {
    await stopDatabaseRuntime(instance, { stdio: 'ignore' })
  }
}
