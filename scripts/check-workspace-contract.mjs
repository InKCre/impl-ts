import { execFileSync } from 'node:child_process'
import { basename, relative } from 'node:path'
import { parse } from 'yaml'
import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const jsonOutput = process.argv.includes('--json')

const sourcePackages = {
  'packages/ext-dev-utils':
    'source-only Vue support package; consuming Vite applications own output',
  'packages/web-collection': 'source-only browser material contract; consuming peers own output',
}

const bannedDirectTooling = [
  '@biomejs/biome',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/parser',
  'eslint',
  'eslint-config-prettier',
  'prettier',
  'tsup',
]

const errors = []
const members = []

const discoveredWorkspaces = []
for (const root of ['packages', 'apps', 'extensions']) {
  for (const entry of await readdir(`${repoRoot}/${root}`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = `${root}/${entry.name}`
    try {
      await access(`${repoRoot}/${path}/package.json`)
      discoveredWorkspaces.push(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
discoveredWorkspaces.sort()
// pnpm applies inclusions and exclusions; a package on disk can silently
// disappear from every recursive build and type check.
const listed = JSON.parse(
  execFileSync('pnpm', ['list', '-r', '--depth=-1', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
)
  .map((member) => relative(repoRoot, member.path))
  .filter(Boolean)
  .sort()
if (JSON.stringify(listed) !== JSON.stringify(discoveredWorkspaces)) {
  errors.push(
    `pnpm membership differs from packages on disk: pnpm=${listed.join(',')} disk=${discoveredWorkspaces.join(',')}`
  )
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(`${repoRoot}/${relativePath}`, 'utf8'))
}

const rootPackage = await readJson('package.json')
const rootScripts = [
  'build',
  'check',
  'check:package',
  'check:release:web',
  'check:runtime',
  'check:workspace',
  'contract:check',
  'contract:sync',
  'doctor',
  'dev',
  'dev:webext',
  'dev:all:ui',
  'dev:status',
  'dev:stop',
  'dev:ui',
  'format',
  'format:check',
  'lint',
  'lint:type-aware',
  'type-check',
  'type-check:ui',
]

for (const script of rootScripts) {
  if (!rootPackage.scripts?.[script]) {
    errors.push(`root package is missing script "${script}"`)
  }
}

const expectedRootTools = {
  oxfmt: '0.60.0',
  oxlint: '1.75.0',
  'oxlint-tsgolint': '7.0.2001',
  portless: '0.12.0',
  typescript: 'catalog:',
}

for (const [name, version] of Object.entries(expectedRootTools)) {
  if (rootPackage.devDependencies?.[name] !== version) {
    errors.push(`root devDependency "${name}" must be "${version}"`)
  }
}

const compilerVersion = '6.0.3-bridge.19.tsgo.7.0.2'
const rootRequire = createRequire(`${repoRoot}/package.json`)
const compilerPath = rootRequire.resolve('typescript/package.json')
const compiler = rootRequire('typescript/package.json')
if (compiler.name !== 'typescript-native-bridge' || compiler.version !== compilerVersion) {
  errors.push(`typescript must resolve to typescript-native-bridge@${compilerVersion}`)
}
for (const alias of [
  '@typescript/native',
  '@typescript/native-preview',
  '@typescript/typescript6',
]) {
  if (rootPackage.devDependencies?.[alias]) {
    errors.push(`remove separate compiler ${alias}; all checks must use the TypeScript catalog`)
  }
}

for (const path of discoveredWorkspaces) {
  const name = `@inkcre/${path.startsWith('extensions/') ? 'ext-' : ''}${basename(path)}`
  const exemption = sourcePackages[path]
  const requiredScripts = exemption ? ['type-check'] : ['build', 'dev', 'type-check']
  if (path === 'apps/webext') requiredScripts.push('build:firefox')

  const packageJson = await readJson(`${path}/package.json`)
  const workspaceRequire = createRequire(`${repoRoot}/${path}/package.json`)
  if (workspaceRequire.resolve('typescript/package.json') !== compilerPath) {
    errors.push(`${name} resolves a different TypeScript compiler from the root`)
  }
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  }

  if (packageJson.name !== name) {
    errors.push(`${path} must declare package name "${name}"`)
  }

  for (const script of requiredScripts) {
    if (!packageJson.scripts?.[script]) {
      errors.push(`${name} is missing required script "${script}"`)
    }
  }

  for (const dependency of bannedDirectTooling) {
    if (allDependencies[dependency]) {
      errors.push(`${name} directly depends on superseded tool "${dependency}"`)
    }
  }

  if (packageJson.devDependencies?.typescript !== 'catalog:') {
    errors.push(`${name} must use the workspace TypeScript catalog`)
  }

  if (
    packageJson.devDependencies?.['@vue/tsconfig'] &&
    packageJson.devDependencies['@vue/tsconfig'] !== 'catalog:'
  ) {
    errors.push(`${name} must use the workspace @vue/tsconfig catalog`)
  }

  if (
    packageJson.scripts?.['type-check']?.includes('vue-tsc') &&
    packageJson.devDependencies?.['vue-tsc'] !== 'catalog:'
  ) {
    errors.push(`${name} must use the workspace vue-tsc catalog`)
  }

  if (packageJson.scripts?.['type-check']?.includes('vue-tsc')) {
    const vueRequire = createRequire(workspaceRequire.resolve('vue-tsc/package.json'))
    if (vueRequire.resolve('typescript/package.json') !== compilerPath) {
      errors.push(`${name} vue-tsc resolves a different TypeScript compiler`)
    }
  }

  members.push({ name, path, build: exemption ? { exemption } : packageJson.scripts.build })
}

const manifest = parse(await readFile(`${repoRoot}/pnpm-workspace.yaml`, 'utf8'))
const compilerAlias = `npm:typescript-native-bridge@${compilerVersion}`
if (
  manifest.catalog?.typescript !== compilerAlias ||
  manifest.overrides?.typescript !== compilerAlias
) {
  errors.push('the TypeScript catalog and transitive override must share the pinned TS7 bridge')
}
if (manifest.catalog?.['vue-tsc'] !== '3.3.8')
  errors.push('pnpm-workspace.yaml must pin vue-tsc 3.3.8')

const coreRequire = createRequire(`${repoRoot}/packages/core/package.json`)
const tsdownRequire = createRequire(coreRequire.resolve('tsdown/package.json'))
const dtsRequire = createRequire(tsdownRequire.resolve('rolldown-plugin-dts/package.json'))
if (dtsRequire.resolve('typescript/package.json') !== compilerPath) {
  errors.push('Core declaration generation resolves a different TypeScript compiler')
}
const result = {
  ok: errors.length === 0,
  compiler: { name: compiler.name, version: compiler.version },
  members,
  errors,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  console.log(`[OK] shared compiler: ${compiler.name}@${compiler.version}`)
  console.log(`[OK] workspace contract covers ${members.length} members`)
  for (const member of members) {
    const build = typeof member.build === 'string' ? member.build : member.build.exemption
    console.log(`[OK] ${member.name}: ${build}`)
  }
} else {
  for (const error of errors) {
    console.error(`[ERROR] ${error}`)
  }
}

process.exitCode = result.ok ? 0 : 1
