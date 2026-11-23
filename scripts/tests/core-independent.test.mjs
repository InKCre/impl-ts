import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../..', import.meta.url))

void test('packed SDK works without UI, source aliases, startup or selected App connection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkcre-sdk-'))
  try {
    const packageRoot = path.join(root, 'packages/core')
    const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    const packed = JSON.parse(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
        cwd: packageRoot,
        encoding: 'utf8',
      })
    )
    const destination = path.join(directory, 'node_modules/@inkcre/core')
    await mkdir(destination, { recursive: true })
    execFileSync('tar', [
      '-xzf',
      path.join(directory, packed[0].filename),
      '--strip-components=1',
      '-C',
      destination,
    ])
    for (const dependency of Object.keys(metadata.dependencies)) {
      const link = path.join(directory, 'node_modules', dependency)
      await mkdir(path.dirname(link), { recursive: true })
      await symlink(path.join(packageRoot, 'node_modules', dependency), link)
    }
    for (const dependency of ['vue', 'pinia', '@vueuse/core']) {
      assert.equal(metadata.peerDependenciesMeta[dependency].optional, true)
    }
    await writeFile(
      path.join(directory, 'consumer.mjs'),
      `
      import assert from 'node:assert/strict'
      globalThis.fetch = () => { throw new Error('Unexpected network/startup') }
      const { DatabaseClient, PostgreSQLBlobStorage, rawPostgrestFetch, PeerOutcomeUnknown } = await import('@inkcre/core/sdk')
      assert.equal(typeof PeerOutcomeUnknown, 'function')
      const calls = []
      let finishA
      const transport = async (input, init) => {
        calls.push({ url: String(input), token: new Headers(init.headers).get('Authorization'), body: init.body })
        if (String(input).includes('read_storage_blob')) return new Response(new Uint8Array([1, 2, 3]))
        if (String(input).startsWith('https://a.example') && !finishA) await new Promise(resolve => { finishA = resolve })
        return Response.json([{ id: 1, content: 'retained', resolver: 'core.text.v1', storage: null }])
      }
      const selected = { baseUrl: 'https://a.example', tokenProvider: async () => 'token-a', fetch: transport }
      const a = new DatabaseClient('blocks', undefined, selected)
      const pendingA = a.from().select().then(value => value)
      while (!finishA) await new Promise(resolve => setTimeout(resolve, 0))
      selected.baseUrl = 'https://b.example'
      selected.tokenProvider = async () => 'token-b'
      const b = new DatabaseClient('blocks', undefined, selected)
      const resultB = await b.insert({ content: 'B', resolver: 'core.text.v1' }).select()
      finishA()
      const resultA = await pendingA
      assert.equal(resultA.data[0].id, 1)
      assert.equal(resultB.data[0].id, 1)
      assert.equal(calls[0].url.startsWith('https://a.example/'), true)
      assert.equal(calls[0].token, 'Bearer token-a')
      assert.equal(calls[1].url.startsWith('https://b.example/'), true)
      assert.equal(calls[1].token, 'Bearer token-b')
      assert.equal(JSON.parse(calls[1].body).content, 'B')
      const storage = PostgreSQLBlobStorage.forConnection(selected)
      selected.baseUrl = 'https://c.example'
      const bytes = await storage.getRawContent(JSON.stringify({ blob_id: '00000000-0000-4000-8000-000000000001' }))
      assert.deepEqual([...bytes], [1, 2, 3])
      assert.equal(calls[2].url.startsWith('https://b.example/'), true)
      console.log('Packed independent SDK: import, isolated targets, typed writes and binary storage passed')
    `
    )
    execFileSync(process.execPath, ['consumer.mjs'], { cwd: directory, stdio: 'inherit' })
    await writeFile(
      path.join(directory, 'consumer.mts'),
      `
      import { DatabaseClient, type DatabaseConnection, type RelationRow } from '@inkcre/core/sdk'
      const connection: DatabaseConnection = { baseUrl: 'https://example.test', tokenProvider: async () => 'unused' }
      const client = new DatabaseClient('blocks', undefined, connection)
      const response = await client.from().select()
      const blocks: RelationRow<'blocks'>[] | null = response.data
      void blocks
    `
    )
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'esnext',
        '--module',
        'nodenext',
        'consumer.mts',
      ],
      {
        cwd: directory,
        stdio: 'inherit',
      }
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test('Python setup follows the selected Web release and the same rule for any publisher', async (t) => {
  const { ExtensionParticipationModel, getGitHubPythonSetupRelease } =
    await import('../../packages/core/dist/index.js')
  const name = 'example/mail'
  const version = '0.5.0'
  const peer = 'web-peer'
  const webRepository = 'https://github.com/example/mail-web'
  const pythonRepository = 'https://github.com/another-owner/mail-python'
  const webTag = `inkcre-ext/${name}/module_federation/v${version}`
  const webEndpoint = `https://api.github.com/repos/example/mail-web/releases/tags/${encodeURIComponent(webTag)}`
  const pythonEndpoint =
    'https://api.github.com/repos/another-owner/mail-python/releases?per_page=100'
  const sameRepoEndpoint = 'https://api.github.com/repos/example/mail-web/releases?per_page=100'
  const makeRelease = (tag_name, host_sdk, metadata = {}) => ({
    draft: false,
    tag_name,
    body: `<!-- inkcre-release\n${JSON.stringify({
      schema_version: 1,
      source_path: '.',
      host_sdk,
      host_sdk_version: '^0.4.0',
      ...metadata,
    })}\n-->`,
  })
  const pythonRelease = makeRelease(`inkcre-ext/${name}/python/v0.4.0`, 'core-py')
  const unrelatedRelease = makeRelease('inkcre-ext/example/other/python/v0.9.0', 'core-py')
  const calls = []
  let sourceRepository = webRepository
  let declaredRepository = pythonRepository
  let hasCounterpart = true
  t.mock.method(ExtensionParticipationModel, 'get', async (peerId, extensionName) => {
    assert.equal(peerId, peer)
    assert.equal(extensionName, name)
    return { version, source_repository: sourceRepository }
  })
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url)
    if (url === webEndpoint) {
      return Response.json(
        makeRelease(webTag, '@inkcre/core', {
          manifest_url: 'https://assets.example/mail/mf-manifest.json',
          python_repository: declaredRepository,
        })
      )
    }
    assert.ok([pythonEndpoint, sameRepoEndpoint].includes(url), url)
    return Response.json(hasCounterpart ? [unrelatedRelease, pythonRelease] : [unrelatedRelease])
  })

  const external = await getGitHubPythonSetupRelease(name, peer)
  assert.equal(external.repository, pythonRepository)
  assert.equal(external.name, name)
  assert.equal(external.version, '0.4.0')
  assert.deepEqual(calls.splice(0), [webEndpoint, pythonEndpoint])

  declaredRepository = undefined
  assert.equal((await getGitHubPythonSetupRelease(name, peer)).repository, webRepository)
  assert.deepEqual(calls.splice(0), [webEndpoint, sameRepoEndpoint])

  hasCounterpart = false
  await assert.rejects(() => getGitHubPythonSetupRelease(name, peer), /No published Python release/)
  assert.deepEqual(calls.splice(0), [webEndpoint, sameRepoEndpoint])

  sourceRepository = null
  assert.equal(await getGitHubPythonSetupRelease(name, peer), null)
  assert.deepEqual(calls, [])
})

void test('GitHub discovery and exact lookup resolve both Web release entry formats', async (t) => {
  const {
    getGitHubExtensionDocumentation,
    getGitHubExtensionRelease,
    listGitHubExtensionReleases,
    supportsGitHubExtensionSdk,
  } = await import('../../packages/core/dist/index.js')
  const repository = 'https://github.com/InKCre/example'
  const api = 'https://api.github.com/repos/InKCre/example/releases'
  const tag = 'inkcre-ext/example/mail/module_federation/v0.5.0'
  const pythonTag = 'inkcre-ext/example/mail/python/v0.4.0'
  const manifestTag = 'inkcre-ext/example/mail/module_federation/v0.4.0'
  const asset_name = 'remoteEntry.js'
  const global_name = 'inkcre_example_mail_0_5_0'
  const assetUrl = `https://github.com/inkcre/Renamed/releases/download/${encodeURIComponent(tag)}/${asset_name}`
  const manifest_url = 'https://assets.example/mail/0.4.0/mf-manifest.json'
  const docsRef = `refs/tags/${tag}`
  const docsPath = 'plugins/mail/docs/user'
  const docsEndpoint = `https://api.github.com/repos/InKCre/example/contents/${docsPath}?ref=${encodeURIComponent(docsRef)}`
  const descriptor = {
    schema_version: 1,
    source_path: 'plugins/mail',
    host_sdk: '@inkcre/core',
    host_sdk_version: '>=0.4.0 <0.5.0',
  }
  const script = { asset_name, global_name }
  const makeRelease = (tag_name, metadata, assets = []) => ({
    draft: false,
    tag_name,
    body: `<!-- inkcre-release\n${JSON.stringify({ ...descriptor, ...metadata })}\n-->`,
    assets,
  })
  const assets = [{ name: asset_name, browser_download_url: assetUrl }]
  const manifest = makeRelease(manifestTag, { manifest_url })
  const python = makeRelease(pythonTag, { host_sdk: 'core-py' })
  let exact = makeRelease(tag, { script }, assets)
  let docsExist = true
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === `${api}?per_page=100`) return Response.json([manifest, python, exact])
    if (url === docsEndpoint) return new Response(null, { status: docsExist ? 200 : 404 })
    assert.equal(url, `${api}/tags/${encodeURIComponent(tag)}`)
    return Response.json(exact)
  })

  const [scriptRelease, manifestRelease, pythonRelease] =
    await listGitHubExtensionReleases(repository)
  assert.deepEqual(scriptRelease.webEntry, { script: { url: assetUrl, global_name } })
  assert.deepEqual(manifestRelease.webEntry, { manifest_url })
  assert.equal(pythonRelease.distribution, 'python')
  assert.equal(pythonRelease.webEntry, undefined)
  assert.deepEqual(
    await getGitHubExtensionRelease(repository, 'example/mail', 'module_federation', '0.5.0'),
    scriptRelease
  )
  assert.equal(supportsGitHubExtensionSdk(scriptRelease, '@inkcre/core', '0.4.5'), true)
  assert.equal(supportsGitHubExtensionSdk(scriptRelease, '@inkcre/core', '0.5.0'), false)
  assert.equal(
    await getGitHubExtensionDocumentation(scriptRelease),
    `${repository}/tree/${docsRef}/${docsPath}`
  )
  docsExist = false
  assert.equal(await getGitHubExtensionDocumentation(scriptRelease), null)

  for (const [label, release] of [
    ['both entry formats', makeRelease(tag, { script, manifest_url }, assets)],
    ['no entry format', makeRelease(tag, {})],
    [
      'invalid global',
      makeRelease(tag, { script: { ...script, global_name: 'inkcre.mail' } }, assets),
    ],
    [
      'no matching attachment',
      makeRelease(tag, { script }, [{ ...assets[0], name: 'different.js' }]),
    ],
    [
      'attachment without .js suffix',
      makeRelease(tag, { script: { ...script, asset_name: 'remoteEntry.zip' } }, [
        { name: 'remoteEntry.zip', browser_download_url: assetUrl.replace(/\.js$/, '.zip') },
      ]),
    ],
    [
      'attachment without HTTPS',
      makeRelease(tag, { script }, [
        { name: asset_name, browser_download_url: assetUrl.replace('https:', 'http:') },
      ]),
    ],
  ]) {
    exact = release
    await assert.rejects(
      () => getGitHubExtensionRelease(repository, 'example/mail', 'module_federation', '0.5.0'),
      /no matching InKCre release description/,
      label
    )
    assert.equal((await listGitHubExtensionReleases(repository)).length, 2, label)
  }
})
