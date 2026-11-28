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
      const { DatabaseClient, PostgreSQLBlobStorage, PeerOutcomeUnknown } = await import('@inkcre/core/sdk')
      assert.equal(typeof PeerOutcomeUnknown, 'function')
      const calls = []
      const startedA = Promise.withResolvers()
      const releaseA = Promise.withResolvers()
      const transport = async (input, init) => {
        calls.push({ url: String(input), token: new Headers(init.headers).get('Authorization'), body: init.body })
        if (String(input).includes('read_storage_blob')) return new Response(new Uint8Array([1, 2, 3]))
        if (String(input).startsWith('https://a.example')) {
          startedA.resolve()
          await releaseA.promise
        }
        return Response.json([{ id: 1, content: 'retained', resolver: 'core.text.v1', storage: null }])
      }
      const selected = { baseUrl: 'https://a.example', tokenProvider: async () => 'token-a', fetch: transport }
      const a = new DatabaseClient('blocks', undefined, selected)
      const pendingA = a.from().select().then(value => value)
      await Promise.race([startedA.promise, pendingA.then(() => assert.fail('request A did not reach its transport'))])
      selected.baseUrl = 'https://b.example'
      selected.tokenProvider = async () => 'token-b'
      const b = new DatabaseClient('blocks', undefined, selected)
      const resultB = await b.insert({ content: 'B', resolver: 'core.text.v1' }).select()
      releaseA.resolve()
      const resultA = await pendingA
      assert.equal(resultA.data[0].id, 1)
      assert.equal(resultB.data[0].id, 1)
      assert.equal(calls[0].url.startsWith('https://a.example/'), true)
      assert.equal(calls[0].token, 'Bearer token-a')
      assert.equal(calls[1].url.startsWith('https://b.example/'), true)
      assert.equal(calls[1].token, 'Bearer token-b')
      assert.equal(JSON.parse(calls[1].body).content, 'B')
      const explicitStorage = PostgreSQLBlobStorage.forConnection(selected)
      globalThis.fetch = transport
      const blobConnection = { baseUrl: selected.baseUrl, tokenProvider: selected.tokenProvider }
      const storage = PostgreSQLBlobStorage.forConnection(blobConnection)
      selected.baseUrl = blobConnection.baseUrl = 'https://c.example'
      globalThis.fetch = () => { throw new Error('blob read switched transport after construction') }
      const pointer = '{"blob_id":"00000000-0000-4000-8000-000000000001"}'
      for (const client of [explicitStorage, storage]) {
        assert.deepEqual([...(await client.getRawContent(pointer))], [1, 2, 3])
        assert.equal(calls.at(-1).url, 'https://b.example/rpc/read_storage_blob')
        assert.equal(calls.at(-1).token, 'Bearer token-b')
      }
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
      const id: number = response.data![0].id
      // @ts-expect-error The generated Block row has a numeric id.
      const wrongId: string = response.data![0].id
      // @ts-expect-error Relation names belong to the admitted database protocol.
      new DatabaseClient('missing_relation', undefined, connection)
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
