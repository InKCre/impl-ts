import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { loadWebpack } from '../../.github/actions/publish-extension/dependencies.mjs'
import { classicContainerName, packClassic } from './pack-classic.mjs'

await test('classic producer embeds lazy JS and CSS in one reproducible release-scoped container', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'inkcre-mf-classic-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifactDirectory = path.join(root, 'input')
  await mkdir(path.join(artifactDirectory, 'assets'), { recursive: true })
  const manifest = {
    metaData: { name: 'example.container', remoteEntry: { type: 'module', name: 'entry.js' } },
    remotes: [],
  }
  await writeFile(path.join(artifactDirectory, 'mf-manifest.json'), JSON.stringify(manifest))
  await writeFile(
    path.join(artifactDirectory, 'entry.js'),
    `import { _ } from './assets/preload-helper-demo.js';
const producer = "example.container";
let sdk;
export function init(scope) { sdk = scope.sdk; }
export async function get() {
  const { suffix } = await _(() => import('./assets/view.js'), ['./assets/view.css'], import.meta.url);
  return () => producer + ':' + sdk + suffix;
}
`
  )
  await writeFile(
    path.join(artifactDirectory, 'assets/preload-helper-demo.js'),
    `export function _() {
throw new Error('original Vite preload attempted an extra request');
}
`
  )
  await writeFile(
    path.join(artifactDirectory, 'assets/view.js'),
    `export const suffix = ' from lazy JavaScript';\n`
  )
  await writeFile(path.join(artifactDirectory, 'assets/pixel.svg'), '<svg/>')
  await writeFile(
    path.join(artifactDirectory, 'assets/view.css'),
    `.view { background: url("./pixel.svg"); }\n`
  )

  const coordinate = { repository: 'Example/Publisher', name: 'inkcre/demo', version: '1.0.0' }
  const first = classicContainerName(coordinate)
  const second = classicContainerName({ ...coordinate, version: '1.0.1' })
  assert.equal(
    first,
    classicContainerName({ ...coordinate, repository: 'https://github.com/example/publisher/' })
  )
  assert.notEqual(first, second)
  assert.notEqual(first, classicContainerName({ ...coordinate, repository: 'another/publisher' }))
  const webpack = await loadWebpack()
  const output = async (file, globalName) => {
    const outputFile = path.join(root, file)
    await packClassic({ artifactDirectory, outputFile, globalName, webpack })
    return readFile(outputFile, 'utf8')
  }

  const firstScript = await output('first.js', first)
  assert.equal(await output('repeat.js', first), firstScript)
  const secondScript = await output('second.js', second)
  const styles = []
  const context = {
    URL,
    document: {
      createElement: () => ({ dataset: {} }),
      querySelector: () => undefined,
      head: { appendChild: (style) => styles.push(style) },
    },
  }
  runInNewContext(firstScript, context)
  runInNewContext(secondScript, context)
  context[first].init({ sdk: 'one' })
  context[second].init({ sdk: 'two' })
  assert.equal((await context[first].get())(), first + ':one from lazy JavaScript')
  assert.equal((await context[second].get())(), second + ':two from lazy JavaScript')
  assert.equal(styles.length, 2)
  assert.match(styles[0].textContent, /data:image\/svg\+xml;base64,PHN2Zy8+/)

  manifest.remotes = [{ name: 'external' }]
  await writeFile(path.join(artifactDirectory, 'mf-manifest.json'), JSON.stringify(manifest))
  await assert.rejects(
    () => output('unsupported.js', first),
    /additional remote containers.*manifest mode/
  )

  manifest.remotes = []
  await writeFile(path.join(artifactDirectory, 'mf-manifest.json'), JSON.stringify(manifest))
  await writeFile(
    path.join(artifactDirectory, 'entry.js'),
    `export function init() {}
export async function get() { return import(globalThis.moduleUrl); }\n`
  )
  await assert.rejects(() => output('dynamic.js', first), /dynamic dependency.*manifest mode/)
})
