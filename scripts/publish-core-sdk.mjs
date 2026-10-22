import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = '.core-sdk-delivery'
const artifactName = 'core-sdk-candidate'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

async function api(route) {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${route}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(30_000),
    }
  )
  if (response.status === 404) return null
  assert.ok(response.ok, `GitHub read returned HTTP ${response.status}`)
  return response.json()
}

async function releaseByTag(tag) {
  // Draft releases have no tag lookup until publication; list includes authenticated drafts.
  for (let page = 1; ; page += 1) {
    const releases = await api(`releases?per_page=100&page=${page}`)
    assert.ok(Array.isArray(releases), 'GitHub release inventory is unavailable')
    const release = releases.find((item) => item.tag_name === tag)
    if (release) return release
    if (releases.length < 100) return null
  }
}

export function validateRecoveryRun(run, comparison) {
  assert.equal(run.event, 'push', 'Recovery source must be an admitted main push')
  assert.equal(run.head_branch, 'main')
  assert.equal(run.path, '.github/workflows/core-sdk-release.yml')
  assert.equal(run.status, 'completed', 'Original SDK run must have completed')
  assert.match(run.head_sha, /^[0-9a-f]{40}$/)
  assert.ok(
    ['ahead', 'identical'].includes(comparison?.status),
    'Recovery source is not in current main history'
  )
  return run.head_sha
}

export function validateReceipt(receipt) {
  assert.equal(receipt.name, '@inkcre/core')
  assert.match(receipt.version, /^\d+\.\d+\.\d+$/)
  assert.match(receipt.source_revision, /^[0-9a-f]{40}$/)
  assert.equal(receipt.asset, `inkcre-core-${receipt.version}.tgz`)
  assert.match(receipt.sha256, /^[0-9a-f]{64}$/)
  return receipt
}

export function savedCandidate(artifacts, attempt, hasDraft = false) {
  const matches = artifacts.filter((artifact) => artifact.name === artifactName)
  assert.ok(matches.length <= 1, 'Multiple SDK candidates in one run')
  assert.ok(!matches[0]?.expired, 'SDK candidate expired; do not rebuild published bytes')
  assert.ok(
    matches[0] || !hasDraft,
    'Existing draft requires its original workflow candidate; do not rebuild in another run'
  )
  assert.ok(matches[0] || attempt === '1', 'Missing SDK candidate on rerun; restore original bytes')
  return matches[0]
}

async function assetBytes(asset, authenticated = false) {
  const response = await fetch(authenticated ? asset.url : asset.browser_download_url, {
    headers: authenticated
      ? { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' }
      : {},
    signal: AbortSignal.timeout(60_000),
  })
  assert.ok(response.ok, `SDK asset download returned HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function verifyRelease(release, version, expected) {
  assert.ok(!release.draft && !release.prerelease, 'SDK release is not public and final')
  const receiptAsset = release.assets.find((asset) => asset.name === 'source.json')
  assert.ok(receiptAsset, 'SDK source receipt is missing')
  const receipt = validateReceipt(JSON.parse((await assetBytes(receiptAsset)).toString()))
  assert.equal(receipt.version, version)
  if (expected)
    assert.deepEqual(receipt, expected, 'Existing SDK coordinate belongs to other bytes/source')
  const tag = await api(`git/ref/tags/core-v${version}`)
  assert.equal(tag?.object.type, 'commit', 'SDK tag must directly identify its source commit')
  assert.equal(tag.object.sha, receipt.source_revision)
  const archive = release.assets.find((asset) => asset.name === receipt.asset)
  assert.ok(archive, 'SDK archive is missing')
  assert.equal(
    digest(await assetBytes(archive)),
    receipt.sha256,
    'SDK public bytes differ from receipt'
  )
  return receipt
}

async function checkCandidate() {
  const receipt = validateReceipt(await readJson(`${directory}/source.json`))
  assert.equal(receipt.source_revision, process.env.SOURCE_REVISION)
  assert.equal(digest(await readFile(`${directory}/${receipt.asset}`)), receipt.sha256)
  return receipt
}

export async function main(command) {
  const metadata = await readJson('packages/core/package.json')
  const version = metadata.version
  assert.match(version, /^\d+\.\d+\.\d+$/)
  const tag = `core-v${version}`
  if (command === 'locate') {
    const recoveryId = process.env.RECOVERY_RUN_ID
    let payloadSource = process.env.SOURCE_REVISION
    const runId = recoveryId || process.env.GITHUB_RUN_ID
    if (recoveryId) {
      assert.match(recoveryId, /^[1-9]\d*$/)
      const run = await api(`actions/runs/${recoveryId}`)
      assert.ok(run, 'Original SDK run is missing')
      payloadSource = validateRecoveryRun(
        run,
        await api(`compare/${run.head_sha}...${payloadSource}`)
      )
    }
    const release = recoveryId ? null : await releaseByTag(tag)
    if (release && !release.draft) {
      await verifyRelease(release, version)
      await appendFile(process.env.GITHUB_OUTPUT, 'published=true\n')
      return
    }
    const pages = JSON.parse(
      gh([
        'api',
        `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}/artifacts`,
        '--paginate',
        '--slurp',
      ])
    )
    const saved = savedCandidate(
      pages.flatMap((page) => page.artifacts),
      recoveryId ? '2' : process.env.GITHUB_RUN_ATTEMPT,
      Boolean(release?.draft)
    )
    if (saved)
      assert.equal(
        saved.workflow_run?.head_sha,
        payloadSource,
        'Saved SDK artifact belongs to another source'
      )
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `artifact_id=${saved?.id ?? ''}\nsource_revision=${payloadSource}\npayload_run_id=${runId}\n`
    )
    return
  }
  if (command === 'capture') {
    await mkdir(directory, { recursive: false })
    execFileSync(
      'pnpm',
      ['--filter', '@inkcre/core', 'pack', '--pack-destination', path.resolve(directory)],
      { stdio: 'inherit' }
    )
    const asset = `inkcre-core-${version}.tgz`
    const receipt = validateReceipt({
      name: metadata.name,
      version,
      source_revision: process.env.SOURCE_REVISION,
      asset,
      sha256: digest(await readFile(`${directory}/${asset}`)),
    })
    await writeFile(`${directory}/source.json`, `${JSON.stringify(receipt, null, 2)}\n`)
    return
  }
  const receipt = await checkCandidate()
  if (command === 'check') return
  assert.equal(command, 'publish')
  const payloadTag = `core-v${receipt.version}`
  let release = await releaseByTag(payloadTag)
  if (!release) {
    // The create response owns the new identity; immediate list reads can still omit it.
    release = JSON.parse(
      gh([
        'api',
        `repos/${process.env.GITHUB_REPOSITORY}/releases`,
        '--method',
        'POST',
        '-f',
        `tag_name=${payloadTag}`,
        '-f',
        `target_commitish=${receipt.source_revision}`,
        '-f',
        `name=Core SDK ${receipt.version}`,
        '-f',
        `body=预构建 ESM 与类型包；来源 ${receipt.source_revision}。source.json 记录 SHA256。`,
        '-F',
        'draft=true',
      ])
    )
  }
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'GitHub release ID is invalid')
  assert.equal(release.tag_name, payloadTag)
  if (release.draft) {
    const tagRef = await api(`git/ref/tags/${payloadTag}`)
    assert.equal(
      release.target_commitish,
      receipt.source_revision,
      'Draft belongs to another source'
    )
    if (tagRef)
      assert.equal(
        tagRef.object.sha,
        receipt.source_revision,
        'Draft tag belongs to another source'
      )
    for (const name of [receipt.asset, 'source.json']) {
      const local = await readFile(`${directory}/${name}`)
      const existing = release.assets.find((asset) => asset.name === name)
      if (existing)
        assert.equal(
          digest(await assetBytes(existing, true)),
          digest(local),
          'Existing draft asset differs; never overwrite'
        )
      else {
        const upload = `https://uploads.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`
        const asset = JSON.parse(
          gh([
            'api',
            upload,
            '--method',
            'POST',
            '-H',
            'Content-Type: application/octet-stream',
            '--input',
            `${directory}/${name}`,
          ])
        )
        assert.equal(asset.name, name)
        release.assets.push(asset)
      }
    }
    const releaseId = release.id
    release = JSON.parse(
      gh([
        'api',
        `repos/${process.env.GITHUB_REPOSITORY}/releases/${releaseId}`,
        '--method',
        'PATCH',
        '-F',
        'draft=false',
      ])
    )
    assert.equal(release.id, releaseId)
    assert.equal(release.tag_name, payloadTag)
  }
  await verifyRelease(release, receipt.version, receipt)
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Core SDK ${receipt.version}: ${receipt.source_revision}; SHA256 ${receipt.sha256}\n`
    )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2])
}
