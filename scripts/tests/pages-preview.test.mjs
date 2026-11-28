import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const requireRuntime = createRequire(requireWeb.resolve('@module-federation/runtime'))
const { generateSnapshotFromManifest } = requireRuntime('@module-federation/sdk')

void test('preview MF resolves from its selected snapshot and records its build identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkcre-preview-'))
  const path = 'extensions/inkcre/example/1.0.0/module-federation'
  const manifest = {
    metaData: {
      publicPath: `https://moving-pr.pages.dev/${path}/`,
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
      buildInfo: { buildVersion: '1.0.0' },
    },
    shared: [],
    exposes: [],
  }
  const prepare = () =>
    promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../prepare-pages-preview.mjs', import.meta.url)), root],
      {
        env: {
          ...process.env,
          INKCRE_PREVIEW_SOURCE_SHA: 'a'.repeat(40),
          GITHUB_RUN_ID: '123',
          GITHUB_RUN_ATTEMPT: '1',
        },
      }
    )
  try {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, 'mf-manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, path, 'remoteEntry.js'), 'export const candidate = "A"')
    await prepare()
    const receipt = JSON.parse(await readFile(join(root, 'preview-candidate.json'), 'utf8'))
    assert.deepEqual(receipt, {
      source_revision: 'a'.repeat(40),
      build_id: '123-1',
      distributions: [{ manifest: `/${path}/mf-manifest.json` }],
    })
    const prepared = JSON.parse(await readFile(join(root, path, 'mf-manifest.json'), 'utf8'))
    assert.deepEqual(prepared, {
      ...manifest,
      metaData: { ...manifest.metaData, publicPath: 'auto' },
    })
    const origin = 'https://snapshot-a.pages.dev'
    const snapshot = generateSnapshotFromManifest(prepared, {
      version: `${origin}/${path}/mf-manifest.json`,
    })
    assert.equal(
      `${snapshot.publicPath}${snapshot.remoteEntry}`,
      `${origin}/${path}/remoteEntry.js`
    )
    await symlink(join(root, path, 'remoteEntry.js'), join(root, path, 'linked.js'))
    await assert.rejects(prepare(), /symbolic links/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
