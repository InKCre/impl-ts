import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import semver from 'semver'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const executeFile = promisify(execFile)
const execute = async (command, args, cwd) =>
  (
    await executeFile(command, args, {
      cwd,
      encoding: 'utf8',
    })
  ).stdout

const listedFiles = ['ls-files', '-z', '--cached', '--others', '--exclude-standard']
function includeSource(file) {
  if (!file || file.startsWith('.runtime/')) return false
  const dotenv = /(^|\/)\.env(?:\.|$)/.test(file)
  return !dotenv || /(^|\/)\.env(?:\.[^/]*)?\.(example|sample)$/.test(file)
}

async function packages(root) {
  const result = new Map()
  for (const family of ['packages', 'apps', 'extensions']) {
    for (const entry of await readdir(join(root, family), { withFileTypes: true }).catch(
      () => []
    )) {
      if (!entry.isDirectory()) continue
      const path = join(family, entry.name, 'package.json')
      const text = await readFile(join(root, path), 'utf8').catch(() => null)
      if (text) {
        const metadata = JSON.parse(text)
        result.set(metadata.name, { path, metadata })
      }
    }
  }
  return result
}

async function intents(root) {
  return (await readdir(join(root, '.changeset')).catch(() => []))
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .sort()
}

async function verifySource(source, files, run) {
  const listed = String(await run('git', listedFiles, source))
    .split('\0')
    .filter(includeSource)
  const currentFiles = []
  for (const file of listed) {
    const stat = await lstat(join(source, file)).catch(() => null)
    if (stat?.isFile()) currentFiles.push(file)
  }
  if (JSON.stringify(currentFiles.sort()) !== JSON.stringify(Object.keys(files).sort()))
    throw new Error('Source file set changed after snapshot; refresh the candidate')
  for (const [file, hash] of Object.entries(files)) {
    const current = await readFile(join(source, file)).catch(() => null)
    if (!current || digest(current) !== hash)
      throw new Error(
        `Source changed after snapshot: ${file}; refresh the candidate without reverting source work`
      )
  }
}

/** Prepare validation coordinates with the existing Changesets command; never edit source versions. */
export async function prepareNativeCheckout({
  sourceDirectory,
  outputDirectory,
  offline = false,
  run = execute,
}) {
  const source = await realpath(sourceDirectory)
  const output = resolve(outputDirectory)
  if (output === source || source.startsWith(output + sep))
    throw new Error('Candidate cannot replace the source or its ancestor')
  if ((await readdir(output).catch(() => [])).length)
    throw new Error('Candidate output must be empty')
  const candidate = join(output, 'workspace')
  await mkdir(candidate, { recursive: true })
  const revision = String(await run('git', ['rev-parse', 'HEAD'], source)).trim()
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Source requires one existing Git revision')
  const sourceModified = !!String(await run('git', ['status', '--porcelain'], source)).trim()
  const paths = String(await run('git', listedFiles, source))
    .split('\0')
    .filter(Boolean)
    .sort()
  const files = {}
  for (const file of paths) {
    if (!includeSource(file)) continue
    const origin = join(source, file)
    const stat = await lstat(origin).catch(() => null)
    if (!stat || stat.isDirectory()) continue // Git submodule content is not part of git archive either.
    if (stat.isSymbolicLink()) throw new Error(`Candidate source contains a symbolic link: ${file}`)
    const bytes = await readFile(origin)
    const target = join(candidate, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { mode: stat.mode & 0o777 })
    files[file] = digest(bytes)
  }
  const before = await packages(source)
  const pending = await intents(source)
  const sourceSnapshot = digest(JSON.stringify(files))
  /** @type {Array<[string, string[]]>} */
  const steps = [
    ['git', ['init', '--quiet']],
    [
      'git',
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--depth=1',
        source,
        `${revision}:refs/remotes/origin/main`,
      ],
    ],
    ['git', ['update-ref', 'refs/heads/main', revision]],
    ['git', ['symbolic-ref', 'HEAD', 'refs/heads/main']],
    ['git', ['read-tree', revision]],
    ['pnpm', ['install', '--frozen-lockfile', ...(offline ? ['--offline'] : [])]],
    ['pnpm', ['release:version']],
    ['pnpm', ['install', '--lockfile-only', '--ignore-scripts', ...(offline ? ['--offline'] : [])]],
  ]
  await mkdir(join(output, 'logs'))
  for (let index = 0; index < steps.length; index++) {
    const [command, args] = steps[index]
    const text = await run(command, args, candidate)
    await writeFile(join(output, 'logs', `${index + 1}-${command}.log`), String(text ?? ''))
  }
  const after = await packages(candidate)
  const coreVersion = after.get('@inkcre/core')?.metadata.version
  if (!semver.valid(coreVersion)) throw new Error('Candidate Core SDK version is invalid')
  for (const [name, previous] of before) {
    const next = after.get(name)
    if (!next) throw new Error(`Candidate lost workspace package ${name}`)
    if (JSON.stringify(previous.metadata.inkcre) !== JSON.stringify(next.metadata.inkcre))
      throw new Error(`Candidate changed native identity or Host SDK range for ${name}`)
    const association = next.metadata.inkcre?.module_federation
    if (association && !semver.satisfies(coreVersion, association.host_sdk_version))
      throw new Error(
        `Candidate versions are not prepared: ${name} requires ${association.host_sdk_version}, Core is ${coreVersion}`
      )
  }
  const remaining = await intents(candidate)
  if (remaining.length)
    throw new Error(`Candidate still has unconsumed version intent: ${remaining.join(', ')}`)
  await verifySource(source, files, run)
  const summary = {
    kind: 'isolated-native-validation',
    source,
    candidate,
    source_revision: revision,
    source_modified: sourceModified,
    source_snapshot_sha256: sourceSnapshot,
    prepared_at: new Date().toISOString(),
    source_changesets: pending,
    versions: Object.fromEntries(
      [...after].map(([name, value]) => [
        name,
        {
          source: before.get(name)?.metadata.version,
          prepared: value.metadata.version,
        },
      ])
    ),
  }
  await writeFile(
    join(output, 'source-snapshot.json'),
    JSON.stringify({ ...summary, files }, null, 2) + '\n'
  )
  await writeFile(join(output, 'candidate.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
  if (!process.argv.includes('--output'))
    throw new Error('Use --output <empty candidate directory>')
  const summary = await prepareNativeCheckout({
    sourceDirectory: process.argv.includes('--source') ? argument('--source') : process.cwd(),
    outputDirectory: argument('--output'),
    offline: process.argv.includes('--offline'),
  })
  console.log(JSON.stringify(summary))
}
