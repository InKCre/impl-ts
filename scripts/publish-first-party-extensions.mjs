import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  inspectNativeModuleFederation,
  listSnapshotFiles,
  prepareBody,
  verifyPublicModuleFederation,
} from './verify-native-extension-distribution.mjs'

const ARTIFACT_NAME = 'first-party-extension-candidate'
const OBJECTS_PENDING = 'Release native Distribution objects are not completely available'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const writeJson = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`)

export function selectSavedCandidate(artifacts, runAttempt) {
  assert.match(runAttempt, /^[1-9]\d*$/, 'current GitHub run attempt is required')
  const candidates = artifacts.filter((artifact) => artifact.name === ARTIFACT_NAME)
  assert.ok(candidates.length <= 1, 'workflow run has multiple release candidates')
  const candidate = candidates[0]
  assert.ok(!candidate?.expired, 'saved candidate expired; do not rebuild a prepared Release')
  // GitHub deletes artifacts on rerun-all. Only partial reruns can retain the original candidate.
  // ponytail: also reject pre-capture retries; operator review is safer than inferring prior writes.
  assert.ok(
    candidate || runAttempt === '1',
    'Saved candidate is missing on a rerun. Stop: never rebuild a possibly prepared Release. Use the original artifact and rerun only publication; see first-party delivery recovery guidance.'
  )
  return candidate
}

class RegistryError extends Error {
  constructor(stage, status, detail) {
    super(`${stage}: Registry HTTP ${status || 'unavailable'}: ${detail}`)
    this.status = status
    this.detail = detail
    this.uncertain = [0, 408, 500, 502, 503, 504].includes(status)
  }
}

async function request(url, options, fetchImplementation) {
  let response
  let body
  try {
    response = await fetchImplementation(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
    })
    body = await response.text()
  } catch (error) {
    throw new RegistryError(`${options.method ?? 'GET'} ${url.pathname}`, 0, error.message)
  }
  let result
  try {
    result = JSON.parse(body)
  } catch {
    result = { detail: body.slice(0, 500) }
  }
  if (!response.ok) {
    throw new RegistryError(
      `${options.method ?? 'GET'} ${url.pathname}`,
      response.status,
      result.detail ?? body.slice(0, 500)
    )
  }
  return result
}

function releaseUrl(registryUrl, name, version) {
  return new URL(
    `/v2/extensions/${name}/distributions/module_federation/releases/${version}`,
    registryUrl
  )
}

async function publicRelease(url, fetchImplementation) {
  try {
    const release = await request(url, {}, fetchImplementation)
    assert.equal(
      release.distribution,
      'module_federation',
      'Registry returned a different native distribution'
    )
    assert.equal(release.state, 'published', `cannot deliver a ${release.state} Release`)
    return release
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

export async function captureCandidates({
  workspace,
  deliveryDirectory,
  registryUrl,
  provenance,
  pendingPackages = new Set(),
  fetchImplementation = fetch,
}) {
  await mkdir(deliveryDirectory, { recursive: true })
  const candidates = []
  for (const directory of await readdir(path.join(workspace, 'extensions'), {
    withFileTypes: true,
  })) {
    if (!directory.isDirectory()) continue
    const packagePath = path.join(workspace, 'extensions', directory.name, 'package.json')
    let manifest
    try {
      manifest = await readJson(packagePath)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!manifest.inkcre?.module_federation) continue
    if (pendingPackages.has(manifest.name)) {
      console.log(
        `${manifest.inkcre.name}: release intent is still pending; no publication selected.`
      )
      continue
    }
    const existing = await publicRelease(
      releaseUrl(registryUrl, manifest.inkcre.name, manifest.version),
      fetchImplementation
    )
    if (existing?.module_federation) {
      console.log(
        `${manifest.inkcre.name} ${manifest.version}: historical Release, no publication selected.`
      )
      continue
    }
    const artifactDirectory = path.join(path.dirname(packagePath), 'dist/client-web')
    const local = await inspectNativeModuleFederation({
      packagePath,
      corePackagePath: path.join(workspace, 'packages/core/package.json'),
      artifactDirectory,
    })
    await listSnapshotFiles(artifactDirectory)
    const candidateDirectory = path.join(deliveryDirectory, directory.name)
    // A candidate is written once. Re-runs restore the saved artifact before entering this command.
    await mkdir(candidateDirectory)
    const prepare = prepareBody(local, provenance)
    await writeJson(path.join(candidateDirectory, 'prepare.json'), prepare)
    const archive = path.join(candidateDirectory, 'snapshot.zip')
    execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: artifactDirectory })
    candidates.push({
      directory: directory.name,
      name: local.name,
      version: local.version,
      sha256: sha256(await readFile(archive)),
    })
  }
  const plan = { ...provenance, registry_url: registryUrl, candidates }
  await writeJson(path.join(deliveryDirectory, 'plan.json'), plan)
  return plan
}

export async function checkCandidates({ workspace, deliveryDirectory, registryUrl, provenance }) {
  const plan = await readJson(path.join(deliveryDirectory, 'plan.json'))
  assert.deepEqual(
    {
      source_repository: plan.source_repository,
      source_revision: plan.source_revision,
      build_id: plan.build_id,
      registry_url: plan.registry_url,
    },
    { ...provenance, registry_url: registryUrl },
    'saved candidate must belong to this source revision, workflow run and Registry'
  )
  for (const candidate of plan.candidates) {
    assert.match(candidate.directory, /^[a-zA-Z0-9_-]+$/)
    const candidateDirectory = path.join(deliveryDirectory, candidate.directory)
    const archive = await readFile(path.join(candidateDirectory, 'snapshot.zip'))
    assert.equal(sha256(archive), candidate.sha256, `${candidate.name}: saved ZIP digest differs`)
    const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-candidate-'))
    try {
      execFileSync('unzip', [
        '-q',
        path.join(candidateDirectory, 'snapshot.zip'),
        '-d',
        artifactDirectory,
      ])
      const local = await inspectNativeModuleFederation({
        packagePath: path.join(workspace, 'extensions', candidate.directory, 'package.json'),
        corePackagePath: path.join(workspace, 'packages/core/package.json'),
        artifactDirectory,
      })
      await listSnapshotFiles(artifactDirectory)
      assert.equal(candidate.name, local.name)
      assert.equal(candidate.version, local.version)
      assert.deepEqual(
        await readJson(path.join(candidateDirectory, 'prepare.json')),
        prepareBody(local, provenance)
      )
    } finally {
      await rm(artifactDirectory, { recursive: true })
    }
  }
  return plan
}

async function finishPublication(url, token, fetchImplementation) {
  // A new MF-only Release stays invisible while preparing. Retry publish, not just public GET.
  for (let attempt = 0; attempt < 7; attempt++) {
    if (attempt) await setTimeout(5_000)
    try {
      const result = await request(
        new URL(`${url.pathname}/publish`, url),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
        fetchImplementation
      )
      if (result.state === 'published' && result.module_federation) return
    } catch (error) {
      if (!error.uncertain && !(error.status === 409 && error.detail === OBJECTS_PENDING))
        throw error
      console.warn(error.message)
    }
    try {
      const visible = await publicRelease(url, fetchImplementation)
      if (visible?.module_federation) return
    } catch (error) {
      if (!error.uncertain) throw error
      console.warn(error.message)
    }
  }
  throw new Error(
    'Publication is not confirmed. Re-run the failed job with its saved candidate; do not rebuild or replace the Release.'
  )
}

export async function publishCandidates(options) {
  const { workspace, deliveryDirectory, registryUrl, token, fetchImplementation = fetch } = options
  assert.ok(token, 'publisher token is required')
  const plan = await checkCandidates(options)
  for (const candidate of plan.candidates) {
    const candidateDirectory = path.join(deliveryDirectory, candidate.directory)
    const url = releaseUrl(registryUrl, candidate.name, candidate.version)
    const prepare = await readFile(path.join(candidateDirectory, 'prepare.json'))
    // prepare is idempotent and also checks immutable provenance before a resumed publication.
    await request(
      new URL(
        `/v2/extensions/${candidate.name}/distributions/module_federation/releases`,
        registryUrl
      ),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: prepare,
      },
      fetchImplementation
    )
    const existing = await publicRelease(url, fetchImplementation)
    if (!existing?.module_federation) {
      const form = new FormData()
      form.append(
        'content',
        new Blob([await readFile(path.join(candidateDirectory, 'snapshot.zip'))], {
          type: 'application/zip',
        }),
        'snapshot.zip'
      )
      try {
        await request(
          new URL(`${url.pathname}/module-federation`, url),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          },
          fetchImplementation
        )
      } catch (error) {
        if (!error.uncertain) throw error
        console.warn(`${error.message}; upload outcome is unknown, checking completion.`)
      }
      await finishPublication(url, token, fetchImplementation)
    }
    const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-verification-'))
    try {
      execFileSync('unzip', [
        '-q',
        path.join(candidateDirectory, 'snapshot.zip'),
        '-d',
        artifactDirectory,
      ])
      const result = await verifyPublicModuleFederation({
        registryUrl,
        packagePath: path.join(workspace, 'extensions', candidate.directory, 'package.json'),
        corePackagePath: path.join(workspace, 'packages/core/package.json'),
        artifactDirectory,
        fetchImplementation,
      })
      const summary = `${candidate.name} ${candidate.version}: published and verified (${result.verified_assets} files), ZIP SHA256 ${candidate.sha256}.\n`
      console.log(summary.trim())
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
    } finally {
      await rm(artifactDirectory, { recursive: true })
    }
  }
}

async function main() {
  const command = process.argv[2]
  if (command === 'locate') {
    const {
      GITHUB_REPOSITORY: repository,
      GITHUB_RUN_ID: runId,
      GITHUB_RUN_ATTEMPT: runAttempt,
      GITHUB_OUTPUT: output,
    } = process.env
    assert.ok(repository && runId && output, 'locate requires the current GitHub workflow run')
    const pages = JSON.parse(
      execFileSync(
        'gh',
        ['api', `repos/${repository}/actions/runs/${runId}/artifacts`, '--paginate', '--slurp'],
        { encoding: 'utf8' }
      )
    )
    const candidate = selectSavedCandidate(
      pages.flatMap((page) => page.artifacts),
      runAttempt
    )
    await appendFile(output, `artifact_id=${candidate?.id ?? ''}\n`)
    return
  }
  const {
    SOURCE_REPOSITORY: repository,
    SOURCE_REVISION: revision,
    GITHUB_RUN_ID: runId,
    INKCRE_EXTENSION_REGISTRY_URL: registryUrl,
  } = process.env
  assert.ok(
    repository && revision && runId && registryUrl,
    'source, workflow run and Registry are required'
  )
  assert.equal(new URL(registryUrl).protocol, 'https:', 'Registry must use HTTPS')
  const options = {
    workspace: process.cwd(),
    deliveryDirectory: path.resolve('.extension-delivery'),
    registryUrl,
    provenance: {
      source_repository: repository,
      source_revision: revision,
      build_id: `client-web-extension-release-${runId}`,
    },
  }
  if (command === 'capture') {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-intent-'))
    try {
      const statusPath = path.join(temporary, 'status.json')
      execFileSync('pnpm', ['exec', 'changeset', 'status', '--output', statusPath], {
        cwd: options.workspace,
        stdio: 'inherit',
      })
      const status = await readJson(statusPath)
      const pendingPackages = new Set(
        status.changesets.flatMap((changeset) => changeset.releases.map((release) => release.name))
      )
      await captureCandidates({ ...options, pendingPackages })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  } else if (command === 'check') await checkCandidates(options)
  else if (command === 'publish')
    await publishCandidates({ ...options, token: process.env.INKCRE_EXTENSION_REGISTRY_TOKEN })
  else throw new Error(`unsupported command: ${command}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[ERROR] ${error.message}`)
    process.exitCode = 1
  })
}
