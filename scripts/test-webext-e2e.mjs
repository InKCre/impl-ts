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
run('pnpm', ['--filter', '@inkcre/client-webext', 'build'])
run('pnpm', ['exec', 'playwright', 'test', '--project', 'browser-extension'])
