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
      const transport = async (input, init) => {
        calls.push({ url: String(input), token: new Headers(init.headers).get('Authorization'), body: init.body })
        if (String(input).includes('read_storage_blob')) return new Response(new Uint8Array([1, 2, 3]))
        return Response.json([])
      }
      const selected = { baseUrl: 'https://a.example', tokenProvider: async () => 'token-a', fetch: transport }
      const a = new DatabaseClient('blocks', undefined, selected)
      selected.baseUrl = 'https://b.example'
      selected.tokenProvider = async () => 'token-b'
      const b = new DatabaseClient('blocks', undefined, selected)
      await Promise.all([a.from().select(), b.insert({ content: 'B', resolver: 'core.text.v1' }).select()])
      const read = calls.find(call => new URL(call.url).origin === 'https://a.example')
      const write = calls.find(call => new URL(call.url).origin === 'https://b.example')
      assert.equal(read?.token, 'Bearer token-a')
      assert.equal(write?.token, 'Bearer token-b')
      assert.equal(JSON.parse(write.body).content, 'B')
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
