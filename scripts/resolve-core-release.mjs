import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  readJson,
  resolveConfiguredCoreRelease,
  validateCoreReleaseConfig,
} from './core-release-lib.mjs'
import { resolveDatabaseProviderConfig, runDatabaseDocker } from './database-provider.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const config = validateCoreReleaseConfig(await readJson(`${repoRoot}/contracts/core-release.json`))
const provider = resolveDatabaseProviderConfig()
const runDocker = (args, options) => runDatabaseDocker(provider, args, options)
const release = resolveConfiguredCoreRelease(runDocker, config)

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `image=${release.image}`,
      `source_revision=${release.manifest.source_revision}`,
      `schema_digest=${release.manifest.schema.sha256}`,
      `contract_revision=${release.manifest.contract_revision}`,
      '',
    ].join('\n')
  )
}

console.log(
  JSON.stringify({
    image: release.image,
    source_revision: release.manifest.source_revision,
    schema_digest: release.manifest.schema.sha256,
    contract_revision: release.manifest.contract_revision,
  })
)
