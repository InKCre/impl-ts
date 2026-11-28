import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readPreState } from '@changesets/pre'
import { readChangesets } from '@changesets/read'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceScripts = new Map([
  ['build', 'build'],
  ['web-e2e', 'test:e2e:web:with-mail'],
  ['webext-e2e', 'test:e2e:webext'],
])
const workspaceScript = workspaceScripts.get(process.argv[2])
if (!workspaceScript || process.argv.length !== 3) {
  throw new Error('Usage: pnpm review:candidate <build|web-e2e|webext-e2e>')
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function pnpm(...args) {
  execFileSync('pnpm', args, { cwd: repoRoot, stdio: 'inherit' })
}

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'HEAD' || git('status', '--porcelain')) {
  throw new Error('Review candidates require a clean, detached checkout of the source commit')
}

const [changesets, preState] = await Promise.all([readChangesets(repoRoot), readPreState(repoRoot)])
if (changesets.length > 0 || preState?.mode === 'exit') {
  pnpm('release:version')
  if (git('diff', '--name-only', 'HEAD', '--', 'package.json', ':(glob)**/package.json')) {
    pnpm('install', '--no-frozen-lockfile', '--ignore-scripts')
  }
}

pnpm(workspaceScript)
