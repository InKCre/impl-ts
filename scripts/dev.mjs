import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { resolveUiSourceFromEnvironment } from './ui-source.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const target = process.argv[2]
const supportedTargets = new Set(['web', 'web-ui', 'webext'])

if (!supportedTargets.has(target)) {
  console.error(`Usage: node scripts/dev.mjs <${[...supportedTargets].join('|')}>`)
  process.exit(2)
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal))
  }

  child.once('error', (error) => {
    console.error(`[dev] Failed to start ${command}: ${error.message}`)
  })

  return new Promise((resolve) => {
    child.once('close', (code, signal) => {
      if (signal) {
        resolve(1)
        return
      }
      resolve(code ?? 1)
    })
  })
}

async function runDeclaredTarget() {
  const instance = process.env.SVC_DEV_INSTANCE
  const declaredTarget = process.env.SVC_DEV_TARGET

  if (!instance || declaredTarget !== target) {
    console.error('[dev] SVC did not provide the expected worktree target identity.')
    return 1
  }

  const isWebTarget = target === 'web' || target === 'web-ui'
  if (target === 'web-ui') {
    try {
      await resolveUiSourceFromEnvironment()
    } catch (error) {
      console.error(`[ui-source] ${error.message}`)
      return 2
    }
  }

  // Browser settings belong to this origin; a source/package rename must not strand them.
  const routePrefix =
    target === 'web-ui' ? 'client-web-ui' : target === 'web' ? 'client-web' : 'webext'
  const name = `${routePrefix}-${instance}`
  const cwd = `${repoRoot}/${isWebTarget ? 'apps/web' : 'apps/webext'}`
  const command = isWebTarget ? ['pnpm', 'exec', 'vite'] : ['node', '../../scripts/dev-wxt.mjs']

  return run('pnpm', ['exec', 'portless', name, ...command], {
    cwd,
    env: {
      ...process.env,
      INKCRE_DEV_INSTANCE: instance,
      INKCRE_DEV_TARGET: target,
    },
  })
}

const exitCode = process.env.SVC_DEV_TARGET
  ? await runDeclaredTarget()
  : await (async () => {
      const databaseExit = await run('svc', [
        'dev',
        'ensure',
        'database',
        '--repo',
        repoRoot,
        '--json',
      ])
      if (databaseExit !== 0) return databaseExit
      return run('svc', ['dev', 'ensure', target, '--repo', repoRoot, '--json'])
    })()

process.exitCode = exitCode
