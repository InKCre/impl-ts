import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { minVersion, satisfies } from 'semver'
import { pendingCoreVersion } from './sdk-compatibility.mjs'
import { prepareSdkCandidate } from './prepare-sdk-candidate.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const current = JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8'))
const planned = await pendingCoreVersion(root)
const cache = path.join(root, '.runtime/sdk-minimum')
await mkdir(cache, { recursive: true })
const temporary = await mkdtemp(path.join(os.tmpdir(), 'inkcre-sdk-minimum-'))
const run = (args, cwd = root) => execFileSync('pnpm', args, { cwd, stdio: 'inherit' })
const versions = new Map()
let candidateDirectory

async function sdk(version) {
  if (versions.has(version)) return versions.get(version)
  const directory = path.join(cache, version)
  // Never let files removed by a newer artifact survive a repeated compatibility check.
  await rm(directory, { recursive: true, force: true })
  if (version === planned && version !== current.version) {
    // Derive the actual release metadata in isolation. Do not mutate or consume PR intent.
    const candidate = path.join(temporary, 'candidate')
    candidateDirectory = candidate
    await prepareSdkCandidate(root, candidate, {
      committedSvc: process.env.INKCRE_CANDIDATE_COMMITTED_SVC === '1',
    })
    run(['--filter', '@inkcre/core', 'build'], candidate)
    const metadata = JSON.parse(
      await readFile(path.join(candidate, 'packages/core/package.json'), 'utf8')
    )
    assert.equal(metadata.version, version)
    await mkdir(directory, { recursive: true })
    await cp(path.join(candidate, 'packages/core/dist'), path.join(directory, 'dist'), {
      recursive: true,
    })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(metadata))
    run(['build'], candidate)
    console.log(
      `[CANDIDATE] Core ${version}: Changesets-derived and built SDK; not a published release`
    )
  } else {
    const origin = `https://github.com/InKCre/impl-ts/releases/download/core-v${version}`
    const receiptResponse = await fetch(`${origin}/source.json`)
    if (receiptResponse.status === 404 && version === current.version) {
      // A Version PR has consumed its intent but its exact SDK is still unpublished.
      // Check that workspace artifact explicitly instead of pretending a release exists.
      await mkdir(directory, { recursive: true })
      await cp(path.join(root, 'packages/core/dist'), path.join(directory, 'dist'), {
        recursive: true,
      })
      await writeFile(path.join(directory, 'package.json'), JSON.stringify(current))
      run(['build'])
      console.log(
        `[CANDIDATE] Core ${version}: current Version PR workspace artifact; not a published release`
      )
    } else {
      assert.ok(receiptResponse.ok, `Core ${version} has no published source receipt`)
      const receipt = await receiptResponse.json()
      assert.equal(receipt.version, version)
      assert.equal(receipt.name, '@inkcre/core')
      const response = await fetch(`${origin}/inkcre-core-${version}.tgz`)
      assert.ok(response.ok, `Core ${version} archive is unavailable`)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256)
      await mkdir(directory, { recursive: true })
      const archive = path.join(temporary, `${version}.tgz`)
      await writeFile(archive, bytes)
      execFileSync('tar', ['xzf', archive, '--strip-components=1', '-C', directory])
      console.log(`[PUBLISHED] Core ${version}: receipt-verified ${receipt.source_revision}`)
    }
  }
  // The SDK's peers/dependencies use the frozen workspace; only the SDK artifact varies.
  await symlink(
    path.join(root, 'packages/core/node_modules'),
    path.join(directory, 'node_modules')
  ).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })
  versions.set(version, directory)
  return directory
}

try {
  for (const name of await readdir(path.join(root, 'extensions'))) {
    const producer = path.join(root, 'extensions', name)
    let metadata
    try {
      metadata = JSON.parse(await readFile(path.join(producer, 'package.json'), 'utf8'))
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue
      throw error
    }
    const range = metadata.inkcre?.module_federation?.host_sdk_version
    if (!range) continue
    const minimum = minVersion(range)?.version
    assert.ok(
      minimum && satisfies(minimum, range),
      `No inclusive SDK lower bound for ${metadata.name}`
    )
    const directory = await sdk(minimum)
    const config = path.join(temporary, `${name}.json`)
    await writeFile(
      config,
      JSON.stringify({
        extends: path.join(producer, 'tsconfig.json'),
        compilerOptions: {
          noEmit: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: [
            path.join(
              path.dirname(
                createRequire(path.join(producer, 'package.json')).resolve('vite/package.json')
              ),
              'client.d.ts'
            ),
          ],
          paths: {
            '@/*': [path.join(root, 'apps/client-web/src/*')],
            '@inkcre/core': [path.join(directory, 'dist/index.d.ts')],
          },
        },
        include: [path.join(producer, 'src/**/*'), path.join(producer, 'src/**/*.vue')],
      })
    )
    run(['exec', 'vue-tsc', '--project', config, '--noEmit'], producer)
    console.log(`[OK] ${metadata.name} compiles against its minimum Core ${minimum}`)
  }
  // The new lifecycle is exercised through the same public artifact used by candidate consumers.
  run(
    [
      'exec',
      'node',
      '--test',
      'scripts/tests/resolver-lifecycle.test.mjs',
      'scripts/tests/extension-peer-management.test.mjs',
    ],
    candidateDirectory ?? root
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
