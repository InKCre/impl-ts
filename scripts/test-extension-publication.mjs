import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { captureCandidates, selectSavedCandidate } from './publish-first-party-extensions.mjs'
import { publishArtifact, publishExtension } from './extension-release/publish.mjs'
import { ARCHIVE_NAME, prepareExtension } from './prepare-repository-extension.mjs'
import {
  prepareBody,
  previewRelease,
  readAssociation,
} from './verify-native-extension-distribution.mjs'

void test('a rerun cannot replace a missing or expired release candidate', () => {
  const candidate = { id: 42, name: 'first-party-extension-candidate', expired: false }
  const unrelated = { id: 43, name: 'other-artifact', expired: false }
  assert.equal(selectSavedCandidate([unrelated], '1'), undefined)
  assert.equal(selectSavedCandidate([unrelated, candidate], '2'), candidate)
  assert.throws(() => selectSavedCandidate([unrelated], '2'), /missing on a rerun/)
  assert.throws(() => selectSavedCandidate([{ ...candidate, expired: true }], '2'), /expired/)
  assert.throws(() => selectSavedCandidate([candidate, candidate], '2'), /multiple/)
  assert.throws(() => selectSavedCandidate([], undefined), /current GitHub run attempt/)
})

void test('the saved ZIP recreates its artifact commit and later publishes preserve older artifact tags', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'inkcre-publication-test-'))
  const remote = path.join(workspace, 'remote.git')
  const repository = 'InKCre/impl-ts'
  const extension = path.join(workspace, 'extensions/mail')
  const build = path.join(extension, 'dist/web')
  const writeJson = (file, object) => writeFile(file, JSON.stringify(object))
  const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim()
  const remoteGit = (...args) => git('--git-dir=' + remote, ...args)
  const artifactTag = (version) => 'refs/tags/inkcre-mf/inkcre/mail/v' + version

  try {
    git('init', '-q')
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'Source'
    )
    const sourceRevision = git('rev-parse', 'HEAD')
    git('init', '--bare', '-q', remote)
    const core = path.join(workspace, 'packages/core')
    await mkdir(core, { recursive: true })
    await writeJson(path.join(core, 'package.json'), { version: '0.4.3' })
    await mkdir(path.join(build, 'assets'), { recursive: true })
    await writeFile(path.join(build, 'assets/async.js'), 'export default "async chunk"')
    await writeJson(path.join(build, 'mf-manifest.json'), {
      metaData: { publicPath: './', remoteEntry: { name: 'remoteEntry.js' } },
      shared: [{ name: '@inkcre/core', requiredVersion: '^0.4.0' }],
      exposes: [{ assets: { js: { async: ['assets/async.js'] } } }],
    })

    const requests = []
    const fetchImplementation = async (url) => {
      const apiPath = /^\/gh\/InKCre\/impl-ts@([a-f0-9]{40})\/(.+)$/.exec(url.pathname)
      assert.equal(url.origin, 'https://cdn.jsdelivr.net')
      assert.ok(apiPath)
      const [, commit, file] = apiPath
      assert.ok(remoteGit('tag', '--points-at', commit).startsWith('inkcre-mf/'))
      requests.push(url.href)
      return new Response(
        execFileSync('git', ['--git-dir=' + remote, 'show', commit + ':' + file]),
        {
          headers: {
            'access-control-allow-origin': '*',
            'content-type': file.endsWith('.json') ? 'application/json' : 'text/javascript',
          },
        }
      )
    }

    async function saveVersion(
      version,
      previousVersion,
      { servedVersion = version, pythonRepository } = {}
    ) {
      const deliveryDirectory = await mkdtemp(path.join(workspace, 'candidate-'))
      await writeJson(path.join(extension, 'package.json'), {
        name: '@inkcre/ext-mail',
        version,
        inkcre: {
          name: 'inkcre/mail',
          nickname: 'Mail',
          module_federation: {
            host_sdk: '@inkcre/core',
            host_sdk_version: '^0.4.0',
            python_repository: pythonRepository,
          },
        },
      })
      await writeFile(path.join(build, 'remoteEntry.js'), 'export default "' + servedVersion + '"')
      const plan = await captureCandidates({
        workspace,
        repository,
        provenance: { source_revision: sourceRevision, run_id: 'fixture-run' },
        deliveryDirectory,
        previousVersion: () => previousVersion,
      })
      return {
        workspace,
        deliveryDirectory,
        repository,
        sourceRevision,
        remote,
        fetchImplementation,
        candidate: plan.candidates[0],
        asset: path.join(deliveryDirectory, 'mail', ARCHIVE_NAME),
      }
    }

    const previous = await saveVersion('0.4.0', '0.3.0')
    assert.ok(
      !Object.hasOwn(JSON.parse(previous.candidate.body.split('\n')[1]), 'python_repository')
    )
    await publishArtifact(previous)
    const previousCommit = remoteGit('rev-parse', artifactTag('0.4.0'))
    assert.equal(previousCommit, previous.candidate.artifact_commit)
    assert.equal(remoteGit('rev-list', '--count', previousCommit), '1')

    const pythonRepository = ' HTTPS://GITHUB.COM/PartnerOrg/PythonKit.git/ '
    const current = await saveVersion('0.4.1', '0.4.0', { pythonRepository })
    const candidate = current.candidate
    const archive = path.join(current.deliveryDirectory, 'mail', ARCHIVE_NAME)
    const descriptor = JSON.parse(candidate.body.split('\n')[1])
    assert.equal(
      descriptor.manifest_url,
      'https://cdn.jsdelivr.net/gh/InKCre/impl-ts@' +
        candidate.artifact_commit +
        '/mf-manifest.json'
    )
    assert.equal(descriptor.source_path, 'extensions/mail')
    assert.equal(descriptor.python_repository, 'https://github.com/PartnerOrg/PythonKit')
    await writeFile(path.join(build, 'remoteEntry.js'), 'source build changed after capture')

    await publishArtifact(current)
    await publishArtifact(current)
    const currentCommit = remoteGit('rev-parse', artifactTag('0.4.1'))
    assert.equal(currentCommit, candidate.artifact_commit)
    assert.equal(remoteGit('rev-parse', artifactTag('0.4.0')), previousCommit)
    assert.equal(remoteGit('show', previousCommit + ':remoteEntry.js'), 'export default "0.4.0"')
    assert.equal(remoteGit('show', currentCommit + ':remoteEntry.js'), 'export default "0.4.1"')
    assert.equal(
      JSON.parse(remoteGit('show', currentCommit + ':mf-manifest.json')).metaData.publicPath,
      'auto'
    )
    assert.equal(
      remoteGit('show', currentCommit + ':assets/async.js'),
      'export default "async chunk"'
    )
    assert.equal(requests.length, 6)
    assert.equal(git('diff', '--cached'), '')

    await assert.rejects(
      publishArtifact({
        ...current,
        fetchImplementation: async (url) => {
          const response = await fetchImplementation(url)
          return url.pathname.endsWith('/remoteEntry.js')
            ? new Response('wrong bytes', { headers: response.headers })
            : response
        },
      }),
      /CDN bytes differ/
    )
    const bytes = await readFile(archive)
    await writeFile(archive, 'incorrect archive')
    await assert.rejects(publishArtifact(current), /saved artifact digest differs/)
    await writeFile(archive, bytes)

    const conflict = await saveVersion('0.4.1', '0.4.0', {
      servedVersion: 'different-candidate',
      pythonRepository,
    })
    await assert.rejects(publishArtifact(conflict), /failed to push some refs/)
    assert.equal(remoteGit('rev-parse', artifactTag('0.4.1')), currentCommit)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

void test('a publisher script release uploads one JavaScript asset without pushing a separate Git tag', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'inkcre-classic-publication-'))
  const repository = 'external/extension'
  const sourceRevision = 'a'.repeat(40)
  const pythonRepository = 'https://github.com/external/python'
  const extensionPackage = {
    version: '1.0.0',
    inkcre: {
      name: 'external/fixture',
      module_federation: {
        host_sdk: '@inkcre/core',
        host_sdk_version: '^0.4.0',
        python_repository: pythonRepository,
      },
    },
  }
  const base = 'repos/' + repository + '/releases'
  const tag = 'inkcre-ext/external/fixture/module_federation/v1.0.0'
  const tagSuffix = '/tags/' + encodeURIComponent(tag)
  const release = {
    id: 1,
    tag_name: tag,
    draft: true,
    target_commitish: sourceRevision,
    assets: [],
  }
  const writes = []
  try {
    const packagePath = path.join(workspace, 'package.json')
    const artifactDirectory = path.join(workspace, 'build')
    await mkdir(artifactDirectory)
    await writeFile(packagePath, JSON.stringify(extensionPackage))
    await writeFile(
      path.join(artifactDirectory, 'mf-manifest.json'),
      JSON.stringify({
        metaData: { publicPath: './', remoteEntry: { type: 'module', name: 'remoteEntry.js' } },
        shared: [{ name: '@inkcre/core', requiredVersion: '^0.4.0' }],
      })
    )
    await writeFile(
      path.join(artifactDirectory, 'remoteEntry.js'),
      'export function init() {} export function get() { return () => 42; }'
    )
    const { candidate, asset } = await prepareExtension({
      workspace,
      packagePath,
      artifactDirectory,
      output: path.join(workspace, 'output'),
      repository,
      sourceRevision,
      format: 'script',
    })
    const association = readAssociation(extensionPackage)
    assert.equal(previewRelease(association).module_federation.python_repository, undefined)
    assert.equal(
      prepareBody(association, {
        source_repository: 'https://github.com/' + repository,
        source_revision: sourceRevision,
      }).module_federation.python_repository,
      undefined
    )

    function api(endpoint, args = []) {
      switch (endpoint) {
        case 'repos/' + repository + '/git/matching-refs' + tagSuffix:
          return []
        case 'repos/' + repository + '/git/ref' + tagSuffix:
          return { object: { sha: sourceRevision } }
        case base + tagSuffix:
          return release
        case base:
          assert.ok(args.includes('target_commitish=' + sourceRevision))
          assert.ok(args.includes('draft=true'))
          assert.ok(args.includes('tag_name=' + tag))
          release.body = args.find((arg) => arg.startsWith('body=')).slice(5)
          writes.push('draft')
          return release
        case 'https://uploads.github.com/' + base + '/1/assets?name=module-federation.js':
          assert.ok(args.includes('Content-Type: text/javascript'))
          assert.equal(args[args.indexOf('--input') + 1], asset)
          release.assets.push({ name: candidate.asset_name, digest: candidate.digest })
          writes.push('attach')
          return release.assets[0]
        case base + '/1':
          if (args.includes('draft=false')) {
            release.draft = false
            writes.push('publish')
          }
          return release
        default:
          throw new Error('unexpected GitHub API path ' + endpoint)
      }
    }

    const options = { workspace, repository, sourceRevision, candidate, asset, api, releases: [] }
    assert.equal(await publishExtension(options), tag)
    const metadata = JSON.parse(release.body.split('\n')[1])
    assert.equal(metadata.source_path, '.')
    assert.equal(metadata.python_repository, pythonRepository)
    assert.equal(metadata.script.asset_name, 'module-federation.js')
    assert.match(metadata.script.global_name, /^inkcre_mf_[a-f0-9]+$/)
    assert.equal(metadata.manifest_url, undefined)
    assert.equal(release.assets.length, 1)
    assert.equal(await publishExtension({ ...options, releases: [release] }), tag)
    assert.deepEqual(writes, ['draft', 'attach', 'publish'])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
