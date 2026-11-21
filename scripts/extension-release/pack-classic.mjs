import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ARTIFACT_ORIGIN = 'https://inkcre-artifact.invalid/'
const BUNDLE = 'remoteEntry.js'
const VITE_PRELOAD = /(?:^|\/)preload-helper-[\w-]+\.js$/

const inlineMedia = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function unsupported(reason) {
  return new Error(
    `Cannot pack a single-file Extension: ${reason}. Use manifest mode for this build.`
  )
}

function relativeFile(root, file) {
  const relative = path.relative(root, file)
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) ? relative : null
}

export function classicContainerName({ repository, name, version }) {
  const slug = repository
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .toLowerCase()
  const id = createHash('sha256')
    .update(JSON.stringify([slug, name, version]))
    .digest('hex')
  return `inkcre_mf_${id.slice(0, 32)}`
}

async function inlineStylesheet(root, relativePath) {
  const css = await readFile(path.join(root, relativePath), 'utf8')
  if (/@import\b/i.test(css)) throw unsupported(`stylesheet ${relativePath} uses @import`)
  const links = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"]+))\s*\)/gi)]
  const encoded = new Map()
  for (const [original, quoted, singleQuoted, bare] of links) {
    if (encoded.has(original)) continue
    const reference = quoted ?? singleQuoted ?? bare
    if (/^data:|^#/i.test(reference)) continue
    const base = new URL(relativePath, ARTIFACT_ORIGIN)
    const asset = new URL(reference, base)
    const assetPath = decodeURIComponent(asset.pathname).slice(1)
    const file = path.resolve(root, assetPath)
    const type = inlineMedia[path.extname(assetPath).toLowerCase()]
    if (asset.origin !== base.origin || !relativeFile(root, file) || !type)
      throw unsupported(`stylesheet ${relativePath} references ${reference}`)
    const bytes = await readFile(file).catch(() => {
      throw unsupported(`stylesheet ${relativePath} references missing asset ${reference}`)
    })
    encoded.set(original, `url("data:${type};base64,${bytes.toString('base64')}${asset.hash}")`)
  }
  return css.replace(
    /url\(\s*(?:"[^"]*"|'[^']*'|[^\s)'"]+)\s*\)/gi,
    (original) => encoded.get(original) ?? original
  )
}

async function writePreloadHelper(root, outputFile) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
    )
    .sort()
  if (files.length && !entries.some((entry) => entry.isFile() && VITE_PRELOAD.test(entry.name)))
    throw unsupported('CSS requires the Vite preload helper')
  const styles = Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await inlineStylesheet(root, file)]))
  )
  // Webpack folds JS preloads into the script. Keep Vite's CSS-before-import order.
  await writeFile(
    outputFile,
    `const styles = ${JSON.stringify(styles)};
const loaded = new Set();
export async function _(load, dependencies, importer) {
  for (const dependency of dependencies || []) {
    if (!dependency.endsWith('.css')) continue;
    const url = new URL(dependency, importer || '${ARTIFACT_ORIGIN}');
    const file = decodeURIComponent(url.pathname).slice(1);
    if (loaded.has(file)) continue;
    if (!Object.hasOwn(styles, file)) throw new Error('Missing inline stylesheet: ' + dependency);
    const style = document.createElement('style');
    style.textContent = styles[file];
    style.dataset.inkcreInlineStyle = dependency;
    const nonce = document.querySelector('meta[property=csp-nonce]')?.nonce;
    if (nonce) style.nonce = nonce;
    document.head.appendChild(style);
    loaded.add(file);
  }
  return load();
}
export { _ as __vitePreload };
`
  )
}

async function remoteEntry(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'mf-manifest.json'), 'utf8'))
  if (manifest.remotes?.length)
    throw unsupported('the manifest declares additional remote containers')
  const entry = manifest.metaData?.remoteEntry
  if (!entry || !['module', 'esm'].includes(entry.type) || !entry.name)
    throw unsupported('mf-manifest.json must describe a JavaScript module remote entry')
  const file = path.resolve(root, entry.path ?? '', entry.name)
  if (!relativeFile(root, file) || !(await lstat(file).catch(() => null))?.isFile())
    throw unsupported('the manifest must point to a remote entry file inside the build')
  return { file, producerName: manifest.metaData.name ?? manifest.name }
}

async function compile(webpack, options) {
  await new Promise((resolve, reject) => {
    webpack(options, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors())
        return reject(unsupported(stats.toString({ all: false, errors: true })))
      const { warnings = [] } = stats.toJson({ all: false, warnings: true })
      const unresolved = warnings.find(({ message, moduleName }) => {
        // The MF runtime defines its generic remote loader even for a closed extension.
        const federationRuntime = /__mf_v__runtimeInit__mf_v__-[\w-]+\.js$/.test(moduleName ?? '')
        return message.startsWith('Critical dependency:') && !federationRuntime
      })
      if (unresolved)
        return reject(
          unsupported(`${unresolved.moduleName} has a dynamic dependency Webpack cannot inline`)
        )
      resolve()
    })
  })
}

export async function packClassic({ artifactDirectory, outputFile, globalName, webpack }) {
  if (!/^[A-Za-z_$][\w$]*$/.test(globalName))
    throw new Error('Expected a JavaScript container name')
  const staging = await realpath(await mkdtemp(path.join(tmpdir(), 'inkcre-mf-classic-')))
  try {
    const root = path.join(staging, 'input')
    const dist = path.join(staging, 'output')
    const helper = path.join(staging, 'inline-preload.mjs')
    const entryModule = path.join(staging, 'container.mjs')
    await cp(artifactDirectory, root, { recursive: true })
    const { file, producerName } = await remoteEntry(root)

    if (typeof producerName === 'string' && producerName) {
      // The generated entry initializes another MF runtime. Give it the same release ID
      // as the global container so two versions cannot reuse one internal instance.
      const entry = await readFile(file, 'utf8')
      const isolated = entry
        .replaceAll(JSON.stringify(producerName), JSON.stringify(globalName))
        .replaceAll(`'${producerName}'`, JSON.stringify(globalName))
      await writeFile(file, isolated)
    }

    await writePreloadHelper(root, helper)
    const entryPath = './' + path.relative(staging, file).split(path.sep).join('/')
    // Explicit exports also make Webpack fail for an input that is not an MF container.
    await writeFile(entryModule, `export { get, init } from ${JSON.stringify(entryPath)};\n`)
    await compile(webpack, {
      context: root,
      entry: entryModule,
      mode: 'production',
      target: ['web', 'es2022'],
      devtool: false,
      experiments: { topLevelAwait: true },
      output: {
        path: dist,
        filename: BUNDLE,
        library: { name: globalName, type: 'var' },
        publicPath: '',
        uniqueName: globalName,
      },
      module: {
        parser: { javascript: { exportsPresence: 'error' } },
        rules: [{ test: /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)$/i, type: 'asset/inline' }],
      },
      plugins: [
        new webpack.NormalModuleReplacementPlugin(VITE_PRELOAD, helper),
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      ],
      optimization: { splitChunks: false },
      performance: false,
    })

    const files = await readdir(dist)
    const licenseFile = `${BUNDLE}.LICENSE.txt`
    if (files.some((file) => file !== BUNDLE && file !== licenseFile))
      throw unsupported(
        `Webpack emitted extra assets: ${files.filter((file) => file !== BUNDLE && file !== licenseFile).join(', ')}`
      )

    const assetRoot = pathToFileURL(root + path.sep).href
    let script = (await readFile(path.join(dist, BUNDLE), 'utf8')).replaceAll(
      assetRoot,
      ARTIFACT_ORIGIN
    )
    if (files.includes(licenseFile)) {
      const licenses = await readFile(path.join(dist, licenseFile), 'utf8')
      script = script.replace(/^\/\*! For license information please see [^\n]*\*\/\n?/, '')
      script = `${licenses}\n${script}`
    }
    const destination = path.resolve(outputFile)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, script)
    return destination
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
