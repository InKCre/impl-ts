import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, stableJson } from './core-release-lib.mjs'

const directory = '.webext-delivery'
const app = 'apps/client-webext'
const repository = 'InKCre/impl-ts'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

export function extensionId(key) {
  return sha256(Buffer.from(key, 'base64'))
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
}

export function preparedVersion(version, changelog, pending) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Use a numeric browser version, not a prerelease suffix')
  assert.ok(
    version.split('.').every((part) => Number(part) <= 65535),
    'Browser version segment exceeds 65535'
  )
  return !pending && changelog.split('\n').some((line) => line === `## ${version}`)
}

export function checkManifest(manifest, version, browser, key) {
  assert.equal(manifest.version, version)
  assert.equal(manifest.manifest_version, 3)
  if (browser === 'chrome')
    assert.equal(manifest.key, key, 'Release must use the fixed Chromium identity')
  else assert.equal(manifest.browser_specific_settings?.gecko?.id, 'webext@inkcre.org')
  assert.ok(!manifest.permissions.includes('debugger'))
}

async function api(route, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 404) return null
  assert.ok(response.ok, `GitHub returned HTTP ${response.status}`)
  return response.json()
}

async function currentMain() {
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Publication requires protected main')
  assert.equal(process.env.GITHUB_REPOSITORY, repository)
  const source = process.env.SOURCE_REVISION
  assert.match(source ?? '', /^[0-9a-f]{40}$/)
  assert.equal(git('rev-parse', 'HEAD'), source)
  assert.equal(
    (await api('git/ref/heads/main'))?.object.sha,
    source,
    'Source is no longer current main'
  )
  assert.equal(
    git('status', '--porcelain', '--untracked-files=no'),
    '',
    'Tracked source must be clean'
  )
  return source
}

async function findRelease(tag) {
  // The tag lookup omits unpublished drafts, so inspect authenticated inventory too.
  const pages = JSON.parse(
    gh(['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])
  )
  return pages.flat().find((release) => release.tag_name === tag)
}

export function assertDraft(release, tag, source) {
  assert.ok(release, 'GitHub draft release was not found')
  assert.equal(release.tag_name, tag)
  assert.equal(
    release.draft,
    true,
    'Published versions are never overwritten; prepare a new version'
  )
  assert.equal(
    release.target_commitish,
    source,
    'Draft belongs to another source; do not replace it'
  )
}

export async function createDraftRelease({ tag, source, version, news }) {
  const body = `${news}\n\nChromium：下载 chrome ZIP，解压到固定目录加载，覆盖目录后重新加载更新，不要卸载。Firefox ZIP 未签名，仅供临时加载，不能作为正式安装包。source.tar.gz 为对应仓库源码，不含私有依赖，尚非 AMO 独立审查包。\n\n来源 ${source}。source.json 记录实际包的 SHA256。`
  const release = await api('releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: source,
      draft: true,
      name: `WebExt ${version}`,
      body,
    }),
  })
  assertDraft(release, tag, source)
  return release
}

async function verifyCandidate() {
  const receipt = await readJson(`${directory}/source.json`)
  assert.equal(receipt.name, '@inkcre/client-webext')
  assert.match(receipt.version, /^\d+\.\d+\.\d+$/)
  assert.match(receipt.source_revision, /^[0-9a-f]{40}$/)
  assert.deepEqual(receipt.assets.map((asset) => asset.name).sort(), [
    `inkcre-webext-${receipt.version}-chrome.zip`,
    `inkcre-webext-${receipt.version}-firefox.zip`,
    `inkcre-webext-${receipt.version}-source.tar.gz`,
  ])
  for (const asset of receipt.assets) {
    assert.equal(path.basename(asset.name), asset.name)
    assert.equal(sha256(await readFile(`${directory}/${asset.name}`)), asset.sha256)
  }
  const { key } = await readJson(`${app}/chromium-key.json`)
  assert.equal(receipt.chromium_id, extensionId(key))
  assert.equal(receipt.firefox_id, 'webext@inkcre.org')
  assert.equal(receipt.firefox_signed, false)
  for (const browser of ['chrome', 'firefox']) {
    const file = `${directory}/inkcre-webext-${receipt.version}-${browser}.zip`
    const manifest = JSON.parse(
      execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' })
    )
    checkManifest(manifest, receipt.version, browser, key)
  }
  return receipt
}

async function versionPrepared(version) {
  await mkdir(directory, { recursive: true })
  run('pnpm', ['exec', 'changeset', 'status', '--output', `${directory}/changesets.json`])
  const status = await readJson(`${directory}/changesets.json`)
  const pending = status.changesets.some((item) =>
    item.releases.some((release) => release.name === '@inkcre/client-webext')
  )
  let changelog = ''
  try {
    changelog = await readFile(`${app}/CHANGELOG.md`, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return preparedVersion(version, changelog, pending)
}

export async function main(command) {
  const { version } = await readJson(`${app}/package.json`)
  const tag = `webext-v${version}`
  if (command === 'plan') {
    await currentMain()
    const release = await findRelease(tag)
    // Public versions are history; a matching unpublished draft can be completed.
    const publish = (await versionPrepared(version)) && (!release || release.draft)
    if (publish && release) assertDraft(release, tag, process.env.SOURCE_REVISION)
    await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`)
    console.log(publish ? `${tag}: prepared release selected` : `${tag}: no new prepared release`)
    return
  }
  if (command === 'build') {
    assert.equal(
      git('status', '--porcelain', '--untracked-files=no'),
      '',
      'Commit source before packaging'
    )
    const source = git('rev-parse', 'HEAD')
    const { key } = await readJson(`${app}/chromium-key.json`)
    await mkdir(directory, { recursive: true })
    const names = []
    for (const browser of ['chrome', 'firefox']) {
      run('pnpm', [
        '--filter',
        '@inkcre/client-webext',
        browser === 'chrome' ? 'zip' : 'zip:firefox',
      ])
      const name = `inkcre-webext-${version}-${browser}.zip`
      await copyFile(
        `${app}/.output/inkcre-webext-${version}-${browser}-production.zip`,
        `${directory}/${name}`
      )
      names.push(name)
    }
    const sourceName = `inkcre-webext-${version}-source.tar.gz`
    run('git', ['archive', '--format=tar.gz', `--output=${directory}/${sourceName}`, source])
    names.push(sourceName)
    const receipt = {
      name: '@inkcre/client-webext',
      version,
      source_revision: source,
      chromium_id: extensionId(key),
      firefox_id: 'webext@inkcre.org',
      firefox_signed: false,
      assets: await Promise.all(
        names.map(async (name) => ({
          name,
          sha256: sha256(await readFile(`${directory}/${name}`)),
        }))
      ),
    }
    await writeFile(`${directory}/source.json`, stableJson(receipt))
    await verifyCandidate()
    console.log(`Local candidate ${tag}; no release or signing performed`)
    return
  }
  const receipt = await verifyCandidate()
  if (command === 'check') return
  assert.equal(command, 'publish')
  assert.equal(receipt.source_revision, await currentMain())
  assert.equal(receipt.version, version)
  assert.ok(await versionPrepared(version), 'Prepare the version through the Version PR first')
  const tagged = await api(`git/ref/tags/${tag}`)
  if (tagged)
    assert.equal(
      (await api(`commits/${tag}`)).sha,
      receipt.source_revision,
      'Existing tag belongs to another source'
    )
  let release = await findRelease(tag)
  if (!release) {
    const changelog = await readFile(`${app}/CHANGELOG.md`, 'utf8')
    const news = changelog.split(`## ${version}\n`)[1]?.split('\n## ')[0]?.trim() ?? ''
    release = await createDraftRelease({ tag, source: receipt.source_revision, version, news })
  }
  assertDraft(release, tag, receipt.source_revision)
  // Only an unpublished same-source draft may be completed/rebuilt after an interrupted upload.
  gh([
    'release',
    'upload',
    tag,
    '--repo',
    repository,
    '--clobber',
    ...receipt.assets.map((asset) => `${directory}/${asset.name}`),
    `${directory}/source.json`,
  ])
  release = await api(`releases/${release.id}`)
  for (const asset of [
    ...receipt.assets,
    { name: 'source.json', sha256: sha256(await readFile(`${directory}/source.json`)) },
  ]) {
    const remote = release.assets.find((entry) => entry.name === asset.name)
    assert.ok(remote, `Missing uploaded asset ${asset.name}`)
    const bytes = execFileSync(
      'gh',
      [
        'api',
        `repos/${repository}/releases/assets/${remote.id}`,
        '-H',
        'Accept: application/octet-stream',
      ],
      { maxBuffer: 128 * 1024 * 1024 }
    )
    assert.equal(sha256(bytes), asset.sha256, `Uploaded bytes differ: ${asset.name}`)
  }
  gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest=false'])
  console.log(`Published ${tag}; browser-store submission is separate`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv[2])
