import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRepositoryExtension } from './prepare-repository-extension.mjs'
import {
  githubApi as api,
  listReleases,
  publishExtension,
  tagFor,
} from './extension-release/publish.mjs'

const ARTIFACT_NAME = 'first-party-extension-candidate'
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

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
    const { candidate } = await prepareRepositoryExtension({
      workspace,
      directory,
      output,
      repository,
      sourceRevision: provenance.source_revision,
    })
    // Keep only the distributable and its release plan for exact retries.
    await rm(path.join(output, 'site'), { recursive: true, force: true })
    candidates.push({ ...candidate, directory })
  }
  const plan = { ...provenance, repository, candidates }
  await writeFile(path.join(deliveryDirectory, 'plan.json'), JSON.stringify(plan) + '\n', {
    flag: 'wx',
  })
  return plan
}

async function publishCandidates({ repository, plan, deliveryDirectory, workspace }) {
  if (!plan.candidates.length) return
  const releases = listReleases(repository)
  for (const candidate of plan.candidates) {
    const tag = await publishExtension({
      workspace,
      repository,
      sourceRevision: plan.source_revision,
      candidate,
      asset: path.join(deliveryDirectory, candidate.directory, candidate.asset_name),
      releases,
    })
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
