import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { main, savedCandidate, validateRecoveryRun } from './publish-core-sdk.mjs'

void test('partial reruns require the original unexpired SDK candidate', () => {
  assert.equal(savedCandidate([], '1'), undefined)
  assert.throws(() => savedCandidate([], '1', true), /original workflow candidate/)
  assert.throws(() => savedCandidate([], '2'), /Missing SDK candidate/)
  assert.throws(
    () => savedCandidate([{ name: 'core-sdk-candidate', expired: true }], '2'),
    /expired/
  )
  const original = { name: 'core-sdk-candidate', id: 23, expired: false }
  assert.equal(savedCandidate([original], '2').id, original.id)
})

void test('SDK publication recovers the saved candidate and verifies the public release', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inkcre-sdk-publish-test-'))
  const cwd = process.cwd()
  const originalPath = process.env.PATH
  const originalSource = process.env.SOURCE_REVISION
  const originalSummary = process.env.GITHUB_STEP_SUMMARY
  const source = 'c'.repeat(40)
  const bytes = Buffer.from('saved SDK package')
  const receipt = {
    name: '@inkcre/core',
    version: '0.4.0',
    source_revision: source,
    asset: 'inkcre-core-0.4.0.tgz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const draft = {
    id: 12,
    tag_name: 'core-v0.4.0',
    target_commitish: source,
    draft: true,
    assets: [
      {
        name: receipt.asset,
        url: `https://private.test/${receipt.asset}`,
        browser_download_url: `https://public.test/${receipt.asset}`,
      },
    ],
  }
  const remote = (name) => `remote-assets/${name}`
  const release = async () => JSON.parse(await readFile('release.json', 'utf8'))
  try {
    process.chdir(root)
    process.env.PATH = `${root}:${originalPath}`
    process.env.SOURCE_REVISION = source
    delete process.env.GITHUB_STEP_SUMMARY
    await mkdir('packages/core', { recursive: true })
    await mkdir('.core-sdk-delivery')
    await mkdir('remote-assets')
    await writeFile('packages/core/package.json', JSON.stringify({ version: '0.5.0' }))
    await writeFile('.core-sdk-delivery/source.json', JSON.stringify(receipt))
    await writeFile(`.core-sdk-delivery/${receipt.asset}`, bytes)
    await writeFile('release.json', JSON.stringify(draft))
    await writeFile(remote(receipt.asset), bytes)
    // The fake GitHub writer persists only what gh actually uploads; duplicate uploads are refused.
    await writeFile(
      'gh',
      `#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const [, route, ...args] = process.argv.slice(2)
assert.ok(!fs.existsSync('read-only'), 'published release must not be written again')
const method = args[args.indexOf('--method') + 1]
let release
let response
if (method === 'POST' && route.endsWith('/releases')) {
  const field = (name) => args.find((arg) => arg.startsWith(name + '=')).slice(name.length + 1)
  release = { id: 12, tag_name: field('tag_name'), target_commitish: field('target_commitish'), draft: field('draft') === 'true', assets: [] }
  response = release
} else {
  release = JSON.parse(fs.readFileSync('release.json'))
  if (method === 'POST' && route.startsWith('https://uploads.github.com/')) {
    const url = new URL(route)
    assert.ok(url.pathname.endsWith('/releases/12/assets'))
    const name = url.searchParams.get('name')
    fs.writeFileSync('remote-assets/' + name, fs.readFileSync(args[args.indexOf('--input') + 1]), { flag: 'wx' })
    response = { name, url: 'https://private.test/' + name, browser_download_url: 'https://public.test/' + name }
    release.assets.push(response)
  } else {
    assert.equal(method, 'PATCH')
    assert.ok(route.endsWith('/releases/12') && args.includes('draft=false'))
    release.draft = fs.existsSync('hold-draft')
    response = release
  }
}
fs.writeFileSync('release.json', JSON.stringify(release))
process.stdout.write(JSON.stringify(response))
`
    )
    await chmod('gh', 0o700)
    let tag = source
    let visible = true
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const { hostname, pathname } = new URL(url)
      if (hostname === 'private.test' || hostname === 'public.test') {
        if (!(await release()).draft) {
          assert.equal(hostname, 'public.test', 'published assets must be anonymously readable')
          assert.equal(options.headers.Authorization, undefined)
        }
        return new Response(await readFile(remote(path.basename(pathname))))
      }
      if (pathname.endsWith('/git/ref/tags/core-v0.4.0'))
        return Response.json({ object: { type: 'commit', sha: tag } })
      assert.ok(pathname.endsWith('/releases'), `unexpected GitHub request: ${pathname}`)
      return Response.json(visible ? [await release()] : [])
    })

    await writeFile('hold-draft', '')
    await assert.rejects(main('publish'), /not public/)
    await rm('hold-draft')
    await main('publish')
    assert.equal((await release()).draft, false)
    assert.deepEqual(JSON.parse(await readFile(remote('source.json'), 'utf8')), receipt)

    await writeFile('read-only', '')
    await main('publish')
    await writeFile(remote(receipt.asset), 'changed archive')
    await assert.rejects(main('publish'), /bytes differ/)
    await writeFile(remote(receipt.asset), bytes)
    tag = 'b'.repeat(40)
    await assert.rejects(main('publish'), /tag must match the candidate source/)
    tag = source
    await writeFile(
      remote('source.json'),
      JSON.stringify({ ...receipt, source_revision: 'd'.repeat(40) })
    )
    await assert.rejects(main('publish'), /other bytes\/source/)

    // A fresh draft must complete using its creation response while the list still omits it.
    for (const file of ['release.json', 'read-only', remote(receipt.asset), remote('source.json')])
      await rm(file)
    visible = false
    await main('publish')
    assert.equal(
      (await release()).tag_name,
      'core-v0.4.0',
      'recovery uses the saved payload version'
    )
    assert.deepEqual(await readFile(remote(receipt.asset)), bytes)
    assert.equal((await release()).draft, false)
  } finally {
    process.chdir(cwd)
    process.env.PATH = originalPath
    if (originalSource === undefined) delete process.env.SOURCE_REVISION
    else process.env.SOURCE_REVISION = originalSource
    if (originalSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
    else process.env.GITHUB_STEP_SUMMARY = originalSummary
    await rm(root, { recursive: true, force: true })
  }
})

void test('recovery accepts only the same completed workflow from protected main history', () => {
  const run = {
    event: 'push',
    head_branch: 'main',
    path: '.github/workflows/core-sdk-release.yml',
    status: 'completed',
    head_sha: 'a'.repeat(40),
  }
  assert.equal(validateRecoveryRun(run, { status: 'ahead' }), run.head_sha)
  for (const [field, error] of [
    ['event', /admitted main push/],
    ['head_branch', /source branch must be main/],
    ['path', /original SDK release workflow/],
    ['status', /must have completed/],
    ['head_sha', /source revision must be a full commit SHA/],
  ]) {
    assert.throws(
      () => validateRecoveryRun({ ...run, [field]: 'invalid' }, { status: 'ahead' }),
      error
    )
  }
  assert.throws(() => validateRecoveryRun(run, { status: 'diverged' }), /main history/)
})
