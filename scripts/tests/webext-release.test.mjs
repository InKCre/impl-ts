import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { assertDraft, checkManifest, extensionId, preparedVersion } from '../webext-release.mjs'

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
    for (const size of [16, 32, 48]) {
      const image = await readFile(
        new URL(`.output/${browser}-mv3/${manifest.action.default_icon[size]}`, root)
      )
      assert.equal(image.readUInt32BE(16), size)
      assert.equal(image.readUInt32BE(20), size)
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
