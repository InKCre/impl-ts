import { execFileSync } from 'node:child_process'

import { repoRoot } from './database-runtime-lib.mjs'

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    timeout: 300_000,
  })
}

run('pnpm', ['--filter', '@inkcre/core', 'build'])
run('pnpm', ['--filter', '@inkcre/webext', 'build'])
run('node', [
  '--test',
  'scripts/tests/browser-automation-transport.test.mjs',
  'scripts/tests/job-cancellation.test.mjs',
  'scripts/tests/source-anchor.test.mjs',
])
run('node', ['scripts/verify-browser-automation.mjs'])
run('pnpm', ['exec', 'playwright', 'test', '--project', 'browser-extension'])
