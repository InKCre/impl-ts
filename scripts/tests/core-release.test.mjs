import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  inspectCoreRelease,
  resolveConfiguredCoreRelease,
  validateCoreReleaseConfig,
} from '../core-release-lib.mjs'

const source = 'a'.repeat(40)
const image = `ghcr.io/inkcre/impl-py@sha256:${'b'.repeat(64)}`
const revision = 'extension-peer-participation-v2'
const config = {
  format: 1,
  repository: 'InKCre/impl-py',
  stable_image: 'ghcr.io/inkcre/impl-py:stable',
  runtime_images: {
    pgvector: `pgvector/pgvector:pg17@sha256:${'1'.repeat(64)}`,
    postgrest: `postgrest/postgrest@sha256:${'2'.repeat(64)}`,
  },
  canonical_candidate: { image, source_revision: source, contract_revision: revision },
}
const artifact = (path) => ({ path, sha256: 'c'.repeat(64), size: 1 })
function dockerFor(sourceRevision = source, contractRevision = revision) {
  return (args) => {
    if (args[0] === 'pull') return ''
    if (args.includes('schema'))
      return JSON.stringify({
        format: 1,
        source_revision: sourceRevision,
        contract_revision: contractRevision,
        schema: artifact('/app/database-contract/database-schema.sql'),
        roles: artifact('/app/database-contract/database-roles.sql'),
        runtime_contract: artifact('/app/database-contract/runtime-contract.json'),
      })
    return JSON.stringify({
      format: 1,
      revision: contractRevision,
      source_revision: sourceRevision,
      protocol: { schema: 'inkcre' },
      jwt: { algorithm: 'HS256', role: 'authenticated' },
    })
  }
}

void test('consumer admission rejects unknown candidate origin, source and contract', () => {
  assert.equal(resolveConfiguredCoreRelease(dockerFor(), config).image, image)
  assert.throws(
    () => resolveConfiguredCoreRelease(dockerFor('d'.repeat(40)), config),
    /source or database contract/
  )
  assert.throws(
    () => resolveConfiguredCoreRelease(dockerFor(source, 'old-contract'), config),
    /source or database contract/
  )
  for (const invalid of [
    'ghcr.io/inkcre/impl-py:preview',
    image.replace('ghcr.io', 'other.example'),
    `sha256:${'b'.repeat(64)}`,
  ]) {
    assert.throws(
      () =>
        validateCoreReleaseConfig({
          ...config,
          canonical_candidate: { ...config.canonical_candidate, image: invalid },
        }),
      /requires a published repository digest/
    )
  }
})

void test('runtime containers require a full immutable image digest', () => {
  for (const [name, image] of [
    ['pgvector', 'pgvector/pgvector:pg17@sha256:1'],
    ['postgrest', 'postgrest/postgrest:latest'],
  ]) {
    assert.throws(
      () =>
        validateCoreReleaseConfig({
          ...config,
          runtime_images: { ...config.runtime_images, [name]: image },
        }),
      new RegExp(`${name} runtime image must be digest-pinned`)
    )
  }
})

const imageId = `sha256:${'a'.repeat(64)}`

void test('explicit local inspection reads all artifacts from the same existing image', () => {
  const readArtifacts = dockerFor()
  const runDocker = (args) => {
    if (args[0] === 'image') {
      assert.ok(args.includes(imageId))
      return imageId
    }
    assert.equal(args[0], 'run', 'local image inspection must not pull a tag')
    assert.equal(args[2], imageId)
    return readArtifacts(args)
  }
  const release = inspectCoreRelease(runDocker, imageId, { allowLocalImage: true })
  assert.equal(release.image, imageId)
  assert.equal(release.runtime_contract.revision, revision)
})

void test('local inspection requires explicit admission, the exact image and its schema manifest', () => {
  const unexpectedDocker = () => assert.fail('invalid identity must fail before Docker')
  assert.throws(() => inspectCoreRelease(unexpectedDocker, imageId), /digest-pinned/)
  assert.throws(
    () => inspectCoreRelease(unexpectedDocker, 'candidate:latest', { allowLocalImage: true }),
    /digest-pinned/
  )
  assert.throws(
    () => inspectCoreRelease(() => 'sha256:other', imageId, { allowLocalImage: true }),
    /identity does not match/
  )
  assert.throws(
    () =>
      inspectCoreRelease((args) => (args[0] === 'image' ? imageId : '{}'), imageId, {
        allowLocalImage: true,
      }),
    /schema manifest identity is invalid/
  )
})
