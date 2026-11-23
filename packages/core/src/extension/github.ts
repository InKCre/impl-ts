import { rcompare, satisfies, validRange } from 'semver'
import { z } from 'zod'
import {
  ExtensionNameSchema,
  ExtensionParticipationModel,
  ExtensionVersionSchema,
  normalizeExtensionSourceRepository,
} from './model'

const releaseTag = /^inkcre-ext\/([^/]+\/[^/]+)\/(python|module_federation)\/v([^/]+)$/
const descriptorComment = /<!-- inkcre-release\r?\n([\s\S]*?)\r?\n-->/
const apiOrigin = 'https://api.github.com'

const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  body: z.string().nullable().optional(),
  draft: z.boolean(),
  assets: z.unknown().optional(),
})

const GitHubDescriptorSchema = z.object({
  schema_version: z.literal(1),
  source_path: z
    .string()
    .refine(
      (path) =>
        path === '.' || path.split('/').every((part) => part && part !== '.' && part !== '..')
    ),
  host_sdk: z.enum(['core-py', '@inkcre/core']),
  host_sdk_version: z.string().refine((range) => validRange(range) !== null),
  manifest_url: z.url({ protocol: /^https?$/ }).optional(),
})
const GitHubWebDescriptorSchema = GitHubDescriptorSchema.extend({
  python_repository: z.string().transform(normalizeExtensionSourceRepository).optional(),
  script: z
    .object({
      asset_name: z.string().regex(/^[^/\\\r\n]+\.js$/),
      global_name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    })
    .optional(),
})
const GitHubReleaseAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.url({ protocol: /^https$/ }),
})

type GitHubWebEntry = { manifest_url: string } | { script: { url: string; global_name: string } }

export type GitHubExtensionDistribution = 'python' | 'module_federation'
export interface GitHubExtensionRelease {
  repository: string
  tag: string
  name: string
  version: string
  distribution: GitHubExtensionDistribution
  descriptor: z.infer<typeof GitHubWebDescriptorSchema>
  webEntry?: GitHubWebEntry
}

function repositoryApi(repository: string): string {
  return `${apiOrigin}/repos${new URL(normalizeExtensionSourceRepository(repository)).pathname}`
}

async function githubRequest(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}.`)
  return response
}

function readWebEntry(
  release: z.infer<typeof GitHubReleaseSchema>,
  descriptor: z.infer<typeof GitHubWebDescriptorSchema>
): GitHubWebEntry | null {
  const { manifest_url, script } = descriptor
  if (manifest_url) return script ? null : { manifest_url }
  if (!script) return null

  const assets = GitHubReleaseAssetSchema.array().optional().parse(release.assets)
  const asset = assets?.find(({ name }) => name === script.asset_name)
  return asset
    ? { script: { url: asset.browser_download_url, global_name: script.global_name } }
    : null
}

function readRelease(
  repository: string,
  release: z.infer<typeof GitHubReleaseSchema>
): GitHubExtensionRelease | null {
  const coordinate = releaseTag.exec(release.tag_name)
  const content = release.body?.match(descriptorComment)?.[1]
  if (release.draft || !coordinate || !content) return null

  try {
    const distribution = coordinate[2] as GitHubExtensionDistribution
    const rawDescriptor: unknown = JSON.parse(content)
    const selection = {
      repository,
      tag: release.tag_name,
      name: ExtensionNameSchema.parse(coordinate[1]),
      version: ExtensionVersionSchema.parse(coordinate[3]),
      distribution,
    }
    if (distribution === 'module_federation') {
      const descriptor = GitHubWebDescriptorSchema.parse(rawDescriptor)
      if (descriptor.host_sdk !== '@inkcre/core') return null
      const webEntry = readWebEntry(release, descriptor)
      return webEntry ? { ...selection, descriptor, webEntry } : null
    }
    const descriptor = GitHubDescriptorSchema.parse(rawDescriptor)
    return descriptor.host_sdk === 'core-py' ? { ...selection, descriptor } : null
  } catch {
    return null
  }
}

export async function searchGitHubExtensionRepositories(): Promise<string[]> {
  const response = await githubRequest(
    `${apiOrigin}/search/repositories?q=topic%3Ainkcre-extension&per_page=30`
  )
  const { items } = z
    .object({ items: z.array(z.object({ html_url: z.string() })) })
    .parse(await response.json())
  return items.map(({ html_url }) => normalizeExtensionSourceRepository(html_url))
}

export async function listGitHubExtensionReleases(
  repository: string
): Promise<GitHubExtensionRelease[]> {
  const source = normalizeExtensionSourceRepository(repository)
  const releases: GitHubExtensionRelease[] = []
  let page: string | undefined = `${repositoryApi(source)}/releases?per_page=100`
  while (page) {
    const response = await githubRequest(page)
    for (const entry of GitHubReleaseSchema.array().parse(await response.json())) {
      const release = readRelease(source, entry)
      if (release) releases.push(release)
    }
    page = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
  }
  return releases.sort((left, right) => rcompare(left.version, right.version))
}

/** Resolve the Python counterpart when setup starts from a repository-installed Web module. */
export async function getGitHubPythonSetupRelease(
  name: string,
  webPeerId: string
): Promise<GitHubExtensionRelease | null> {
  const webSelection = await ExtensionParticipationModel.get(webPeerId, name)
  if (!webSelection?.source_repository) return null
  const source = webSelection.source_repository
  const webRelease = await getGitHubExtensionRelease(
    source,
    name,
    'module_federation',
    webSelection.version
  )
  const repository = webRelease.descriptor.python_repository ?? source
  const release = (await listGitHubExtensionReleases(repository)).find(
    (candidate) => candidate.name === name && candidate.distribution === 'python'
  )
  if (!release) throw new Error(`No published Python release for ${name} in ${repository}.`)
  return release
}

export async function getGitHubExtensionRelease(
  repository: string,
  name: string,
  distribution: GitHubExtensionDistribution,
  version: string
): Promise<GitHubExtensionRelease> {
  const source = normalizeExtensionSourceRepository(repository)
  const tag = `inkcre-ext/${ExtensionNameSchema.parse(name)}/${distribution}/v${ExtensionVersionSchema.parse(version)}`
  const response = await githubRequest(
    `${repositoryApi(source)}/releases/tags/${encodeURIComponent(tag)}`
  )
  const release = readRelease(source, GitHubReleaseSchema.parse(await response.json()))
  if (release?.tag !== tag)
    throw new Error(`GitHub Release ${tag} has no matching InKCre release description.`)
  return release
}

export function supportsGitHubExtensionSdk(
  release: GitHubExtensionRelease,
  name: 'core-py' | '@inkcre/core',
  version: string
): boolean {
  return (
    release.descriptor.host_sdk === name && satisfies(version, release.descriptor.host_sdk_version)
  )
}

export async function getGitHubExtensionDocumentation(
  release: GitHubExtensionRelease
): Promise<string | null> {
  const api = repositoryApi(release.repository)
  const ref = `refs/tags/${release.tag}`
  const prefix = release.descriptor.source_path === '.' ? '' : `${release.descriptor.source_path}/`
  const path = `${prefix}docs/user`.split('/').map(encodeURIComponent).join('/')
  const contents = await fetch(`${api}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (contents.status === 404) return null
  if (!contents.ok)
    throw new Error(`GitHub documentation request failed with HTTP ${contents.status}.`)
  return `${release.repository}/tree/${ref}/${path}`
}
