import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  compose,
  ensureDatabaseRuntime,
  exists,
  repoRoot,
  runtimeCredentials,
  runtimeDirectory,
  stopDatabaseRuntime,
  waitForRuntime,
} from './database-runtime-lib.mjs'
import { resolveDatabaseProviderConfig } from './database-provider.mjs'

/** Both browser lanes own a fresh database; neither may attach to shared development data. */
export async function runIsolatedDatabaseTest(lane, run) {
  if (resolveDatabaseProviderConfig().kind === 'external') {
    process.env.INKCRE_DATABASE_PROVIDER = process.env.INKCRE_E2E_DATABASE_PROVIDER ?? 'ssh'
  }
  if (resolveDatabaseProviderConfig().kind === 'external') {
    throw new Error('Browser E2E requires an owned local or SSH database, not an external runtime')
  }

  const identity = createHash('sha256')
    .update(`${repoRoot}/${process.pid}/${Date.now()}`)
    .digest('hex')
    .slice(0, 16)
  const instance = `e2e-${lane}-${identity}`
  let credentials
  const redact = (value) =>
    Object.entries(credentials ?? {}).reduce(
      (result, [name, secret]) =>
        name === 'format' ? result : result.replaceAll(secret, `[REDACTED:${name}]`),
      value
    )

  try {
    const state = await ensureDatabaseRuntime(instance)
    credentials = await runtimeCredentials(instance)
    await waitForRuntime(state)
    await run(state, credentials)
  } catch (error) {
    const directory = `${repoRoot}/test-results/database/${lane}`
    await mkdir(directory, { recursive: true })
    const failure = error instanceof Error ? (error.stack ?? error.message) : String(error)
    await writeFile(`${directory}/orchestration-error.txt`, `${redact(failure)}\n`)
    try {
      if (await exists(`${runtimeDirectory(instance)}/runtime.json`)) {
        const logs = compose(instance, ['logs', '--no-color'], { timeout: 30_000 })
        await writeFile(`${directory}/compose.log`, redact(logs))
      }
    } catch (logError) {
      await writeFile(`${directory}/compose-log-error.txt`, `${redact(String(logError))}\n`)
    }
    console.error(redact(failure))
    process.exitCode = 1
  } finally {
    try {
      if (await exists(`${runtimeDirectory(instance)}/runtime.json`)) {
        await stopDatabaseRuntime(instance)
      }
    } catch (cleanupError) {
      console.error(`E2E cleanup failed for ${instance}: ${redact(String(cleanupError))}`)
      process.exitCode = 1
    }
  }
}
