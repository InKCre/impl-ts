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
    const output = new URL(`.output/${browser}-mv3/`, root)
    const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'))
    checkManifest(manifest, metadata.version, browser, key)
    if (browser === 'chrome') {
      // Existing installations retain the ID published in webext-v0.2.2/source.json.
      assert.equal(extensionId(manifest.key), 'fnejbpghhbcojofhgjglkejhednalfoa')
    }
    const checkLogo = async (entry, size, asset) => {
      const image = await readFile(new URL(entry, output))
      assert.equal(image.readUInt32BE(16), size)
      assert.equal(image.readUInt32BE(20), size)
      assert.deepEqual(image, await readFile(require.resolve(`@inkcre/ui-web/logo/${asset}`)))
    }
    for (const size of [16, 32, 48, 96, 128]) {
      const asset =
        size === 96
          ? 'png/2x/original-white/inkcre-original-white-48px@2x.png'
          : `png/original-white/inkcre-original-white-${size}.png`
      await checkLogo(manifest.icons[size], size, asset)
    }
    for (const [size, density, suffix] of [
      [16, '', '16'],
      [32, '2x/', '16px@2x'],
      [48, '3x/', '16px@3x'],
    ]) {
      const logo = (variant) => `png/${density}${variant}/inkcre-${variant}-${suffix}.png`
      await checkLogo(manifest.action.default_icon[size], size, logo('original-white'))
      if (browser === 'firefox') {
        const theme = manifest.action.theme_icons.find((entry) => entry.size === size)
        await checkLogo(theme.dark, size, logo('original-transparent'))
        await checkLogo(theme.light, size, logo('reverse-transparent'))
      }
    }
  }
})
