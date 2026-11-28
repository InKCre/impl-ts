import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveUiSourcePackage } from '../ui-source.mjs'

const repo = fileURLToPath(new URL('../..', import.meta.url))

async function writeUiPackage(root) {
  // These are the producer's public source paths, independent of the resolver's alias table.
  const entries = {
    '@inkcre/ui-web': 'src/index.ts',
    '@inkcre/ui-web/styles': 'styles/index.scss',
    '@inkcre/ui-web/styles/functions': 'styles/_functions.scss',
    '@inkcre/ui-web/styles/mixins': 'styles/_mixins.scss',
    '@inkcre/ui-web/tokens/ref': 'styles/tokens/_ref.scss',
    '@inkcre/ui-web/tokens/sys': 'styles/tokens/_sys.scss',
    '@inkcre/ui-web/tokens/comp': 'styles/tokens/_comp.scss',
    '@inkcre/ui-web/utils': 'src/utils/index.ts',
    '@inkcre/ui-web/locales': 'src/locales/index.ts',
    '@inkcre/ui-web/uno': 'styles/uno/preset-ink.ts',
  }
  for (const path of [...Object.values(entries), 'src/components.d.ts']) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), '')
  }
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@inkcre/ui-web', version: '2.3.0' })
  )
  return entries
}

void test('UI source overlays resolve public entries for development and reject release builds', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'inkcre-ui-source-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  const entries = await writeUiPackage(root)
  const web = createRequire(new URL('../../apps/web/package.json', import.meta.url))
  const { loadConfigFromFile, resolveConfig } = await import(
    pathToFileURL(web.resolve('vite')).href
  )
  const previousDirectory = process.cwd()
  const previousSource = process.env.INKCRE_UI_SOURCE_ROOT
  context.after(() => {
    process.chdir(previousDirectory)
    if (previousSource === undefined) delete process.env.INKCRE_UI_SOURCE_ROOT
    else process.env.INKCRE_UI_SOURCE_ROOT = previousSource
  })
  process.env.INKCRE_UI_SOURCE_ROOT = root
  for (const unit of [
    'apps/web',
    'extensions/twitter',
    'extensions/github',
    'extensions/mail',
    'extensions/bilibili',
  ]) {
    const configFile = fileURLToPath(new URL(`../../${unit}/vite.config.ts`, import.meta.url))
    process.chdir(dirname(configFile))
    const load = (command) =>
      loadConfigFromFile(
        { command, mode: command === 'serve' ? 'development' : 'production' },
        configFile,
        dirname(configFile),
        'silent'
      )
    const { config } = await load('serve')
    const resolver = (
      await resolveConfig(
        {
          root: dirname(configFile),
          configFile: false,
          resolve: config.resolve,
          logLevel: 'silent',
        },
        'serve'
      )
    ).createResolver()
    // Web exercises the complete shared alias table. Each remote wires the overlay independently.
    const aliases = unit === 'apps/web' ? Object.keys(entries) : ['@inkcre/ui-web']
    for (const specifier of aliases) {
      const relativePath = entries[specifier]
      assert.equal(await resolver(specifier, undefined, true), join(root, relativePath), unit)
    }
    const sass = config.css.preprocessorOptions.scss.additionalData
    const style = '.probe { color: red; }'
    const uiStyle = sass(style, join(root, 'src/components/Probe.scss'))
    assert.match(uiStyle, /@inkcre\/ui-web\/styles\/mixins/, unit)
    assert.match(uiStyle, /@inkcre\/ui-web\/styles\/functions/, unit)
    assert.doesNotMatch(uiStyle, /@\/styles/, unit)
    assert.equal(sass(style, join(root, 'styles/tokens/_sys.scss')), style, unit)
    assert.ok(config.server.fs.allow.includes(root), unit)
    for (const shared of ['vue', 'unocss']) assert.ok(config.resolve.dedupe.includes(shared), unit)
    assert.ok(config.optimizeDeps.exclude.includes('@inkcre/ui-web'), unit)
    await assert.rejects(load('build'), /source overlay is development-only/, unit)
  }
  await rm(join(root, 'styles/_mixins.scss'))
  await assert.rejects(
    resolveUiSourcePackage(root),
    /UI source package is missing styles\/_mixins.scss/
  )
})

void test('development CLI selects web-ui and type-check:ui propagates errors from the selected checkout', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'inkcre-ui-types-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  const checkout = join(root, 'impl-ts')
  const appRoot = join(checkout, 'apps/web')
  const uiRoot = join(root, 'ui/packages/web')
  await mkdir(join(appRoot, 'src'), { recursive: true })
  // The fixture invokes the compiler already installed by the real workspace.
  await writeFile(
    join(checkout, 'pnpm-workspace.yaml'),
    'packages: [apps/web]\nverifyDepsBeforeRun: false\n'
  )
  await copyFile(join(repo, 'package.json'), join(checkout, 'package.json'))
  await copyFile(join(repo, 'apps/web/package.json'), join(appRoot, 'package.json'))
  await mkdir(join(checkout, 'scripts'))
  for (const name of ['dev.mjs', 'dev-ui.mjs', 'type-check-ui.mjs', 'ui-source.mjs']) {
    await copyFile(join(repo, 'scripts', name), join(checkout, 'scripts', name))
  }
  const bin = join(appRoot, 'node_modules/.bin')
  await mkdir(bin, { recursive: true })
  await symlink(join(repo, 'apps/web/node_modules/vue-tsc/bin/vue-tsc.js'), join(bin, 'vue-tsc'))
  await writeUiPackage(uiRoot)
  const uiEntry = join(uiRoot, 'src/index.ts')
  await writeFile(
    join(appRoot, 'tsconfig.app.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        rootDir: join(root, 'impl-ts'),
      },
    })
  )
  await writeFile(join(appRoot, 'env.d.ts'), '')
  await writeFile(join(appRoot, 'src/index.ts'), "export { value } from '@inkcre/ui-web'\n")
  await writeFile(uiEntry, 'export const value: number = 1\n')
  const callsFile = join(root, 'svc.jsonl')
  await writeFile(
    join(root, 'svc'),
    `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.CALLS_FILE, JSON.stringify({ args: process.argv.slice(2), source: process.env.INKCRE_UI_SOURCE_ROOT }) + '\\n');
`,
    { mode: 0o700 }
  )
  const env = {
    ...process.env,
    PATH: [root, dirname(process.execPath), process.env.PATH].join(':'),
    CALLS_FILE: callsFile,
  }
  delete env.SVC_DEV_TARGET
  delete env.INKCRE_UI_SOURCE_ROOT
  const run = (script) =>
    spawnSync('pnpm', ['run', script, '--ui-source', uiRoot], {
      cwd: checkout,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
  const dev = run('dev:ui')
  assert.equal(dev.status, 0, dev.stdout + dev.stderr)
  const { args, source } = JSON.parse((await readFile(callsFile, 'utf8')).trim().split('\n').at(-1))
  assert.deepEqual(args.slice(0, 3), ['dev', 'ensure', 'web-ui'])
  assert.equal(source, uiRoot)
  assert.equal(await realpath(args[args.indexOf('--repo') + 1]), checkout)
  const check = () => run('type-check:ui')
  const valid = check()
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)
  await writeFile(uiEntry, 'export const value: number = "wrong"\n')
  const invalid = check()
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stdout, /TS2322/)
})
