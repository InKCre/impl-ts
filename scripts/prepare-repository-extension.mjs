import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inspectNativeModuleFederation,
  listSnapshotFiles,
} from './verify-native-extension-distribution.mjs'

export const ARCHIVE_NAME = 'module-federation.zip'

export function artifactManifestUrl(repository, commit) {
  return 'https://cdn.jsdelivr.net/gh/' + repository + '@' + commit + '/mf-manifest.json'
}

export function repositoryReleaseBody(directory, local, manifestUrl) {
  return [
    '<!-- inkcre-release',
    JSON.stringify({
      schema_version: 1,
      source_path: 'extensions/' + directory,
      ...local.module_federation,
      manifest_url: manifestUrl,
    }),
    '-->',
  ].join('\n')
}

function git(workspace, args) {
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

export async function prepareRepositoryExtension({
  workspace,
  directory,
  output,
  repository,
  sourceRevision = git(workspace, ['rev-parse', 'HEAD']),
}) {
  const project = path.join(workspace, 'extensions', directory)
  const artifactDirectory = path.join(project, 'dist/web')
  const association = {
    packagePath: path.join(project, 'package.json'),
    corePackagePath: path.join(workspace, 'packages/core/package.json'),
  }
  const local = await inspectNativeModuleFederation({ ...association, artifactDirectory })
  await listSnapshotFiles(artifactDirectory)
  const tree = path.join(output, 'site')
  await cp(artifactDirectory, tree, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (source) => !path.basename(source).startsWith('.'),
  })
  const manifestPath = path.join(tree, 'mf-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.metaData.publicPath = 'auto'
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
  await inspectNativeModuleFederation({
    ...association,
    artifactDirectory: tree,
    publicPath: 'auto',
  })

  const artifactCommit = await buildArtifactCommit({ workspace, tree, sourceRevision, ...local })
  const body = repositoryReleaseBody(
    directory,
    local,
    artifactManifestUrl(repository, artifactCommit)
  )
  const archive = path.join(output, ARCHIVE_NAME)
  execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: tree })
  return { archive, artifactCommit, body }
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
