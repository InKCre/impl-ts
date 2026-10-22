import { execFileSync } from 'node:child_process'

import {
  compose,
  databaseContractIsReady,
  ensureDatabaseRuntime,
  readiness,
  repoRoot,
  runtimeDirectory,
  runtimeIsReady,
  runtimeState,
  stopDatabaseRuntime,
  waitForRuntime,
} from './database-runtime-lib.mjs'

const command = process.argv[2]
const explicitInstance = process.argv[3] && !process.argv[3].startsWith('--')
let instance = explicitInstance ? process.argv[3] : undefined
const confirmed = process.argv.includes('--yes')

if (!instance) {
  try {
    const identity = JSON.parse(
      execFileSync('svc', ['dev', 'identity', '--repo', repoRoot, '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })
    )
    instance = identity.workspace.instance
  } catch {
    // The usage error below explains the explicit fallback.
  }
}

if (!['ensure', 'ready', 'reset', 'status', 'stop'].includes(command) || !instance) {
  console.error(
    'Usage: node scripts/database-runtime.mjs <ensure|ready|reset|status|stop> <identity>'
  )
  process.exit(2)
}

if (command === 'ensure') {
  const state = await ensureDatabaseRuntime(instance)
  await waitForRuntime(state)
  const result = readiness(instance)
  if (!databaseContractIsReady(result)) {
    throw new Error('database contract readiness failed after startup')
  }
  console.log(
    JSON.stringify({
      ready: true,
      identity: state.identity,
      runtime_instance: state.runtime_instance ?? state.identity,
      owner_repository: state.owner_repository ?? 'InKCre/impl-ts',
      contract_revision: state.contract_revision,
      core_image: state.core_image,
      profile: state.binding?.profile ?? `${runtimeDirectory(instance)}/profile.json`,
      credential: state.binding?.credential ?? `${runtimeDirectory(instance)}/credential.json`,
      urls: state.urls,
    })
  )
} else if (command === 'ready') {
  console.log(JSON.stringify(readiness(instance)))
} else if (command === 'reset') {
  if (!confirmed) {
    throw new Error('refusing reset without explicit --yes confirmation')
  }
  const state = await runtimeState(instance)
  if (state.provider.kind === 'external') {
    throw new Error(
      `runtime ${state.runtime_instance} is owned by impl-py; reset it through the owner`
    )
  }
  if (state.profile !== 'development') {
    throw new Error(`refusing reset for non-development runtime ${state.identity}`)
  }
  const current = readiness(instance)
  if (!databaseContractIsReady(current)) {
    throw new Error(`refusing reset for unready runtime ${state.identity}`)
  }
  compose(instance, [
    'run',
    '--rm',
    '--no-deps',
    'init',
    'python',
    'scripts/container.py',
    'db',
    'reset-dev',
    '--confirm',
    'reset-development-data',
  ])
  console.log(JSON.stringify(readiness(instance)))
} else if (command === 'status') {
  const state = await runtimeState(instance)
  const ready =
    (await runtimeIsReady(state)) &&
    (state.provider.kind !== 'external' || databaseContractIsReady(readiness(instance)))
  console.log(
    JSON.stringify({
      ready,
      identity: state.identity,
      runtime_instance: state.runtime_instance ?? state.identity,
      owner_repository: state.owner_repository ?? 'InKCre/impl-ts',
      contract_revision: state.contract_revision,
      core_image: state.core_image,
      provider: state.provider.kind,
      profile: state.profile,
      urls: state.urls,
    })
  )
  process.exitCode = ready ? 0 : 1
} else {
  await stopDatabaseRuntime(instance)
  console.log(`[database] removed runtime ${instance}`)
}
