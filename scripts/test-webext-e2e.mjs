import { execFileSync } from 'node:child_process'

import { repoRoot } from './database-runtime-lib.mjs'
import { runIsolatedDatabaseTest } from './e2e-database.mjs'

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
    timeout: options.timeout ?? 300_000,
  })
}

run('pnpm', ['--filter', '@inkcre/core', 'build'])
run('pnpm', ['--filter', '@inkcre/webext', 'build'])
run('pnpm', ['--filter', '@inkcre/webext', 'build:firefox'])
run('node', ['--test', 'scripts/tests/webext-artifacts.mjs'])
run('node', ['scripts/verify-firefox-collection.mjs'])
run('node', ['scripts/verify-browser-automation.mjs'])
await runIsolatedDatabaseTest('webext', async (state, credentials) => {
  run(
    'pnpm',
    ['exec', 'playwright', 'test', '--project', 'browser-extension', ...process.argv.slice(2)],
    {
      timeout: 0,
      env: {
        ...process.env,
        INKCRE_E2E_WEBEXT_PGREST: state.urls.postgrest,
        INKCRE_E2E_WEBEXT_JWT_SECRET: credentials.JWT_SECRET,
      },
    }
  )
})
