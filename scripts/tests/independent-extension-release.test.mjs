import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { captureCandidates } from '../publish-first-party-extensions.mjs'
import { inspectNativeModuleFederation } from '../verify-native-extension-distribution.mjs'

void test('MF snapshots permit unused UI dependencies and validate emitted UI shares', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'inkcre-ui-share-'))
  const packagePath = path.join(workspace, 'package.json')
  const corePackagePath = path.join(workspace, 'core.json')
  const manifestPath = path.join(workspace, 'mf-manifest.json')
  const metadata = {
    version: '0.2.1',
    devDependencies: { '@inkcre/ui-web': '2.3.0' },
    inkcre: {
      name: 'inkcre/capture',
      nickname: 'Capture',
      module_federation: { host_sdk: '@inkcre/core', host_sdk_version: '>=0.4.0 <0.5.0' },
    },
  }
  const coreShare = { name: '@inkcre/core', requiredVersion: '>=0.4.0 <0.5.0' }
  const uiShare = { name: '@inkcre/ui-web', requiredVersion: '2.3.0' }
  try {
    await writeFile(corePackagePath, JSON.stringify({ version: '0.4.3' }))
    await writeFile(path.join(workspace, 'remoteEntry.js'), 'export default {}')
    const inspect = () =>
      inspectNativeModuleFederation({ packagePath, corePackagePath, artifactDirectory: workspace })
    for (const [uiShares, declaresUi, valid] of [
      [[], true, true],
      [[uiShare], true, true],
      [[{ ...uiShare, requiredVersion: '2.7.0' }], true, false],
      [[uiShare, uiShare], true, false],
      [[uiShare], false, false],
    ]) {
      await writeFile(
        packagePath,
        JSON.stringify({ ...metadata, devDependencies: declaresUi ? metadata.devDependencies : {} })
      )
      await writeFile(
        manifestPath,
        JSON.stringify({
          metaData: { publicPath: './', remoteEntry: { name: 'remoteEntry.js' } },
          shared: [coreShare, ...uiShares],
          exposes: [],
        })
      )
      if (valid) assert.equal((await inspect()).name, 'inkcre/capture')
      else await assert.rejects(inspect(), assert.AssertionError)
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

void test('a prepared Mail release does not publish another producer with pending intent', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'inkcre-independent-release-'))
  const json = (file, value) => writeFile(path.join(workspace, file), JSON.stringify(value))
  try {
    await mkdir(path.join(workspace, 'packages/core'), { recursive: true })
    await json('packages/core/package.json', { version: '0.4.0' })
    for (const name of ['mail', 'new-producer']) {
      await mkdir(path.join(workspace, `extensions/${name}`), { recursive: true })
      await json(`extensions/${name}/package.json`, {
        name: `@inkcre/ext-${name}`,
        version: '0.4.0',
        inkcre: {
          name: `inkcre/${name}`,
          nickname: name,
          module_federation: { host_sdk: '@inkcre/core', host_sdk_version: '>=0.4.0 <0.6.0' },
        },
      })
    }
    const build = 'extensions/mail/dist/client-web'
    await mkdir(path.join(workspace, build), { recursive: true })
    await json(`${build}/mf-manifest.json`, {
      metaData: { publicPath: './', remoteEntry: { name: 'remoteEntry.js' } },
      shared: [{ name: '@inkcre/core', requiredVersion: '>=0.4.0 <0.6.0' }],
      exposes: [],
    })
    await writeFile(path.join(workspace, build, 'remoteEntry.js'), 'export default {}')
    const queried = []
    const plan = await captureCandidates({
      workspace,
      deliveryDirectory: path.join(workspace, 'candidate'),
      registryUrl: 'https://registry.example.test',
      provenance: {
        source_repository: 'https://github.com/InKCre/impl-ts',
        source_revision: 'reviewed-main',
        build_id: 'same-run',
      },
      pendingPackages: new Set(['@inkcre/core', '@inkcre/ext-new-producer']),
      fetchImplementation: async (url) => {
        queried.push(url.pathname)
        return new Response('{}', { status: 404 })
      },
    })
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.name),
      ['inkcre/mail']
    )
    assert.deepEqual(queried, [
      '/v2/extensions/inkcre/mail/distributions/module_federation/releases/0.4.0',
    ])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
