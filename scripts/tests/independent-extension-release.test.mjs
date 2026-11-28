import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { inspectNativeModuleFederation } from '../verify-native-extension-distribution.mjs'

void test('MF snapshots reject incompatible, duplicate or undeclared UI shares', async () => {
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
    for (const [uiShares, declaresUi, error] of [
      [
        [{ ...uiShare, requiredVersion: '2.7.0' }],
        true,
        { code: 'ERR_ASSERTION', actual: '2.7.0', expected: '2.3.0' },
      ],
      [[uiShare, uiShare], true, /must not duplicate @inkcre\/ui-web shares/],
      [[uiShare], false, /shared @inkcre\/ui-web must declare the producer UI version/],
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
      await assert.rejects(inspect(), error)
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
