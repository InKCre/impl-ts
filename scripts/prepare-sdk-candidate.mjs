import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Local/CI candidate: apply current source and derive versions without consuming source intent. */
export async function prepareSdkCandidate(root, destination, { committedSvc = false } = {}) {
  execFileSync('git', ['clone', '--shared', '--quiet', root, destination], { stdio: 'pipe' })
  execFileSync('git', ['update-ref', 'refs/heads/main', 'HEAD'], {
    cwd: destination,
    stdio: 'pipe',
  })
  execFileSync('git', ['config', 'diff.ignoreSubmodules', 'all'], { cwd: destination })
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
  execFileSync('pnpm', ['release:version'], { cwd: destination, stdio: 'pipe' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  if (!process.argv[2])
    throw new Error('Pass an empty candidate directory outside the source checkout.')
  await prepareSdkCandidate(root, path.resolve(process.argv[2]), {
    committedSvc: process.argv.includes('--committed-svc'),
  })
  console.log(`Prepared unpublished SDK/producer candidate at ${path.resolve(process.argv[2])}`)
}
