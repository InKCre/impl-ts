import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { inspectBrowserRuntimeSource } from './browser-runtime-contract.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const jsonOutput = process.argv.includes('--json')
const errors = []

async function readJson(relativePath) {
  return JSON.parse(await readFile(`${repoRoot}/${relativePath}`, 'utf8'))
}

async function sourceFiles(relativeDirectory) {
  const directory = `${repoRoot}/${relativeDirectory}`
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(relativePath)))
    } else if (/\.(?:js|mjs|ts|tsx|vue)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }

  return files
}

const rootPackage = await readJson('package.json')
const svcConfig = await readJson('svc.json')

const nodeRuntime = rootPackage.devEngines?.runtime
if (
  nodeRuntime?.name !== 'node' ||
  !/^\d+\.\d+\.\d+$/.test(nodeRuntime?.version) ||
  nodeRuntime?.onFail !== 'download'
) {
  errors.push('root devEngines.runtime must provision an exact Node version through pnpm')
}
for (const [path, expectedNodeFile] of [
  ['.github/workflows/ci.yml', 'package.json'],
  ['.github/workflows/pages-cleanup.yml', 'controller/package.json'],
  ['.github/workflows/pages-preview.yml', 'candidate/package.json'],
  ['.github/workflows/pages-deploy.yml', 'release/package.json'],
]) {
  const workflow = parse(await readFile(`${repoRoot}/${path}`, 'utf8'))
  const setups = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith('actions/setup-node@'))
  if (
    !setups.length ||
    setups.some((step) => step.with?.['node-version-file'] !== expectedNodeFile)
  ) {
    errors.push(`${path} must derive every Node setup from ${expectedNodeFile}`)
  }
}
const sourceRoots = [
  'apps/web/src',
  'apps/webext/components',
  'apps/webext/entrypoints',
  'apps/webext/logic',
]
for (const root of ['packages', 'extensions']) {
  for (const entry of await readdir(`${repoRoot}/${root}`, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.'))
      sourceRoots.push(`${root}/${entry.name}/src`)
  }
}
for (const directory of sourceRoots) {
  for (const path of await sourceFiles(directory)) {
    if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)) continue
    errors.push(...inspectBrowserRuntimeSource(await readFile(`${repoRoot}/${path}`, 'utf8'), path))
  }
}

const localTargets = svcConfig.dev?.targets
if (!localTargets) {
  errors.push('svc.json must declare development targets')
} else {
  for (const name of ['database', 'web', 'web-ui', 'webext']) {
    const target = localTargets[name]
    if (!target) {
      errors.push(`svc.json is missing local target "${name}"`)
      continue
    }
    if (target.scope !== 'worktree') {
      errors.push(`SVC target "${name}" must be worktree-scoped`)
    }
    if (target.probe?.kind !== 'exec' || !target.probe.argv?.includes('${dev.instance}')) {
      errors.push(`SVC target "${name}" must use the identity probe that proves dev.instance`)
    }
  }
  const databaseEnv = localTargets.database?.provision?.env ?? {}
  if (
    databaseEnv.INKCRE_DATABASE_PROVIDER !== 'local' ||
    Object.keys(databaseEnv).some(
      (key) => key.startsWith('INKCRE_DATABASE_') && key !== 'INKCRE_DATABASE_PROVIDER'
    )
  ) {
    errors.push(
      'commit only the portable local database provider; put machine-specific database settings in svc.local.json'
    )
  }
}

const result = {
  ok: errors.length === 0,
  targets: localTargets ? Object.keys(localTargets).sort() : [],
  configAuthority: 'browser-local',
  errors,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  console.log('[OK] static/browser-local runtime and worktree development contracts are explicit')
} else {
  for (const error of errors) {
    console.error(`[ERROR] ${error}`)
  }
}

process.exitCode = result.ok ? 0 : 1
