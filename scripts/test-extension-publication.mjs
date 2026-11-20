import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  captureCandidates,
  selectSavedCandidate,
  stageCandidates,
  verifyHostedCandidates,
} from './publish-first-party-extensions.mjs'
import { ARCHIVE_NAME } from './prepare-repository-extension.mjs'

void test('a rerun cannot replace a missing or expired release candidate', () => {
  const candidate = { id: 42, name: 'first-party-extension-candidate', expired: false }
  const unrelated = { id: 43, name: 'other-artifact', expired: false }
  assert.equal(selectSavedCandidate([unrelated], '1'), undefined)
  assert.equal(selectSavedCandidate([unrelated, candidate], '2'), candidate)
  assert.throws(() => selectSavedCandidate([unrelated], '2'), /missing on a rerun/)
  assert.throws(() => selectSavedCandidate([{ ...candidate, expired: true }], '2'), /expired/)
  assert.throws(() => selectSavedCandidate([candidate, candidate], '2'), /multiple/)
  assert.throws(() => selectSavedCandidate([], undefined), /current GitHub run attempt/)
})

void test('a new Pages deployment keeps historical Releases and uses the saved candidate bytes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'inkcre-publication-test-'))
  const siteDirectory = path.join(workspace, 'site')
  const extension = path.join(workspace, 'extensions/mail')
  const build = path.join(extension, 'dist/web')
  const writeJson = (file, object) => writeFile(file, JSON.stringify(object))

  const server = createServer(async (request, response) => {
    const file = path.join(siteDirectory, request.url)
    try {
      const bytes = await readFile(file)
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader(
        'Content-Type',
        file.endsWith('.json') ? 'application/json' : 'text/javascript'
      )
      response.end(bytes)
    } catch {
      response.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  try {
    const pagesBase = 'http://127.0.0.1:' + server.address().port + '/'
    const core = path.join(workspace, 'packages/core')
    await mkdir(core, { recursive: true })
    await writeJson(path.join(core, 'package.json'), { version: '0.4.3' })
    await mkdir(path.join(build, '.vite'), { recursive: true })
    await writeFile(path.join(build, '.vite/manifest.json'), 'unused Vite build metadata')
    await writeJson(path.join(build, 'mf-manifest.json'), {
      metaData: { publicPath: './', remoteEntry: { name: 'remoteEntry.js' } },
      shared: [{ name: '@inkcre/core', requiredVersion: '^0.4.0' }],
      exposes: [],
    })
    const packageVersion = (version) =>
      writeJson(path.join(extension, 'package.json'), {
        name: '@inkcre/ext-mail',
        version,
        inkcre: {
          name: 'inkcre/mail',
          nickname: 'Mail',
          module_federation: { host_sdk: '@inkcre/core', host_sdk_version: '^0.4.0' },
        },
      })

    const previousDirectory = path.join(workspace, 'previous')
    await packageVersion('0.4.0')
    await writeFile(path.join(build, 'remoteEntry.js'), 'export default "previous"')
    const previous = await captureCandidates({
      workspace,
      pagesBase,
      provenance: { source_revision: 'first-commit', run_id: 'first-run' },
      deliveryDirectory: previousDirectory,
      previousVersion: () => '0.3.0',
    })

    await packageVersion('0.4.1')
    await writeFile(path.join(build, 'remoteEntry.js'), 'export default "current"')
    const options = {
      workspace,
      pagesBase,
      provenance: { source_revision: 'second-commit', run_id: 'second-run' },
      deliveryDirectory: path.join(workspace, 'current'),
      siteDirectory,
    }
    const current = await captureCandidates({ ...options, previousVersion: () => '0.4.0' })
    const candidate = current.candidates[0]
    const releaseMetadata = JSON.parse(candidate.body.split('\n')[1])
    assert.equal(
      releaseMetadata.manifest_url,
      pagesBase + 'extensions/inkcre/mail/0.4.1/mf-manifest.json'
    )
    assert.equal(releaseMetadata.source_path, 'extensions/mail')
    const archive = path.join(options.deliveryDirectory, 'mail', ARCHIVE_NAME)
    const historicalTag = 'inkcre-ext/inkcre/mail/module_federation/v0.4.0'
    const releases = [
      { tag_name: 'web-v0.4.0', assets: [] },
      { tag_name: 'inkcre-ext/inkcre/mail/module_federation/v0.4.2', draft: true, assets: [] },
      {
        tag_name: historicalTag,
        draft: false,
        assets: [{ name: ARCHIVE_NAME, digest: previous.candidates[0].digest }],
      },
    ]
    const download = async (tag, destination) => {
      assert.equal(tag, historicalTag)
      await cp(path.join(previousDirectory, 'mail', ARCHIVE_NAME), destination)
    }
    await writeFile(path.join(build, 'remoteEntry.js'), 'export default "changed after capture"')
    assert.deepEqual(await stageCandidates({ ...options, releases, download }), current)
    assert.equal(
      await readFile(
        path.join(siteDirectory, 'extensions/inkcre/mail/0.4.0/remoteEntry.js'),
        'utf8'
      ),
      'export default "previous"'
    )
    assert.equal(
      await readFile(
        path.join(siteDirectory, 'extensions/inkcre/mail/0.4.1/remoteEntry.js'),
        'utf8'
      ),
      'export default "current"'
    )
    await assert.rejects(
      readFile(path.join(siteDirectory, 'extensions/inkcre/mail/0.4.1/.vite/manifest.json')),
      { code: 'ENOENT' }
    )
    await verifyHostedCandidates(current, siteDirectory)
    await assert.rejects(
      verifyHostedCandidates(current, siteDirectory, (url, request) =>
        url.pathname.endsWith('/remoteEntry.js')
          ? new Response('wrong', {
              headers: {
                'access-control-allow-origin': '*',
                'content-type': 'text/javascript',
              },
            })
          : fetch(url, request)
      ),
      /Pages bytes differ/
    )
    await writeFile(archive, 'incorrect archive')
    await assert.rejects(
      stageCandidates({ ...options, releases, download }),
      /saved ZIP digest differs/
    )
  } finally {
    server.close()
    await rm(workspace, { recursive: true, force: true })
  }
})
