import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import {
  readJson,
  validateCoreReleaseConfig,
  validateDatabaseCompatibilityContract,
} from './core-release-lib.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const config = validateCoreReleaseConfig(await readJson(`${repoRoot}/contracts/core-release.json`))
const runtimeContract = await readJson(
  `${repoRoot}/packages/core/src/database/runtime-contract.generated.json`
)
const { services } = parse(await readFile(`${repoRoot}/runtime/database.compose.yml`, 'utf8'))
const errors = []

try {
  validateDatabaseCompatibilityContract(runtimeContract)
} catch (error) {
  errors.push(error.message)
}
// Restore and extraction run separately from the long-lived services. Every
// container must use the admitted release even when another uses the same pin.
const coreImage = '${INKCRE_CORE_IMAGE:?INKCRE_CORE_IMAGE is required}'
for (const [service, image] of Object.entries({
  postgres: config.runtime_images.pgvector,
  restore: config.runtime_images.pgvector,
  postgrest: config.runtime_images.postgrest,
  contract: coreImage,
  init: coreImage,
  core: coreImage,
})) {
  if (services[service]?.image !== image) errors.push(`${service} must use ${image}`)
}

for (const [service, port] of Object.entries({
  postgres: '127.0.0.1:${POSTGRES_PORT:-0}:5432',
  postgrest: '127.0.0.1:${POSTGREST_PORT:-0}:3000',
  core: '127.0.0.1:${CORE_PORT:-0}:8000',
})) {
  const ports = services[service]?.ports
  if (ports?.length !== 1 || ports[0] !== port) {
    errors.push(`${service} must publish only its worktree-local port ${port}`)
  }
}

const peer = services.core?.environment
if (
  peer?.PEER_ID !== '00000000-0000-4000-8000-000000000002' ||
  Number(peer?.PEER_LEASE_RENEW_INTERVAL_SECONDS) !== 1
) {
  errors.push('development Core must renew its known peer identity every second')
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[ERROR] ${error}`)
  process.exit(1)
}

console.log('[OK] database compatibility, admitted service images, and worktree ports agree')
