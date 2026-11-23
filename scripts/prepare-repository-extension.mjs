import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { loadWebpack } from '../.github/actions/publish-extension/dependencies.mjs'
import {
  inspectNativeModuleFederation,
  listSnapshotFiles,
} from './verify-native-extension-distribution.mjs'

export const ARCHIVE_NAME = 'module-federation.zip'
const SCRIPT_NAME = 'module-federation.js'

export async function artifactDigest(file) {
  return (
    'sha256:' +
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
  )
}

export function artifactManifestUrl(repository, commit) {
  return 'https://cdn.jsdelivr.net/gh/' + repository + '@' + commit + '/mf-manifest.json'
}

export function repositoryReleaseBody(sourcePath, local, transport) {
  return [
    '<!-- inkcre-release',
    JSON.stringify({
      schema_version: 1,
      source_path: sourcePath,
      ...local.module_federation,
      python_repository: local.python_repository,
      ...transport,
    }),
    '-->',
  ].join('\n')
}

export function git(workspace, args) {
  return execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim()
}

export async function buildArtifactCommit({ workspace, tree, sourceRevision, name, version }) {
  const gitDir = git(workspace, ['rev-parse', '--absolute-git-dir'])
  const sourceTime = git(workspace, ['show', '-s', '--format=%ct', sourceRevision])
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-index-'))
  const env = {
    ...process.env,
    GIT_INDEX_FILE: path.join(temporary, 'index'),
    GIT_AUTHOR_NAME: 'InKCre',
    GIT_AUTHOR_EMAIL: 'release@inkcre.dev',
    GIT_AUTHOR_DATE: sourceTime + ' +0000',
    GIT_COMMITTER_NAME: 'InKCre',
    GIT_COMMITTER_EMAIL: 'release@inkcre.dev',
    GIT_COMMITTER_DATE: sourceTime + ' +0000',
  }
  const payloadGit = (...args) =>
    execFileSync(
      'git',
      ['--git-dir=' + gitDir, '--work-tree=' + tree, '-c', 'core.autocrlf=false', ...args],
      { cwd: tree, encoding: 'utf8', env }
    ).trim()
  try {
    // A fresh index and normalized file modes make the commit reproducible from the saved ZIP.
    payloadGit('add', '--force', '--all', '--chmod=-x', '--', '.')
    const treeId = payloadGit('write-tree')
    return payloadGit(
      'commit-tree',
      treeId,
      '--no-gpg-sign',
      '-m',
      name + ' ' + version + '\n\nSource: ' + sourceRevision
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function releaseTransport({ repository, name, version, format, artifact_commit }) {
  if (format === 'manifest') {
    return { manifest_url: artifactManifestUrl(repository, artifact_commit) }
  }
  assert.equal(format, 'script')
  const { classicContainerName } = await import('./extension-release/pack-classic.mjs')
  return {
    script: {
      asset_name: SCRIPT_NAME,
      global_name: classicContainerName({ repository, name, version }),
    },
  }
}

export async function prepareExtension({
  workspace,
  packagePath,
  artifactDirectory,
  corePackagePath,
  output,
  repository,
  format,
  sourceRevision = git(workspace, ['rev-parse', 'HEAD']),
}) {
  assert.equal(path.basename(packagePath), 'package.json')
  const relative = path.relative(workspace, path.dirname(packagePath))
  assert.ok(
    relative !== '..' && !relative.startsWith('..' + path.sep),
    'package.json must be inside the publisher checkout'
  )
  const sourcePath = relative.split(path.sep).join('/') || '.'
  const manifestPath = path.join(artifactDirectory, 'mf-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const publicPath = manifest.metaData?.publicPath
  assert.ok(
    ['./', 'auto'].includes(publicPath),
    'MF artifacts must be built with a relative or auto public path'
  )
  const extensionPackage = JSON.parse(await readFile(packagePath, 'utf8'))
  format ??= extensionPackage.inkcre?.module_federation?.format ?? 'manifest'
  assert.ok(['manifest', 'script'].includes(format), 'MF format must be manifest or script')

  const association = { packagePath, corePackagePath }
  const local = await inspectNativeModuleFederation({
    ...association,
    artifactDirectory,
    publicPath,
  })
  await listSnapshotFiles(artifactDirectory)
  await mkdir(output, { recursive: true })
  const candidate = {
    name: local.name,
    version: local.version,
    source_path: sourcePath,
    format,
    asset_name: format === 'manifest' ? ARCHIVE_NAME : SCRIPT_NAME,
  }
  const asset = path.join(output, candidate.asset_name)
  if (format === 'manifest') {
    const tree = path.join(output, 'site')
    await cp(artifactDirectory, tree, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (file) => !path.basename(file).startsWith('.'),
    })
    manifest.metaData.publicPath = 'auto'
    await writeFile(path.join(tree, 'mf-manifest.json'), JSON.stringify(manifest) + '\n')
    await inspectNativeModuleFederation({
      ...association,
      artifactDirectory: tree,
      publicPath: 'auto',
    })
    candidate.artifact_commit = await buildArtifactCommit({
      workspace,
      tree,
      sourceRevision,
      ...local,
    })
    git(workspace, ['archive', '--format=zip', '--output=' + asset, candidate.artifact_commit])
  }
  const transport = await releaseTransport({ repository, ...candidate })
  if (format === 'script') {
    const { packClassic } = await import('./extension-release/pack-classic.mjs')
    await packClassic({
      artifactDirectory,
      outputFile: asset,
      globalName: transport.script.global_name,
      webpack: await loadWebpack(),
    })
  }
  candidate.body = repositoryReleaseBody(sourcePath, local, transport)
  candidate.digest = await artifactDigest(asset)
  return { asset, candidate }
}

export async function prepareRepositoryExtension(options) {
  const { workspace, directory } = options
  const project = path.join(workspace, 'extensions', directory)
  const result = await prepareExtension({
    ...options,
    packagePath: path.join(project, 'package.json'),
    artifactDirectory: path.join(project, 'dist/web'),
    corePackagePath: path.join(workspace, 'packages/core/package.json'),
  })
  return { ...result, body: result.candidate.body }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, output, repository] = process.argv
  const { body } = await prepareRepositoryExtension({
    workspace: process.cwd(),
    directory,
    output: path.resolve(output),
    repository,
  })
  console.log(body)
}
