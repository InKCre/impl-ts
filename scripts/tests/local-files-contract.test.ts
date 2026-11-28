import assert from 'node:assert/strict'
import test from 'node:test'
import { fileMetadata, peerFileLocation } from '../../extensions/local-files/src/schema.ts'

void test('Peer file location preserves Unicode and reserved path characters', () => {
  const result = peerFileLocation(
    'inkcre-peer-file://a143b185-f43d-47d1-8ef7-1d3857284b01/Users/a/%E4%B8%AD%E6%96%87%20%23%3F.md'
  )
  assert.deepEqual(result, {
    peer: 'a143b185-f43d-47d1-8ef7-1d3857284b01',
    path: '/Users/a/中文 #?.md',
  })
  for (const invalid of [
    'https://a143b185-f43d-47d1-8ef7-1d3857284b01/a',
    'inkcre-peer-file://a143b185-f43d-47d1-8ef7-1d3857284b01/a#',
  ]) {
    assert.throws(() => peerFileLocation(invalid), /原件位置格式无效/)
  }
  assert.throws(
    () => peerFileLocation('inkcre-peer-file://bad-peer/a'),
    (error) =>
      error instanceof Error && error.name === 'ZodError' && error.message.includes('Invalid UUID')
  )
})

void test('File metadata represents an unavailable original and extraction issue alongside the last successful revision', () => {
  const metadata = fileMetadata.parse({
    location: 'inkcre-peer-file://a143b185-f43d-47d1-8ef7-1d3857284b01/Users/a/report.docx',
    format: 'docx',
    available: false,
    observed_at: '2026-10-23T06:00:00Z',
    revision: {
      sha256: 'a'.repeat(64),
      extractor: 'mac-native-text.v1',
      extracted_at: '2026-10-22T06:00:00Z',
      scope: 'main_document',
    },
    issue: '当前原件无法读取',
  })
  assert.equal(metadata.available, false)
  assert.equal(metadata.revision?.scope, 'main_document')
  assert.equal(metadata.revision?.extracted_at, '2026-10-22T06:00:00Z')
  const invalid = fileMetadata.safeParse({ ...metadata, format: 'executable' })
  assert.equal(invalid.success, false)
  if (!invalid.success)
    assert.deepEqual(
      invalid.error.issues.map((issue) => issue.path),
      [['format']]
    )
})
