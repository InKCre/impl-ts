import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const instance = process.env.INKCRE_DEV_INSTANCE
const port = Number.parseInt(process.env.PORT ?? '', 10)

if (!instance || !/^[a-f0-9]{16}$/.test(instance)) {
  console.error('[webext] Missing or invalid worktree instance.')
  process.exit(2)
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[webext] Portless did not provide a valid application port.')
  process.exit(2)
}

const profileDir = `${repoRoot}/.runtime/dev/${instance}/chromium-profile`
await mkdir(profileDir, { recursive: true })

const child = spawn('pnpm', ['exec', 'wxt'], {
  cwd: `${repoRoot}/apps/webext`,
  env: {
    ...process.env,
    INKCRE_WXT_PROFILE_DIR: profileDir,
  },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal))
}

child.once('error', (error) => {
  console.error(`[webext] Failed to start WXT: ${error.message}`)
})

child.once('close', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
