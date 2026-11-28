import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { openDatabaseAccess, runDatabaseCompose } from '../database-provider.mjs'

const repo = fileURLToPath(new URL('../..', import.meta.url))

function commands(t) {
  const bin = mkdtempSync(join(tmpdir(), 'inkcre-dev-'))
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  return {
    bin,
    write(name, body) {
      writeFileSync(join(bin, name), '#!/bin/sh\nset -eu\n' + body, { mode: 0o700 })
    },
  }
}

void test('development commands ensure the database before the requested worktree target', (t) => {
  const tools = commands(t)
  const log = join(tools.bin, 'calls')
  tools.write('svc', 'printf "%s\\n" "$*" >> "$DEV_CALLS"\nexit "${SVC_STATUS:-0}"')
  const env = { ...process.env, PATH: tools.bin + ':' + process.env.PATH, DEV_CALLS: log }
  delete env.SVC_DEV_TARGET
  delete env.SVC_STATUS
  for (const [script, target] of [
    ['dev', 'web'],
    ['dev:webext', 'webext'],
  ]) {
    writeFileSync(log, '')
    execFileSync('pnpm', ['run', script], { cwd: repo, env, stdio: 'pipe' })
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
      `dev ensure database --repo ${repo} --json`,
      `dev ensure ${target} --repo ${repo} --json`,
    ])
  }
  writeFileSync(log, '')
  const failed = spawnSync('pnpm', ['run', 'dev'], { cwd: repo, env: { ...env, SVC_STATUS: '3' } })
  assert.notEqual(failed.status, 0)
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    `dev ensure database --repo ${repo} --json`,
  ])
})

void test('dev:stop terminates only a process owning this worktree route', async (t) => {
  const tools = commands(t)
  const script = join(tools.bin, 'scripts/dev-stop.mjs')
  mkdirSync(dirname(script))
  copyFileSync(join(repo, 'scripts/dev-stop.mjs'), script)
  const instance = '0123456789abcdef'
  const mine = `client-web-${instance}`
  const other = 'client-web-0000000000000000'
  tools.write('svc', `printf '%s' '{"workspace":{"instance":"${instance}"}}'`)
  mkdirSync(join(tools.bin, 'node_modules/.bin'), { recursive: true })
  const owner = (route) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', 'portless', route])
    t.after(() => child.kill())
    return child
  }
  const owned = owner(mine)
  const neighbor = owner(other)
  const routes = (firstPid) =>
    tools.write(
      'node_modules/.bin/portless',
      `printf '%s\n' \
    'https://${other}.localhost (pid ${neighbor.pid})' 'https://${mine}.localhost (pid ${firstPid})'`
    )
  const env = { ...process.env, PATH: tools.bin + ':' + process.env.PATH }
  routes(neighbor.pid)
  const stale = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /Refusing to stop PID/)
  routes(owned.pid)
  const stopped = once(owned, 'exit')
  execFileSync(process.execPath, [script], { env, stdio: 'pipe' })
  assert.deepEqual(await stopped, [null, 'SIGTERM'])
  assert.doesNotThrow(() => process.kill(neighbor.pid, 0))
})

void test('SSH provider transports Compose arguments and establishes noninteractive fail-fast forwards', (t) => {
  const tools = commands(t)
  const composeEnv = join(tools.bin, 'database.env')
  writeFileSync(composeEnv, 'INKCRE_COMPOSE_PROJECT_NAME=fixture-project\n')
  tools.write('docker', 'printf "%s\\n" "$@"')
  // Run the shipped remote payload locally. The only substituted processes are
  // the SSH transport and Docker daemon boundary.
  tools.write(
    'ssh',
    `if [ "$1" = "-T" ]; then
    [ "$2" = "-o" ] && [ "$3" = "BatchMode=yes" ] && [ "$4" = "fixture-host" ] || exit 2
    exec sh -c "$5"
  fi
  printf "%s\\n" "$@" > "$SSH_CALL"`
  )
  const previousPath = process.env.PATH
  const previousLog = process.env.SSH_CALL
  process.env.PATH = tools.bin + ':' + previousPath
  process.env.SSH_CALL = join(tools.bin, 'forward')
  t.after(() => {
    process.env.PATH = previousPath
    if (previousLog === undefined) delete process.env.SSH_CALL
    else process.env.SSH_CALL = previousLog
  })
  const state = {
    identity: tools.bin,
    provider: { kind: 'ssh', target: 'fixture-host', forward_host: '127.0.0.1' },
    local_ports: { core: 30111, postgrest: 30112 },
    remote_ports: { core: 40111, postgrest: 40112 },
  }
  const args = ['exec', 'core', 'example with spaces', '*.json']
  const received = runDatabaseCompose(state, composeEnv, args).trim().split('\n')
  assert.equal(received[0], 'compose')
  assert.deepEqual(received.slice(received.indexOf('--project-name')), [
    '--project-name',
    'fixture-project',
    ...args,
  ])
  openDatabaseAccess(state)
  const forward = readFileSync(process.env.SSH_CALL, 'utf8').trim().split('\n')
  assert.equal(forward.at(-1), 'fixture-host')
  for (const [flag, value] of [
    ['-o', 'BatchMode=yes'],
    ['-o', 'ExitOnForwardFailure=yes'],
    ['-L', '30111:127.0.0.1:40111'],
    ['-L', '30112:127.0.0.1:40112'],
  ])
    assert.equal(forward[forward.indexOf(value) - 1], flag, value)
})

void test('WXT launches Chromium only with an explicit binary and worktree profile', async (t) => {
  const config = fileURLToPath(new URL('../../apps/webext/wxt.config.ts', import.meta.url))
  const web = createRequire(new URL('../../apps/web/package.json', import.meta.url))
  const { loadConfigFromFile } = await import(pathToFileURL(web.resolve('vite')).href)
  const keys = ['INKCRE_CHROMIUM_BINARY', 'INKCRE_WXT_PROFILE_DIR']
  const saved = keys.map((key) => process.env[key])
  t.after(() =>
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]
      else process.env[key] = saved[i]
    })
  )
  const load = async () =>
    (
      await loadConfigFromFile(
        { command: 'serve', mode: 'development' },
        config,
        dirname(config),
        'silent'
      )
    ).config.webExt
  delete process.env.INKCRE_WXT_PROFILE_DIR
  process.env.INKCRE_CHROMIUM_BINARY = '/chosen/chrome'
  assert.equal((await load()).disabled, true)
  delete process.env.INKCRE_CHROMIUM_BINARY
  const tools = commands(t)
  const launcher = join(tools.bin, 'scripts/dev-wxt.mjs')
  mkdirSync(dirname(launcher))
  mkdirSync(join(tools.bin, 'apps/webext'), { recursive: true })
  copyFileSync(join(repo, 'scripts/dev-wxt.mjs'), launcher)
  tools.write('pnpm', 'printf "%s" "$INKCRE_WXT_PROFILE_DIR"')
  const instance = '123456789abcdef0'
  const profile = execFileSync(process.execPath, [launcher], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: tools.bin + ':' + process.env.PATH,
      PORT: '12345',
      INKCRE_DEV_INSTANCE: instance,
    },
  })
  assert.equal(
    profile.replaceAll('//', '/'),
    join(tools.bin, '.runtime/dev', instance, 'chromium-profile')
  )
  assert.ok(existsSync(profile))
  process.env.INKCRE_WXT_PROFILE_DIR = profile
  assert.equal((await load()).disabled, true)
  process.env.INKCRE_CHROMIUM_BINARY = '/chosen/chrome'
  const enabled = await load()
  assert.equal(enabled.binaries.chrome, '/chosen/chrome')
  assert.equal(enabled.chromiumProfile, profile)
  assert.equal(enabled.keepProfileChanges, true)
  assert.ok(!enabled.disabled)
  assert.ok(!(enabled.chromiumArgs ?? []).some((arg) => arg.startsWith('--remote-debugging-port=')))
})
