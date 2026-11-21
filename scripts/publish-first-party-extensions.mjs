import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARCHIVE_NAME,
  artifactManifestUrl,
  buildArtifactCommit,
  prepareRepositoryExtension,
  repositoryReleaseBody,
} from './prepare-repository-extension.mjs'
import { inspectNativeModuleFederation } from './verify-native-extension-distribution.mjs'

const ARTIFACT_NAME = 'first-party-extension-candidate'
const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const tagFor = (name, version) => 'inkcre-ext/' + name + '/module_federation/v' + version

export function selectSavedCandidate(artifacts, runAttempt) {
  assert.match(runAttempt, /^[1-9]\d*$/, 'current GitHub run attempt is required')
  const candidates = artifacts.filter((artifact) => artifact.name === ARTIFACT_NAME)
  assert.ok(candidates.length <= 1, 'workflow run has multiple release candidates')
  const candidate = candidates[0]
  assert.ok(!candidate?.expired, 'saved candidate expired; preserve the original Release bytes')
  assert.ok(
    candidate || runAttempt === '1',
    'Saved candidate is missing on a rerun. Re-run only the publication job with its saved candidate.'
  )
  return candidate
}

export async function captureCandidates({
  workspace,
  deliveryDirectory,
  repository,
  provenance,
  previousVersion,
  publishedTags = new Set(),
  pendingPackages = new Set(),
  build = () => {},
}) {
  await mkdir(deliveryDirectory, { recursive: true })
  const candidates = []
  for (const entry of await readdir(path.join(workspace, 'extensions'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = entry.name
    const packagePath = path.join(workspace, 'extensions', directory, 'package.json')
    let manifest
    try {
      manifest = await readJson(packagePath)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!manifest.inkcre?.module_federation || pendingPackages.has(manifest.name)) continue
    const name = manifest.inkcre.name
    const version = manifest.version
    if (previousVersion(directory) === version || publishedTags.has(tagFor(name, version))) continue

    build(directory)
    const output = path.join(deliveryDirectory, directory)
    const { body, archive, artifactCommit } = await prepareRepositoryExtension({
      workspace,
      directory,
      output,
      repository,
      sourceRevision: provenance.source_revision,
    })
    // The ZIP is the sole saved artifact. The exact Git commit can be rebuilt from it.
    await rm(path.join(output, 'site'), { recursive: true })
    candidates.push({
      directory,
      name,
      version,
      body,
      artifact_commit: artifactCommit,
      digest: digest(await readFile(archive)),
    })
  }
  const plan = { ...provenance, repository, candidates }
  await writeFile(path.join(deliveryDirectory, 'plan.json'), JSON.stringify(plan) + '\n', {
    flag: 'wx',
  })
  return plan
}

export async function publishArtifact({
  workspace,
  deliveryDirectory,
  repository,
  sourceRevision,
  candidate,
  remote = 'origin',
  fetchImplementation = fetch,
}) {
  const archive = path.join(deliveryDirectory, candidate.directory, ARCHIVE_NAME)
  assert.equal(digest(await readFile(archive)), candidate.digest, 'saved ZIP digest differs')
  const tree = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-tree-'))
  try {
    execFileSync('unzip', ['-q', archive, '-d', tree])
    const local = await inspectNativeModuleFederation({
      packagePath: path.join(workspace, 'extensions', candidate.directory, 'package.json'),
      corePackagePath: path.join(workspace, 'packages/core/package.json'),
      artifactDirectory: tree,
      publicPath: 'auto',
    })
    assert.equal(local.name, candidate.name)
    assert.equal(local.version, candidate.version)
    const commit = await buildArtifactCommit({ workspace, tree, sourceRevision, ...local })
    assert.equal(
      commit,
      candidate.artifact_commit,
      'saved ZIP rebuilds a different artifact commit'
    )
    const manifestUrl = artifactManifestUrl(repository, commit)
    assert.equal(candidate.body, repositoryReleaseBody(candidate.directory, local, manifestUrl))

    const artifactRef = 'refs/tags/inkcre-mf/' + candidate.name + '/v' + candidate.version
    // No force push: a retry can recreate the exact ref but cannot change a published version.
    execFileSync('git', ['push', remote, commit + ':' + artifactRef], { cwd: workspace })
    await verifyHostedArtifact(manifestUrl, tree, local.remote_entry, fetchImplementation)
  } finally {
    await rm(tree, { recursive: true, force: true })
  }
}

async function verifyHostedArtifact(manifestUrl, tree, remoteEntry, fetchImplementation) {
  for (const file of ['mf-manifest.json', remoteEntry]) {
    const url = new URL(file, manifestUrl)
    const response = await fetchImplementation(url, {
      headers: { Origin: 'https://app.inkcre.dev' },
      signal: AbortSignal.timeout(30_000),
    })
    assert.ok(response.ok, url.href + ' returned HTTP ' + response.status)
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      '*',
      'CDN CORS verification failed'
    )
    const contentType = response.headers.get('content-type')?.split(';')[0]
    if (file === 'mf-manifest.json') assert.equal(contentType, 'application/json')
    else assert.ok(['application/javascript', 'text/javascript'].includes(contentType))
    const [remote, local] = await Promise.all([
      response.arrayBuffer().then((buffer) => Buffer.from(buffer)),
      readFile(path.join(tree, file)),
    ])
    assert.ok(remote.equals(local), 'CDN bytes differ: ' + url.href)
  }
}

function releaseAsset(release) {
  const asset = release.assets.find((item) => item.name === ARCHIVE_NAME)
  assert.ok(asset, 'Release is missing ' + ARCHIVE_NAME + ': ' + release.tag_name)
  return asset
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
}

function api(endpoint, args = []) {
  return JSON.parse(gh(['api', endpoint, ...args]))
}

function listReleases(repository) {
  return api('repos/' + repository + '/releases?per_page=100', ['--paginate', '--slurp']).flat()
}

async function publishCandidates({ repository, plan, deliveryDirectory, workspace }) {
  if (!plan.candidates.length) return
  const base = 'repos/' + repository + '/releases'
  const releases = listReleases(repository)
  for (const candidate of plan.candidates) {
    const tag = tagFor(candidate.name, candidate.version)
    const tagPath = '/tags/' + encodeURIComponent(tag)
    const git = 'repos/' + repository + '/git/'
    const existingTag = api(git + 'matching-refs' + tagPath).find(
      (item) => item.ref === 'refs/tags/' + tag
    )
    if (existingTag) assert.equal(existingTag.object.sha, plan.source_revision)
    await publishArtifact({
      workspace,
      deliveryDirectory,
      repository,
      sourceRevision: plan.source_revision,
      candidate,
    })
    let release =
      releases.find((item) => item.tag_name === tag) ??
      api(base, [
        '--method',
        'POST',
        '-f',
        'tag_name=' + tag,
        '-f',
        'name=' + tag,
        '-f',
        'target_commitish=' + plan.source_revision,
        '-f',
        'body=' + candidate.body,
        '-F',
        'draft=true',
      ])
    assert.equal(release.body, candidate.body)
    if (release.draft) {
      assert.equal(release.target_commitish, plan.source_revision)
      if (!release.assets.some((item) => item.name === ARCHIVE_NAME)) {
        const upload =
          'https://uploads.github.com/' + base + '/' + release.id + '/assets?name=' + ARCHIVE_NAME
        api(upload, [
          '--method',
          'POST',
          '-H',
          'Content-Type: application/zip',
          '--input',
          path.join(deliveryDirectory, candidate.directory, ARCHIVE_NAME),
        ])
        release = api(base + '/' + release.id)
      }
      assert.equal(releaseAsset(release).digest, candidate.digest)
      api(base + '/' + release.id, [
        '--method',
        'PATCH',
        '-F',
        'draft=false',
        '-f',
        'make_latest=false',
      ])
    }
    assert.equal(api(git + 'ref' + tagPath).object.sha, plan.source_revision)
    const published = api(base + tagPath)
    assert.equal(published.draft, false)
    assert.equal(published.body, candidate.body)
    assert.equal(releaseAsset(published).digest, candidate.digest)
    console.log('Published ' + tag + ' (' + candidate.digest + ')')
  }
}

async function main() {
  const [, , command] = process.argv
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: runAttempt,
    GITHUB_OUTPUT: output,
    SOURCE_REVISION: revision,
    BEFORE_SHA: before,
  } = process.env
  assert.ok(repository && runId && output, 'publication requires the current GitHub workflow run')
  if (command === 'locate') {
    const pages = api('repos/' + repository + '/actions/runs/' + runId + '/artifacts', [
      '--paginate',
      '--slurp',
    ])
    const candidate = selectSavedCandidate(
      pages.flatMap((page) => page.artifacts),
      runAttempt
    )
    await appendFile(output, 'artifact_id=' + (candidate?.id ?? '') + '\n')
    return
  }
  assert.match(revision, /^[a-f0-9]{40}$/, 'exact candidate source revision is required')
  const workspace = process.cwd()
  const options = {
    workspace,
    deliveryDirectory: path.resolve('.extension-delivery'),
    repository,
    provenance: { source_revision: revision, run_id: runId },
  }
  if (command === 'capture') {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-intent-'))
    try {
      const statusPath = path.join(temporary, 'status.json')
      execFileSync('pnpm', ['exec', 'changeset', 'status', '--output', statusPath], {
        stdio: 'inherit',
      })
      const status = await readJson(statusPath)
      const pendingPackages = new Set(
        status.changesets.flatMap((changeset) => changeset.releases.map((release) => release.name))
      )
      const baseRevision =
        before || execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim()
      assert.match(baseRevision, /^[a-f0-9]{40}$/)
      execFileSync('git', ['merge-base', '--is-ancestor', baseRevision, revision])
      const previousVersion = (directory) => {
        const file = 'extensions/' + directory + '/package.json'
        if (!execFileSync('git', ['ls-tree', baseRevision, '--', file], { encoding: 'utf8' }))
          return
        return JSON.parse(
          execFileSync('git', ['show', baseRevision + ':' + file], { encoding: 'utf8' })
        ).version
      }
      const publishedTags = new Set(
        listReleases(repository)
          .filter((release) => !release.draft)
          .map((release) => release.tag_name)
      )
      let coreBuilt = false
      const build = (directory) => {
        if (!coreBuilt) {
          execFileSync('pnpm', ['--filter', '@inkcre/core', 'build'], { stdio: 'inherit' })
          coreBuilt = true
        }
        execFileSync('pnpm', ['--filter', './extensions/' + directory, 'build'], {
          stdio: 'inherit',
        })
      }
      await captureCandidates({
        ...options,
        previousVersion,
        publishedTags,
        pendingPackages,
        build,
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  } else if (command === 'publish') {
    const plan = await readJson(path.join(options.deliveryDirectory, 'plan.json'))
    assert.deepEqual(
      { source_revision: plan.source_revision, run_id: plan.run_id, repository: plan.repository },
      { ...options.provenance, repository },
      'saved candidate belongs to a different source revision, workflow run or repository'
    )
    await publishCandidates({ ...options, plan })
  } else {
    throw new Error('unsupported command: ' + command)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[ERROR] ' + error.message)
    process.exitCode = 1
  })
}
