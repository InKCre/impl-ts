import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { checkManifest, extensionId } from '../webext-release.mjs'

const require = createRequire(new URL('../../apps/webext/package.json', import.meta.url))

void test('browser artifacts preserve identity, numeric version and readable toolbar variants', async () => {
  const root = new URL('../../apps/webext/', import.meta.url)
  const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const { key } = JSON.parse(await readFile(new URL('chromium-key.json', root), 'utf8'))
  for (const browser of ['chrome', 'firefox']) {
    const manifest = JSON.parse(
      await readFile(new URL(`.output/${browser}-mv3/manifest.json`, root), 'utf8')
    )
    checkManifest(manifest, metadata.version, browser, key)
    assert.throws(
      () => checkManifest({ ...manifest, version: '0.0.1' }, metadata.version, browser, key),
      { code: 'ERR_ASSERTION', actual: '0.0.1', expected: metadata.version }
    )
    if (browser === 'chrome') {
      // Existing installations retain the ID published in webext-v0.2.2/source.json.
      assert.equal(extensionId(manifest.key), 'fnejbpghhbcojofhgjglkejhednalfoa')
      assert.throws(
        () => checkManifest({ ...manifest, key: undefined }, metadata.version, browser, key),
        /fixed Chromium identity/
      )
    }
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
