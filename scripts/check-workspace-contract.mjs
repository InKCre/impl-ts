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

const rootRequire = createRequire(`${repoRoot}/package.json`)
const compilerPath = rootRequire.resolve('typescript/package.json')
const compiler = rootRequire('typescript/package.json')
if (compiler.name !== 'typescript-native-bridge') {
  errors.push('typescript must resolve to the shared native bridge')
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
  if (packageJson.name !== name) {
    errors.push(`${path} must declare package name "${name}"`)
  }

  for (const script of requiredScripts) {
    if (!packageJson.scripts?.[script]) {
      errors.push(`${name} is missing required script "${script}"`)
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
const compilerAlias = `npm:${compiler.name}@${compiler.version}`
if (
  manifest.catalog?.typescript !== compilerAlias ||
  manifest.overrides?.typescript !== compilerAlias
) {
  errors.push('the TypeScript catalog and transitive override must share the pinned TS7 bridge')
}
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
