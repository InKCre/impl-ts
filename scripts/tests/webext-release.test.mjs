import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import {
  assertDraft,
  checkManifest,
  createDraftRelease,
  extensionId,
  preparedVersion,
} from '../webext-release.mjs'

const require = createRequire(new URL('../../apps/client-webext/package.json', import.meta.url))

void test('only a prepared numeric WebExt version is selected, independently of other units', () => {
  assert.equal(preparedVersion('0.2.0', '# WebExt\n\n## 0.2.0\nNews', false), true)
  assert.equal(preparedVersion('0.2.0', '## 0.2.0', true), false)
  assert.equal(preparedVersion('0.1.3', '', false), false)
  assert.equal(preparedVersion('0.2.0', '## 0.2.01', false), false)
  assert.throws(() => preparedVersion('0.2.0-beta.2', '', false))
  assert.throws(() => preparedVersion('0.2.65536', '', false))
})

void test('draft recovery cannot overwrite a public version or another source', () => {
  const source = 'a'.repeat(40)
  const draft = { tag_name: 'webext-v0.2.0', target_commitish: source, draft: true }
  assertDraft(draft, draft.tag_name, source)
  assert.throws(() => assertDraft({ ...draft, draft: false }, draft.tag_name, source))
  assert.throws(() => assertDraft(draft, draft.tag_name, 'b'.repeat(40)))
  assert.throws(() => assertDraft(undefined, draft.tag_name, source), /draft release was not found/)
})

void test('a new draft uses its creation response before release inventory catches up', async (t) => {
  const source = 'a'.repeat(40)
  const draft = { id: 42, tag_name: 'webext-v0.2.0', target_commitish: source, draft: true }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/InKCre/impl-ts/releases')
    assert.equal(options.method, 'POST')
    const request = JSON.parse(options.body)
    assert.equal(request.tag_name, draft.tag_name)
    assert.equal(request.target_commitish, source)
    assert.equal(request.draft, true)
    assert.match(request.body, /发布说明/)
    return Response.json(draft, { status: 201 })
  })
  assert.deepEqual(
    await createDraftRelease({ tag: draft.tag_name, source, version: '0.2.0', news: '发布说明' }),
    draft
  )
})

void test('browser artifacts preserve identity, numeric version and readable toolbar variants', async () => {
  const root = new URL('../../apps/client-webext/', import.meta.url)
  const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const { key } = JSON.parse(await readFile(new URL('chromium-key.json', root), 'utf8'))
  assert.match(extensionId(key), /^[a-p]{32}$/)
  for (const browser of ['chrome', 'firefox']) {
    const manifest = JSON.parse(
      await readFile(new URL(`.output/${browser}-mv3/manifest.json`, root), 'utf8')
    )
    checkManifest(manifest, metadata.version, browser, key)
    assert.throws(() =>
      checkManifest({ ...manifest, version: '0.0.1' }, metadata.version, browser, key)
    )
    if (browser === 'chrome')
      assert.throws(() =>
        checkManifest({ ...manifest, key: undefined }, metadata.version, browser, key)
      )
    assert.deepEqual(
      manifest.icons,
      Object.fromEntries([16, 32, 48, 96, 128].map((size) => [size, `icon/${size}.png`]))
    )
    for (const size of [16, 32, 48, 96, 128]) {
      const image = await readFile(new URL(`.output/${browser}-mv3/icon/${size}.png`, root))
      const asset =
        size === 96
          ? 'png/2x/original-white/inkcre-original-white-48px@2x.png'
          : `png/original-white/inkcre-original-white-${size}.png`
      assert.equal(image.readUInt32BE(16), size)
      assert.equal(image.readUInt32BE(20), size)
      assert.deepEqual(image, await readFile(require.resolve(`@inkcre/ui-web/logo/${asset}`)))
    }
    for (const [size, density, suffix] of [
      [16, '', '16'],
      [32, '2x/', '16px@2x'],
      [48, '3x/', '16px@3x'],
    ]) {
      assert.equal(manifest.action.default_icon[size], `toolbar/canvas-${size}.png`)
      for (const [prefix, variant] of [
        ['', 'original-transparent'],
        ['reverse-', 'reverse-transparent'],
        ['canvas-', 'original-white'],
      ]) {
        const image = await readFile(
          new URL(`.output/${browser}-mv3/toolbar/${prefix}${size}.png`, root)
        )
        const asset = `png/${density}${variant}/inkcre-${variant}-${suffix}.png`
        assert.equal(image.readUInt32BE(16), size)
        assert.equal(image.readUInt32BE(20), size)
        assert.deepEqual(image, await readFile(require.resolve(`@inkcre/ui-web/logo/${asset}`)))
      }
    }
    if (browser === 'firefox')
      assert.deepEqual(
        manifest.action.theme_icons,
        [16, 32, 48].map((size) => ({
          size,
          light: `toolbar/reverse-${size}.png`,
          dark: `toolbar/${size}.png`,
        }))
      )
  }
})
