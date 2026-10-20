import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    assert.ok(key?.startsWith('--') && value, `Expected --option value near ${key ?? ''}`)
    options[key.slice(2)] = value
  }
  for (const key of ['source', 'output', 'metadata']) {
    assert.ok(options[key], `--${key} is required`)
  }
  return options
}

function run(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} failed (${signal ?? code})`))
    })
  })
}

function capture(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${command} failed (${signal ?? code})`))
    })
  })
}

function waitForExit(child, command) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} failed (${signal ?? code})`))
    })
  })
}

async function exportCommit(source, sourceSha, output) {
  await mkdir(output, { recursive: true })
  const archive = spawn('git', ['archive', '--format=tar', sourceSha], {
    cwd: source,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const extract = spawn('tar', ['-xf', '-', '-C', output], {
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  archive.stdout.pipe(extract.stdin)
  await Promise.all([waitForExit(archive, 'git archive'), waitForExit(extract, 'tar extract')])
}

async function changesetSummary(root) {
  const directory = path.join(root, '.changeset')
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
  const files = await Promise.all(
    names.map(async (name) => {
      const content = await readFile(path.join(directory, name))
      return {
        path: `.changeset/${name}`,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    })
  )
  const aggregate = createHash('sha256')
  for (const file of files) aggregate.update(`${file.path}\0${file.sha256}\n`)
  return { count: files.length, files, sha256: aggregate.digest('hex') }
}

async function packageVersion(root, relative) {
  const pkg = JSON.parse(await readFile(path.join(root, relative), 'utf8'))
  return pkg.version
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const source = path.resolve(options.source)
  const output = path.resolve(options.output)
  const metadataPath = path.resolve(options.metadata)
  assert.notEqual(source, output, 'Source and prepared candidate paths must differ')
  assert.match(
    options['source-sha'] ?? '',
    /^[a-f0-9]{40}$/,
    '--source-sha must be a full commit SHA'
  )
  assert.ok(!(await lstat(output).catch(() => null)), 'Prepared candidate output must not exist')

  const sourceSha = options['source-sha']
  const resolvedSha = await capture('git', ['rev-parse', '--verify', `${sourceSha}^{commit}`], {
    cwd: source,
  })
  assert.equal(resolvedSha, sourceSha, 'Requested source SHA must resolve to the exact commit')
  const currentHead = await capture('git', ['rev-parse', 'HEAD'], { cwd: source })
  assert.equal(currentHead, sourceSha, 'Source checkout must be at the requested commit')
  await exportCommit(source, sourceSha, output)
  const changesets = await changesetSummary(output)
  await run('pnpm', ['install', '--frozen-lockfile'], { cwd: output })
  const { satisfies } = createRequire(path.join(output, 'package.json'))('semver')

  const originalCoreVersion = await packageVersion(output, 'packages/core/package.json')
  const twitterPackagePath = 'extensions/twitter/package.json'
  const originalTwitter = JSON.parse(await readFile(path.join(output, twitterPackagePath), 'utf8'))
  const requiredHostRange = originalTwitter.inkcre.module_federation.host_sdk_version

  await run('pnpm', ['release:version'], { cwd: output })

  const coreVersion = await packageVersion(output, 'packages/core/package.json')
  const twitter = JSON.parse(await readFile(path.join(output, twitterPackagePath), 'utf8'))
  assert.ok(
    satisfies(coreVersion, requiredHostRange.replaceAll(',', ' ')),
    `Prepared Host ${coreVersion} does not satisfy Twitter range ${requiredHostRange}`
  )
  const metadata = {
    kind: 'isolated-changesets-preview-candidate',
    source_sha: sourceSha,
    changeset_inputs: changesets,
    commands: ['pnpm install --frozen-lockfile', 'pnpm release:version'],
    compatibility: {
      source_host_version: originalCoreVersion,
      prepared_host_version: coreVersion,
      twitter_release_version: twitter.version,
      twitter_host_sdk_version: twitter.inkcre.module_federation.host_sdk_version,
      source_host_rejects_twitter: !satisfies(
        originalCoreVersion,
        requiredHostRange.replaceAll(',', ' ')
      ),
      prepared_host_accepts_twitter: satisfies(coreVersion, requiredHostRange.replaceAll(',', ' ')),
    },
    candidate_directory: output,
  }
  await mkdir(path.dirname(metadataPath), { recursive: true })
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  if (options['github-output']) {
    await writeFile(
      options['github-output'],
      `candidate_path=${output}\nmetadata_path=${metadataPath}\n`,
      { flag: 'a' }
    )
  }
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(`[preview-candidate] ${error.message}`)
    process.exitCode = 1
  })
}
