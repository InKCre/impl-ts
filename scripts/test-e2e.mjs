import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
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

function verifyRestoreFailure(instance) {
  const composeFile = new URL('../runtime/database.compose.yml', import.meta.url)
  const { restore } = parse(readFileSync(composeFile, 'utf8')).services
  const inputs = ['database-roles.sql', 'database-schema.sql']
  for (const badInput of inputs) {
    // An anonymous volume masks the admitted bundle for this one container.
    // Refuse to write unless both files are absent. All SQL is read-only.
    const fixtures = inputs.map((input) => {
      const sql = input === badInput ? 'SELECT 1/0; SELECT 1;' : 'SELECT 1;'
      return `printf '%s' '${sql}' > /database-contract/${input}`
    })
    const script = [
      ...inputs.map((input) => `test ! -e /database-contract/${input}`),
      ...fixtures,
      ...restore.command,
    ].join(' && ')
    assert.throws(
      () =>
        compose(instance, [
          'run',
          '-T',
          '--rm',
          '--no-deps',
          '--volume',
          '/database-contract',
          'restore',
          script,
        ]),
      (error) => error.status === 3 && /division by zero/.test(String(error.stderr)),
      `restore must propagate the SQL failure in ${badInput}`
    )
  }
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
  verifyRestoreFailure(instance)
  const baseline = developmentFingerprint(instance)
  let preview
  try {
    run('pnpm', ['--filter', '@inkcre/web', 'build-only'])
    run('pnpm', [
      '--filter',
      '@inkcre/ext-github...',
      '--filter',
      '@inkcre/ext-mail...',
      '--filter',
      '@inkcre/ext-capture...',
      '--filter',
      '@inkcre/ext-caldav...',
      '--filter',
      '@inkcre/ext-local-files...',
      '--filter',
      '@inkcre/ext-memos...',
      '--filter',
      '@inkcre/ext-twitter...',
      'build',
    ])
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
      : ['--project', 'web-database', '--project', 'accessibility', '--project', 'mail-host']
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
