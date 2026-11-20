import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inspectNativeModuleFederation,
  listSnapshotFiles,
} from './verify-native-extension-distribution.mjs'

export const ARCHIVE_NAME = 'module-federation.zip'

export function extensionSitePath(name, version) {
  return `extensions/${name}/${version}/`
}

export function repositoryReleaseBody(directory, local, publicPath) {
  return [
    '<!-- inkcre-release',
    JSON.stringify({
      schema_version: 1,
      source_path: `extensions/${directory}`,
      ...local.module_federation,
      manifest_url: new URL('mf-manifest.json', publicPath).href,
    }),
    '-->',
  ].join('\n')
}

export async function prepareRepositoryExtension({ workspace, directory, output, pagesBase }) {
  const project = path.join(workspace, 'extensions', directory)
  const artifactDirectory = path.join(project, 'dist/web')
  const local = await inspectNativeModuleFederation({
    packagePath: path.join(project, 'package.json'),
    corePackagePath: path.join(workspace, 'packages/core/package.json'),
    artifactDirectory,
  })
  await listSnapshotFiles(artifactDirectory)
  const relativePath = extensionSitePath(local.name, local.version)
  const publicPath = new URL(relativePath, pagesBase).href
  const tree = path.join(output, 'site', relativePath)
  await mkdir(path.dirname(tree), { recursive: true })
  await cp(artifactDirectory, tree, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (source) => !path.basename(source).startsWith('.'),
  })
  const manifestPath = path.join(tree, 'mf-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.metaData.publicPath = publicPath
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
  await inspectNativeModuleFederation({
    packagePath: path.join(project, 'package.json'),
    corePackagePath: path.join(workspace, 'packages/core/package.json'),
    artifactDirectory: tree,
    publicPath,
  })

  const body = repositoryReleaseBody(directory, local, publicPath)
  const archive = path.join(output, ARCHIVE_NAME)
  execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: tree })
  return { archive, body }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, output, pagesBase] = process.argv
  const { body } = await prepareRepositoryExtension({
    workspace: process.cwd(),
    directory,
    output: path.resolve(output),
    pagesBase,
  })
  console.log(body)
}
