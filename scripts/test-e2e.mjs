import { execFileSync, spawn } from 'node:child_process'

import { availablePort, compose, repoRoot } from './database-runtime-lib.mjs'
import { runIsolatedDatabaseTest } from './e2e-database.mjs'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    timeout: options.timeout ?? 300_000,
  })
}

function developmentFingerprint(instance) {
  return compose(instance, [
    'run',
    '--rm',
    '--no-deps',
    '--entrypoint',
    'python',
    'init',
    '-c',
    'from app.database_contract.catalog import development_baseline_fingerprint as f; print(f())',
  ]).trim()
}

async function waitForWeb(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // Vite preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`built web artifact did not become ready at ${url}`)
}

await runIsolatedDatabaseTest('web', async (state, credentials) => {
  const instance = state.identity
  const baseline = developmentFingerprint(instance)
  let preview
  try {
    run('pnpm', ['--filter', '@inkcre/web', 'build-only'])
    run('pnpm', ['--filter', '@inkcre/ext-github...', '--filter', '@inkcre/ext-mail...', 'build'])
    const webPort = await availablePort()
    const webUrl = `http://127.0.0.1:${webPort}/`
    preview = spawn(
      'pnpm',
      [
        '--filter',
        '@inkcre/web',
        'exec',
        'vite',
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
        '--strictPort',
      ],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
      }
    )
    await waitForWeb(webUrl)

    const args = process.argv.slice(2)
    const projects = args.some((arg) => arg === '--project' || arg.startsWith('--project='))
      ? []
      : ['--project', 'web-database', '--project', 'accessibility', '--project', 'mail-info-base']
    run('pnpm', ['exec', 'playwright', 'test', ...projects, ...args], {
      // Playwright owns its suite deadline so reporters and teardown can finish.
      timeout: 0,
      env: {
        ...process.env,
        INKCRE_E2E_CORE_URL: state.urls.core,
        INKCRE_E2E_POSTGREST_URL: state.urls.postgrest,
        INKCRE_E2E_WEB_URL: webUrl,
        INKCRE_E2E_JWT_SECRET: credentials.JWT_SECRET,
      },
    })

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
    const resetBaseline = developmentFingerprint(instance)
    if (resetBaseline !== baseline) {
      throw new Error('reset-dev did not restore the deterministic E2E baseline')
    }
  } finally {
    preview?.kill('SIGTERM')
  }
})
