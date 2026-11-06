import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateDevelopmentContract } from '../database-contract-source.mjs'

const descriptor = {
  profile: 'development',
  owner_repository: 'InKCre/impl-py',
  contract_revision: 'source-batch-persistence-v1',
  migration_head: 'batch-head',
}
const contract = {
  format: 1,
  revision: descriptor.contract_revision,
  migration_heads: ['batch-head'],
  protocol: { format: 1, schema: 'inkcre' },
  jwt: { algorithm: 'HS256', role: 'authenticated', issuer: 'inkcre-peer', audience: 'inkcre-api' },
}

void test('local type generation projects the matching owner contract without release provenance', () => {
  assert.deepEqual(validateDevelopmentContract(descriptor, contract), {
    format: 1,
    revision: descriptor.contract_revision,
    protocol: contract.protocol,
    jwt: contract.jwt,
  })
})

void test('local type generation rejects mismatched owner state and source contracts', () => {
  for (const change of [
    { profile: 'production' },
    { owner_repository: 'other' },
    { converging: true },
    { contract_revision: 'old-revision' },
    { migration_head: 'old-head' },
  ]) {
    assert.throws(() => validateDevelopmentContract({ ...descriptor, ...change }, contract))
  }
})
