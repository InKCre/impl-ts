import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertDraft, createDraftRelease, preparedVersion } from '../webext-release.mjs'

void test('only a prepared numeric WebExt version is selected, independently of other units', () => {
  assert.equal(preparedVersion('0.2.0', '# WebExt\n\n## 0.2.0\nNews', false), true)
  assert.equal(preparedVersion('0.2.0', '## 0.2.0', true), false)
  assert.equal(preparedVersion('0.1.3', '', false), false)
  assert.equal(preparedVersion('0.2.0', '## 0.2.01', false), false)
  for (const invalid of ['0.2.0-beta.2', '0.02.0']) {
    assert.throws(() => preparedVersion(invalid, `## ${invalid}`, false), /numeric browser version/)
  }
  assert.throws(() => preparedVersion('0.0.0', '## 0.0.0', false), /all zero/)
  assert.throws(() => preparedVersion('0.2.65536', '', false), /exceeds 65535/)
})

void test('draft recovery cannot overwrite a public version or another source', () => {
  const source = 'a'.repeat(40)
  const draft = { tag_name: 'webext-v0.2.0', target_commitish: source, draft: true }
  assert.throws(
    () => assertDraft({ ...draft, draft: false }, draft.tag_name, source),
    /never overwritten/
  )
  assert.throws(() => assertDraft(draft, draft.tag_name, 'b'.repeat(40)), /another source/)
  assert.throws(() => assertDraft(undefined, draft.tag_name, source), /draft release was not found/)
})

void test('creating a WebExt draft sends its source and release notes and returns its GitHub identity', async (t) => {
  const source = 'a'.repeat(40)
  const draft = { id: 42, tag_name: 'webext-v0.2.0', target_commitish: source, draft: true }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/InKCre/impl-ts/releases')
    assert.equal(options.method, 'POST')
    const request = JSON.parse(options.body)
    assert.equal(request.tag_name, draft.tag_name)
    assert.equal(request.target_commitish, source)
    assert.equal(request.draft, true)
    assert.match(request.body, /发布说明/)
    return Response.json(draft, { status: 201 })
  })
  assert.deepEqual(
    await createDraftRelease({ tag: draft.tag_name, source, version: '0.2.0', news: '发布说明' }),
    draft
  )
})
