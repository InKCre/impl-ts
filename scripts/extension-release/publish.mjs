import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  artifactDigest,
  buildArtifactCommit,
  releaseTransport,
  repositoryReleaseBody,
} from '../prepare-repository-extension.mjs'
import {
  inspectNativeModuleFederation,
  readAssociation,
} from '../verify-native-extension-distribution.mjs'

export const tagFor = (name, version) => 'inkcre-ext/' + name + '/module_federation/v' + version

export async function publishArtifact({
  workspace,
  asset,
  repository,
  sourceRevision,
  candidate,
  remote = 'origin',
  fetchImplementation = fetch,
}) {
  assert.equal(await artifactDigest(asset), candidate.digest, 'saved artifact digest differs')
  const packagePath = path.join(workspace, candidate.source_path, 'package.json')
  const local = readAssociation(JSON.parse(await readFile(packagePath, 'utf8')))
  assert.equal(local.name, candidate.name)
  assert.equal(local.version, candidate.version)
  const transport = await releaseTransport({ repository, ...candidate })
  assert.equal(candidate.body, repositoryReleaseBody(candidate.source_path, local, transport))
  if (candidate.format === 'script') return

  const tree = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-tree-'))
  try {
    execFileSync('unzip', ['-q', asset, '-d', tree])
    const verified = await inspectNativeModuleFederation({
      packagePath,
      artifactDirectory: tree,
      publicPath: 'auto',
    })
    const commit = await buildArtifactCommit({ workspace, tree, sourceRevision, ...local })
    assert.equal(
      commit,
      candidate.artifact_commit,
      'saved ZIP rebuilds a different artifact commit'
    )
    const artifactRef = 'refs/tags/inkcre-mf/' + candidate.name + '/v' + candidate.version
    // A retry can push the exact ref again. Git rejects a different object at an existing tag.
    execFileSync('git', ['push', remote, commit + ':' + artifactRef], { cwd: workspace })
    await verifyHostedArtifact(
      transport.manifest_url,
      tree,
      verified.remote_entry,
      fetchImplementation
    )
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

export function githubApi(endpoint, args = []) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  )
}

export function listReleases(repository, api = githubApi) {
  return api('repos/' + repository + '/releases?per_page=100', ['--paginate', '--slurp']).flat()
}

export async function publishExtension(options) {
  const { candidate, repository, sourceRevision, asset, api = githubApi } = options
  const releases = options.releases ?? listReleases(repository, api)
  const base = 'repos/' + repository + '/releases'
  const tag = tagFor(candidate.name, candidate.version)
  const tagPath = '/tags/' + encodeURIComponent(tag)
  const git = 'repos/' + repository + '/git/'
  const existingTag = api(git + 'matching-refs' + tagPath).find(
    (item) => item.ref === 'refs/tags/' + tag
  )
  if (existingTag) assert.equal(existingTag.object.sha, sourceRevision)

  await publishArtifact(options)
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
      'target_commitish=' + sourceRevision,
      '-f',
      'body=' + candidate.body,
      '-F',
      'draft=true',
    ])
  assert.equal(release.body, candidate.body)
  const assetName = candidate.asset_name
  if (release.draft) {
    assert.equal(release.target_commitish, sourceRevision)
    if (!release.assets.some((item) => item.name === assetName)) {
      const upload =
        'https://uploads.github.com/' + base + '/' + release.id + '/assets?name=' + assetName
      const contentType = candidate.format === 'manifest' ? 'application/zip' : 'text/javascript'
      api(upload, ['--method', 'POST', '-H', 'Content-Type: ' + contentType, '--input', asset])
      release = api(base + '/' + release.id)
    }
    assert.equal(release.assets.find((item) => item.name === assetName)?.digest, candidate.digest)
    api(base + '/' + release.id, [
      '--method',
      'PATCH',
      '-F',
      'draft=false',
      '-f',
      'make_latest=false',
    ])
  }
  assert.equal(api(git + 'ref' + tagPath).object.sha, sourceRevision)
  const published = api(base + tagPath)
  assert.equal(published.draft, false)
  assert.equal(published.body, candidate.body)
  assert.equal(published.assets.find((item) => item.name === assetName)?.digest, candidate.digest)
  return tag
}
