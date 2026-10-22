import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const stableImagePattern = /^ghcr\.io\/inkcre\/impl-py:stable$/
const digestPattern = /^ghcr\.io\/inkcre\/impl-py@sha256:[0-9a-f]{64}$/
const localImageIdPattern = /^sha256:[0-9a-f]{64}$/
const sourceRevisionPattern = /^[0-9a-f]{40}$/
const sha256Pattern = /^[0-9a-f]{64}$/

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export function validateCoreReleaseConfig(config) {
  if (
    config?.format !== 1 ||
    config.repository !== 'InKCre/impl-py' ||
    !stableImagePattern.test(config.stable_image)
  ) {
    throw new Error('core release config must select InKCre/impl-py stable')
  }
  if (config.canonical_candidate !== undefined) {
    const candidate = config.canonical_candidate
    if (
      !candidate ||
      !digestPattern.test(candidate.image) ||
      !sourceRevisionPattern.test(candidate.source_revision) ||
      typeof candidate.contract_revision !== 'string' ||
      !candidate.contract_revision
    ) {
      throw new Error(
        'canonical Core candidate requires a published repository digest, exact source SHA and database contract revision'
      )
    }
    if (
      Object.keys(candidate).some(
        (key) => !['image', 'source_revision', 'contract_revision'].includes(key)
      )
    ) {
      throw new Error('canonical Core candidate contains unsupported fields')
    }
  }
  for (const name of ['pgvector', 'postgrest']) {
    const image = config.runtime_images?.[name]
    if (typeof image !== 'string' || !image.includes('@sha256:')) {
      throw new Error(`${name} runtime image must be digest-pinned`)
    }
  }
  return config
}

function validateArtifactEntry(entry, expectedPath, label) {
  if (
    !entry ||
    entry.path !== expectedPath ||
    !sha256Pattern.test(entry.sha256) ||
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0
  ) {
    throw new Error(`core ${label} artifact metadata is invalid`)
  }
}

export function validateSchemaManifest(manifest) {
  if (
    manifest?.format !== 1 ||
    typeof manifest.contract_revision !== 'string' ||
    manifest.contract_revision.length === 0 ||
    !sourceRevisionPattern.test(manifest.source_revision)
  ) {
    throw new Error('core schema manifest identity is invalid')
  }
  validateArtifactEntry(manifest.schema, '/app/database-contract/database-schema.sql', 'schema')
  validateArtifactEntry(manifest.roles, '/app/database-contract/database-roles.sql', 'role')
  validateArtifactEntry(
    manifest.runtime_contract,
    '/app/database-contract/runtime-contract.json',
    'runtime contract'
  )
  return manifest
}

export function validateRuntimeContract(contract, manifest) {
  if (
    contract?.format !== 1 ||
    contract.revision !== manifest.contract_revision ||
    contract.source_revision !== manifest.source_revision ||
    contract.protocol?.schema !== 'inkcre' ||
    typeof contract.jwt?.algorithm !== 'string' ||
    typeof contract.jwt?.role !== 'string'
  ) {
    throw new Error('core runtime contract does not match its schema manifest')
  }
  return contract
}

/**
 * Project the image-owned runtime document into the compatibility facts consumed
 * by browser peers. Image provenance remains execution evidence, not a checked-in
 * client interface.
 */
export function projectDatabaseCompatibilityContract(contract) {
  const compatibility = {
    format: contract?.format,
    revision: contract?.revision,
    protocol: {
      format: contract?.protocol?.format,
      schema: contract?.protocol?.schema,
    },
    jwt: contract?.jwt,
  }
  const validFormat = Number.isInteger(compatibility.format)
  const validRevision = typeof compatibility.revision === 'string' && compatibility.revision
  const validProtocol =
    Number.isInteger(compatibility.protocol.format) &&
    typeof compatibility.protocol.schema === 'string' &&
    compatibility.protocol.schema
  const validJwt =
    compatibility.jwt &&
    typeof compatibility.jwt.algorithm === 'string' &&
    typeof compatibility.jwt.role === 'string' &&
    typeof compatibility.jwt.issuer === 'string' &&
    typeof compatibility.jwt.audience === 'string'
  if (!validFormat || !validRevision || !validProtocol || !validJwt) {
    throw new Error('core database compatibility contract is invalid')
  }
  return compatibility
}

export function validateDatabaseCompatibilityContract(contract) {
  const compatibility = projectDatabaseCompatibilityContract(contract)
  const hasExactKeys = (value, expected) => {
    if (!value || typeof value !== 'object') return false
    const keys = Object.keys(value)
    return keys.length === expected.length && expected.every((key) => keys.includes(key))
  }
  const hasExpectedFields = hasExactKeys(contract, ['format', 'revision', 'protocol', 'jwt'])
  const hasExpectedProtocol = hasExactKeys(contract.protocol, ['format', 'schema'])
  if (!hasExpectedFields || !hasExpectedProtocol) {
    throw new Error('database compatibility contract contains non-client fields')
  }
  return compatibility
}

export function selectImmutableDigest(repoDigests) {
  const canonicalDigests = [
    ...new Set(repoDigests.filter((candidate) => digestPattern.test(candidate))),
  ]
  if (canonicalDigests.length !== 1) {
    throw new Error('stable core image did not resolve to one canonical digest')
  }
  return canonicalDigests[0]
}

export function localDocker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 180_000,
  }).trim()
}

/** A reviewed canonical candidate can advance consumer admission without moving stable. */
export function resolveConfiguredCoreRelease(runDocker, config) {
  validateCoreReleaseConfig(config)
  const candidate = config.canonical_candidate
  if (!candidate) return resolveCoreRelease(runDocker, config.stable_image)
  runDocker(['pull', candidate.image], { timeout: 300_000 })
  const release = inspectCoreRelease(runDocker, candidate.image)
  if (
    release.manifest.source_revision !== candidate.source_revision ||
    release.manifest.contract_revision !== candidate.contract_revision
  ) {
    throw new Error(
      'canonical Core candidate source or database contract does not match its admission'
    )
  }
  return release
}

export function resolveCoreRelease(runDocker, stableImage) {
  if (!stableImagePattern.test(stableImage)) {
    throw new Error(`unexpected core stable image: ${stableImage}`)
  }
  runDocker(['pull', stableImage], { timeout: 300_000 })
  const repoDigests = JSON.parse(
    runDocker(['inspect', '--format={{json .RepoDigests}}', stableImage])
  )
  const image = selectImmutableDigest(repoDigests)
  return inspectCoreRelease(runDocker, image)
}

export function inspectCoreRelease(runDocker, image, { allowLocalImage = false } = {}) {
  const localImage = allowLocalImage && localImageIdPattern.test(image)
  if (!digestPattern.test(image) && !localImage) {
    throw new Error(`core release must be digest-pinned: ${image}`)
  }
  if (localImage) {
    const actualId = runDocker(['image', 'inspect', '--format={{.Id}}', image]).trim()
    if (actualId !== image) throw new Error('local Core image identity does not match')
  }
  const manifest = validateSchemaManifest(
    JSON.parse(
      runDocker(['run', '--rm', image, 'python', 'scripts/container.py', 'db', 'schema', '--json'])
    )
  )
  const runtimeContract = validateRuntimeContract(
    JSON.parse(
      runDocker(['run', '--rm', image, 'cat', '/app/database-contract/runtime-contract.json'])
    ),
    manifest
  )
  return { image, manifest, runtime_contract: runtimeContract }
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function verifyArtifact(content, metadata, label) {
  if (content.length !== metadata.size || sha256(content) !== metadata.sha256) {
    throw new Error(`core ${label} artifact does not match its manifest`)
  }
}
