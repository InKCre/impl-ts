import { access, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const jsonOutput = process.argv.includes('--json')

const workspaces = [
  {
    path: 'extensions/capture',
    name: '@inkcre/ext-capture',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
  },
  {
    path: 'extensions/caldav',
    name: '@inkcre/ext-caldav',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
  },
  {
    path: 'packages/core',
    name: '@inkcre/core',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'tsdown',
  },
  {
    path: 'packages/ext-dev-utils',
    name: '@inkcre/ext-dev-utils',
    requiredScripts: ['type-check'],
    buildExemption: 'source-only Vue support package; consuming Vite applications own output',
  },
  {
    path: 'apps/client-web',
    name: '@inkcre/client-web',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
    builderScript: 'build-only',
  },
  {
    path: 'apps/client-webext',
    name: '@inkcre/client-webext',
    requiredScripts: ['build', 'build:firefox', 'dev', 'type-check'],
    builder: 'wxt',
  },
  {
    path: 'extensions/github',
    name: '@inkcre/ext-github',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
  },
  {
    path: 'extensions/mail',
    name: '@inkcre/ext-mail',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
  },
  {
    path: 'extensions/twitter',
    name: '@inkcre/ext-twitter',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
  },
  {
    path: 'extensions/memos',
    name: '@inkcre/ext-memos',
    requiredScripts: ['build', 'dev', 'type-check'],
    builder: 'vite',
  },
]

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

const workspaceRoots = ['packages', 'apps', 'extensions']
const workspaceCandidates = (
  await Promise.all(
    workspaceRoots.map(async (root) => {
      const entries = await readdir(`${repoRoot}/${root}`, { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => `${root}/${entry.name}`)
    })
  )
).flat()
const discoveredWorkspaces = (
  await Promise.all(
    workspaceCandidates.map(async (path) => {
      try {
        await access(`${repoRoot}/${path}/package.json`)
        return path
      } catch {
        return null
      }
    })
  )
)
  .filter((path) => path !== null)
  .sort()
const declaredWorkspaces = workspaces.map((workspace) => workspace.path).sort()

if (JSON.stringify(discoveredWorkspaces) !== JSON.stringify(declaredWorkspaces)) {
  errors.push(
    `workspace validator inventory does not match discovered packages: declared=${declaredWorkspaces.join(',')} discovered=${discoveredWorkspaces.join(',')}`
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
  'dev:all:ui',
  'dev:status',
  'dev:stop',
  'dev:ui',
  'format',
  'format:check',
  'lint',
  'lint:type-aware',
  'type-check',
  'type-check:ts7',
  'type-check:ui',
]

for (const script of rootScripts) {
  if (!rootPackage.scripts?.[script]) {
    errors.push(`root package is missing script "${script}"`)
  }
}

const expectedRootTools = {
  '@typescript/native': 'npm:typescript@7.0.2',
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

for (const workspace of workspaces) {
  const packageJson = await readJson(`${workspace.path}/package.json`)
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  }

  if (packageJson.name !== workspace.name) {
    errors.push(`${workspace.path} must declare package name "${workspace.name}"`)
  }

  for (const script of workspace.requiredScripts) {
    if (!packageJson.scripts?.[script]) {
      errors.push(`${workspace.name} is missing required script "${script}"`)
    }
  }

  for (const dependency of bannedDirectTooling) {
    if (allDependencies[dependency]) {
      errors.push(`${workspace.name} directly depends on superseded tool "${dependency}"`)
    }
  }

  if (packageJson.devDependencies?.typescript !== 'catalog:') {
    errors.push(`${workspace.name} must use the workspace TypeScript catalog`)
  }

  if (
    packageJson.scripts?.['type-check']?.includes('vue-tsc') &&
    packageJson.devDependencies?.['vue-tsc'] !== 'catalog:'
  ) {
    errors.push(`${workspace.name} must use the workspace vue-tsc catalog`)
  }

  const builderScript = workspace.builderScript ?? 'build'
  if (workspace.builder && !packageJson.scripts[builderScript].includes(workspace.builder)) {
    errors.push(`${workspace.name} ${builderScript} script must use ${workspace.builder}`)
  }

  members.push({
    name: workspace.name,
    path: workspace.path,
    build: workspace.builder ?? { exemption: workspace.buildExemption },
  })
}

const workspaceYaml = await readFile(`${repoRoot}/pnpm-workspace.yaml`, 'utf8')
for (const pattern of ['packages/*', 'apps/*', 'extensions/*']) {
  if (!workspaceYaml.includes(`- ${pattern}`)) {
    errors.push(`pnpm-workspace.yaml is missing member pattern "${pattern}"`)
  }
}
if (!workspaceYaml.includes('typescript: 5.9.3')) {
  errors.push('pnpm-workspace.yaml must pin ecosystem-supported TypeScript 5.9.3')
}
if (!workspaceYaml.includes('vue-tsc: 3.3.8')) {
  errors.push('pnpm-workspace.yaml must pin vue-tsc 3.3.8')
}

const corePackage = await readJson('packages/core/package.json')
const expectedCoreEntry = './dist/index.js'
const expectedCoreTypes = './dist/index.d.ts'
if (
  corePackage.main !== expectedCoreEntry ||
  corePackage.module !== expectedCoreEntry ||
  corePackage.types !== expectedCoreTypes ||
  corePackage.exports?.['.']?.import !== expectedCoreEntry ||
  corePackage.exports?.['.']?.types !== expectedCoreTypes ||
  corePackage.exports?.['.']?.require
) {
  errors.push('@inkcre/core must expose one ESM dist entry and its generated declarations')
}

const result = {
  ok: errors.length === 0,
  members,
  errors,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
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
