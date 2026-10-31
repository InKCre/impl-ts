import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Pending intent is development evidence, never a published SDK identity. */
export async function pendingCoreVersion(root) {
  const intents = await readdir(path.join(root, '.changeset'))
  if (!intents.some((name) => name.endsWith('.md') && name !== 'README.md')) return null
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'inkcre-sdk-plan-'))
  try {
    const output = path.join(temporary, 'plan.json')
    const cli = createRequire(path.join(root, 'package.json')).resolve('@changesets/cli/bin.js')
    execFileSync(process.execPath, [cli, 'status', '--output', output], {
      cwd: root,
      stdio: 'pipe',
    })
    const plan = JSON.parse(await readFile(output, 'utf8'))
    return plan.releases.find((item) => item.name === '@inkcre/core')?.newVersion ?? null
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
