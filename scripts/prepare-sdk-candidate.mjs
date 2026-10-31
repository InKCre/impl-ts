import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getReleasePlan } from '@changesets/get-release-plan'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Explicit disposable candidate only: version normally without release-history changelogs. */
export async function deriveSdkCandidate(root) {
  if (!(await getReleasePlan(root)).releases.length) return false
  const configPath = path.join(root, '.changeset/config.json')
  const original = await readFile(configPath, 'utf8')
  try {
    // Changelog attribution can fetch missing Git history. A candidate needs the
    // real version plan, but neither release notes nor repository credentials.
    await writeFile(configPath, JSON.stringify({ ...JSON.parse(original), changelog: false }))
    execFileSync('pnpm', ['release:version'], { cwd: root, stdio: 'inherit' })
    return true
  } finally {
    await writeFile(configPath, original)
  }
}

/** Local/CI candidate: apply current source and derive versions without consuming source intent. */
export async function prepareSdkCandidate(root, destination, { committedSvc = false } = {}) {
  execFileSync('git', ['clone', '--shared', '--quiet', root, destination], { stdio: 'pipe' })
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean)
  for (const relative of files) {
    // Explicit isolation for an unrelated local edit; CI includes all source by default.
    if (committedSvc && relative === 'svc.json') continue
    const source = path.join(root, relative)
    try {
      const stat = await lstat(source)
      if (stat.isSymbolicLink()) await rm(path.join(destination, relative), { force: true })
      await mkdir(path.dirname(path.join(destination, relative)), { recursive: true })
      await cp(source, path.join(destination, relative), { recursive: stat.isDirectory() })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await rm(path.join(destination, relative), { recursive: true, force: true })
    }
  }
  execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: destination, stdio: 'pipe' })
  await deriveSdkCandidate(destination)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  if (process.argv[2] === '--in-place') {
    await deriveSdkCandidate(root)
    console.log(`Prepared unpublished versions in the explicit candidate at ${root}`)
  } else {
    if (!process.argv[2])
      throw new Error('Pass an empty candidate directory, or --in-place in a disposable candidate.')
    await prepareSdkCandidate(root, path.resolve(process.argv[2]), {
      committedSvc: process.argv.includes('--committed-svc'),
    })
    console.log(`Prepared unpublished SDK/producer candidate at ${path.resolve(process.argv[2])}`)
  }
}
