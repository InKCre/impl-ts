import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectNativeModuleFederation } from '../verify-native-extension-distribution.mjs'

test('Twitter preview rejects Core 0.4.0 and accepts the Changesets-prepared 0.4.1 Host', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inkcre-preview-compat-'))
  const packagePath = path.join(root, 'extensions/twitter/package.json')
  const corePackagePath = path.join(root, 'packages/core/package.json')
  const artifactDirectory = path.join(root, 'artifact')
  try {
    await mkdir(path.dirname(packagePath), { recursive: true })
    await mkdir(path.dirname(corePackagePath), { recursive: true })
    await mkdir(artifactDirectory, { recursive: true })
    await writeFile(
      packagePath,
      JSON.stringify({
        version: '0.5.0',
        dependencies: { '@inkcre/core': 'workspace:*' },
        inkcre: {
          name: 'inkcre/twitter',
          nickname: 'Twitter',
          module_federation: {
            host_sdk: '@inkcre/core',
            host_sdk_version: '>=0.4.1 <0.5.0',
          },
        },
      })
    )
    await writeFile(
      path.join(artifactDirectory, 'mf-manifest.json'),
      JSON.stringify({
        name: 'twitter',
        metaData: { publicPath: './', remoteEntry: { name: 'remoteEntry.js' } },
        shared: [{ name: '@inkcre/core', requiredVersion: '>=0.4.1 <0.5.0' }],
        exposes: [],
      })
    )
    await writeFile(path.join(artifactDirectory, 'remoteEntry.js'), 'export {}')

    await writeFile(corePackagePath, JSON.stringify({ version: '0.4.0' }))
    await assert.rejects(
      inspectNativeModuleFederation({ packagePath, corePackagePath, artifactDirectory }),
      /does not satisfy >=0\.4\.1 <0\.5\.0/
    )

    await writeFile(corePackagePath, JSON.stringify({ version: '0.4.1' }))
    const accepted = await inspectNativeModuleFederation({
      packagePath,
      corePackagePath,
      artifactDirectory,
    })
    assert.equal(accepted.version, '0.5.0')
    assert.equal(accepted.module_federation.host_sdk_version, '>=0.4.1 <0.5.0')
    assert.deepEqual(accepted.referenced_assets, ['remoteEntry.js'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
