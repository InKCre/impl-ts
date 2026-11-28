import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

// Exercise the real request/auth modules without starting application configuration or telemetry.
// This fixture also runs before a distribution build when isolating an auth regression locally.
async function authenticationFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkcre-auth-'))
  try {
    const { default: ts } = await import('typescript')
    for (const dependency of ['vue', 'jose', '@supabase/postgrest-js']) {
      const link = path.join(directory, 'node_modules', dependency)
      await mkdir(path.dirname(link), { recursive: true })
      await symlink(path.join(root, 'packages/core/node_modules', dependency), link)
    }
    for (const file of ['auth/store', 'auth/sign', 'auth/defaults', 'base/client', 'base/db-api']) {
      const source = await readFile(path.join(root, 'packages/core/src', `${file}.ts`), 'utf8')
      let output = ts
        .transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
        })
        .outputText.replace(/(['"])(\.{1,2}\/[^'"]+)\1/g, (_, quote, specifier) => {
          const target = specifier === '../auth' ? '../auth/store' : specifier
          return `${quote}${target}.js${quote}`
        })
      if (file === 'auth/sign') {
        output = output.replace(
          'export async function signDatabaseToken',
          'async function signImmediately'
        )
        output += `
          let nextGate
          export function deferNextSignature() {
            let release
            nextGate = new Promise(resolve => { release = resolve })
            return release
          }
          export async function signDatabaseToken(secret) {
            const gate = nextGate
            nextGate = undefined
            const signed = await signImmediately(secret)
            if (gate) await gate
            return signed
          }
        `
      }
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await writeFile(path.join(directory, `${file}.js`), output)
    }
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
    await writeFile(
      path.join(directory, 'config.js'),
      `
      import { reactive } from 'vue'
      export const configStore = reactive({ metaConfig: { INKCRE_PGREST_URL: '', INKCRE_JWT_SECRET: '' } })
    `
    )
    const contract = JSON.parse(
      await readFile(
        path.join(root, 'packages/core/src/database/runtime-contract.generated.json'),
        'utf8'
      )
    )
    await writeFile(
      path.join(directory, 'database.js'),
      `export const peerJwtContract = ${JSON.stringify(contract.jwt)}`
    )
    await mkdir(path.join(directory, 'obsrv'))
    await writeFile(
      path.join(directory, 'obsrv/telemetry.js'),
      `
      export const SpanKind = { CLIENT: 2 }
      export const SpanStatusCode = { ERROR: 2 }
      export const observeOperation = (_name, operation) => operation(undefined, undefined, {})
    `
    )
    const load = (file) => import(pathToFileURL(path.join(directory, `${file}.js`)).href)
    return {
      ...(await load('auth/store')),
      ...(await load('auth/sign')),
      ...(await load('base/db-api')),
      ...(await load('config')),
      dispose: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

void test('Vue default authentication renews JWTs and binds requests to the selected connection', async () => {
  const { authStore, configStore, DBAPIClient, rawPostgrestFetch, dispose, deferNextSignature } =
    await authenticationFixture()
  const { createHmac } = await import('node:crypto')
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  const originalConfig = { ...configStore.metaConfig }
  const calls = []
  let now = Date.UTC(2030, 0, 1)
  Date.now = () => now
  const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  const matchesSecret = (token, secret) => {
    const [header, payload, signature] = token.split('.')
    return (
      createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url') === signature
    )
  }
  const select = (baseUrl, secret) => {
    configStore.metaConfig.INKCRE_PGREST_URL = baseUrl
    configStore.metaConfig.INKCRE_JWT_SECRET = secret
  }
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      token: new Headers(init.headers).get('Authorization').slice(7),
    })
    return Response.json([])
  }
  try {
    select('https://a.example/database/', 'secret-a')
    const client = new DBAPIClient('blocks')
    await client.from().select().throwOnError()
    const first = calls.at(-1).token
    assert.equal(matchesSecret(first, 'secret-a'), true)
    assert.equal(claims(first).iat, Math.floor(now / 1000) - 5)
    assert.equal(authStore.token.value, first)
    now = claims(first).exp * 1000 - 1
    assert.equal(await authStore.getToken(), first)
    now += 1
    const concurrent = await Promise.all([authStore.getToken(), authStore.getToken()])
    assert.equal(concurrent[0], concurrent[1])
    await client.from().select().throwOnError()
    const renewed = calls.at(-1).token
    assert.ok(claims(renewed).exp > claims(first).exp)
    assert.equal(matchesSecret(renewed, 'secret-a'), true)

    select('https://a.example/database/', 'secret-a-replaced')
    assert.equal(authStore.token.value, undefined)
    await client.from().select().throwOnError()
    assert.equal(matchesSecret(calls.at(-1).token, 'secret-a-replaced'), true)
    const oldBuilder = client.from().select().retry(false).throwOnError()
    select('https://b.example/database', 'secret-b')
    const beforeOld = calls.length
    await assert.rejects(Promise.resolve(oldBuilder), /does not match the selected connection/)
    assert.equal(calls.length, beforeOld)
    await client.from().select().throwOnError()
    assert.equal(calls.at(-1).url.startsWith('https://b.example/database/'), true)
    assert.equal(matchesSecret(calls.at(-1).token, 'secret-b'), true)

    // Signing is asynchronous; neither an old result nor its failure may alter the new cache.
    select('https://a.example/database', 'late-secret-a')
    const releaseA = deferNextSignature()
    const lateA = authStore.newToken()
    select('https://b.example/database', 'current-secret-b')
    const signedB = await authStore.newToken()
    releaseA()
    await assert.rejects(lateA, /Failed to sign a new token/)
    assert.equal(authStore.token.value, signedB)
    assert.equal(matchesSecret(signedB, 'current-secret-b'), true)

    // A switch while the actual fetch authorizer is awaiting a signature must never reach I/O.
    select('https://a.example/database', 'request-secret-a')
    const signingRequest = rawPostgrestFetch('/rpc/read')
    select('https://b.example/database', 'request-secret-b')
    const beforeSigning = calls.length
    await assert.rejects(signingRequest, /Failed to sign a new token|connection changed/)
    assert.equal(calls.length, beforeSigning)
    await rawPostgrestFetch('/rpc/read')
    assert.equal(matchesSecret(calls.at(-1).token, 'request-secret-b'), true)

    // Origin and path boundaries prevent same-host/different-port and prefix confusion.
    for (const baseUrl of [
      'https://b.example/databases',
      'https://b.example:444/database',
      'https://other.example/database',
    ]) {
      await assert.rejects(rawPostgrestFetch('/rpc/read', { baseUrl }), /does not match/)
    }
    await assert.rejects(rawPostgrestFetch('https://other.example/rpc/read'), /does not match/)
    select('https://B.EXAMPLE:443/database/', 'normalized-secret')
    await rawPostgrestFetch('/rpc/read', { baseUrl: 'https://b.example/database' })
    assert.equal(matchesSecret(calls.at(-1).token, 'normalized-secret'), true)

    const providerCalls = []
    const provider = async function (...args) {
      providerCalls.push({ args, receiver: this })
      return 'explicit-token'
    }
    const explicit = new DBAPIClient(
      'blocks',
      undefined,
      'inkcre',
      'https://explicit.example',
      provider
    )
    await explicit.from().select().throwOnError()
    await rawPostgrestFetch('/rpc/read', {
      baseUrl: 'https://explicit.example',
      tokenProvider: provider,
    })
    assert.equal(calls.at(-1).token, 'explicit-token')
    assert.deepEqual(providerCalls, [
      { args: [], receiver: undefined },
      { args: [], receiver: undefined },
    ])

    // Requests already handed to the transport retain their original matching URL/token pair.
    let markStarted
    const started = new Promise((resolve) => {
      markStarted = resolve
    })
    let finish
    const finishRequest = new Promise((resolve) => {
      finish = resolve
    })
    const inFlight = rawPostgrestFetch('/rpc/read', {
      fetch: async (input, init) => {
        const sentToken = new Headers(init.headers).get('Authorization').slice(7)
        assert.equal(matchesSecret(sentToken, 'normalized-secret'), true)
        assert.equal(new URL(input).origin, 'https://b.example')
        markStarted()
        await finishRequest
        return Response.json([])
      },
    })
    await Promise.race([
      started,
      inFlight.then(() => {
        throw new Error('Request completed before reaching the transport.')
      }),
    ])
    select('https://c.example/database', 'secret-c')
    finish()
    await inFlight
    now += 1000
    const refreshed = await authStore.refreshToken()
    assert.equal(authStore.token.value, refreshed)
    assert.equal(matchesSecret(refreshed, 'secret-c'), true)
    select('', 'secret-only')
    assert.equal(matchesSecret(await authStore.newToken(), 'secret-only'), true)
    select('', '')
    await assert.rejects(rawPostgrestFetch('/rpc/read'), /not configured/)
    await assert.rejects(authStore.getToken(), /Failed to sign a new token/)
    assert.equal(authStore.token.value, undefined)
  } finally {
    Date.now = originalNow
    globalThis.fetch = originalFetch
    Object.assign(configStore.metaConfig, originalConfig)
    await dispose()
  }
})
