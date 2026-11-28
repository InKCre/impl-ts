import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ICAL from 'ical.js'
import {
  composeGraph,
  propertyLinkSchema,
  resourceUid,
  type GraphProperty,
} from '../../src/graph-content.ts'
import { parseResource } from '../../src/content.ts'

const samples = JSON.parse(
  readFileSync(new URL('./fixtures/semantic-graph.json', import.meta.url), 'utf8')
)
function properties(sample: (typeof samples)[number]): GraphProperty[] {
  return sample.properties.map((field: any) => ({
    id: field.id,
    link: propertyLinkSchema.parse(field.link),
    value: field.binary ? new Uint8Array(Buffer.from(field.value, 'base64')) : field.value,
  }))
}

void test('Python-authored contact graph preserves phones, photo and subsequent phone edits', () => {
  const sample = samples.find((item: any) => item.kind === 'contact')
  const text = composeGraph(sample.remainder, properties(sample))
  const actual = parseResource(JSON.stringify({ href: 'contact.vcf', text }), 'contact')
  assert.equal(actual.kind, 'contact')
  if (actual.kind !== 'contact') return
  assert.equal(actual.title, 'InKCre Preview Photo Contact')
  assert.deepEqual(actual.fields, [
    {
      name: 'tel',
      values: [
        { value: '+8613800000000', label: 'cell' },
        { value: '+8613900000000', label: 'work' },
      ],
    },
    { name: 'email', values: [{ value: 'preview146@example.invalid', label: '' }] },
    { name: 'note', values: [{ value: 'PR 146 HTTPS acceptance test', label: '' }] },
  ])
  const photoBytes = sample.properties.find((field: any) => field.link.name === 'PHOTO').value
  assert.equal(actual.photo, `data:image/jpeg;base64,${photoBytes}`)
  assert.equal(resourceUid(text), 'inkcre-preview146-contact')
  const changed = properties(sample)
  changed.find((field) => field.link.name === 'TEL')!.value = '+8613800000001'
  assert.match(composeGraph(sample.remainder, changed), /\+8613800000001/)
})

void test('component identity retains TZID exceptions and audio-alarm attachments', () => {
  const sample = samples.find((item: any) => item.kind === 'calendar')
  const text = composeGraph(sample.remainder, properties(sample))
  const actual = parseResource(JSON.stringify({ href: 'event.ics', text }), 'calendar')
  const expected = parseResource(
    JSON.stringify({ href: 'event.ics', text: sample.text }),
    'calendar'
  )
  assert.notEqual(actual.kind, 'invalid')
  if (actual.kind !== 'calendar' || expected.kind !== 'calendar') return
  assert.deepEqual(actual.items, expected.items)
  const root = new ICAL.Component(ICAL.parse(text))
  const attachment = root
    .getFirstSubcomponent('vevent')!
    .getFirstSubcomponent('valarm')!
    .getFirstProperty('attach')!
    .getFirstValue()
  assert.ok(attachment instanceof ICAL.Binary)
  assert.equal(attachment.decodeValue(), 'hello')
  assert.match(text, /X-UNKNOWN;X-KEEP=yes:保留/)
})

void test('duplicate authority and missing components fail instead of showing stale native values', () => {
  const sample = samples.find((item: any) => item.kind === 'contact')
  assert.throws(
    () => composeGraph(sample.text, properties(sample)),
    /both native and graph authority/
  )
  const props = properties(sample)
  props[0]!.link.component = ['VEVENT', 'missing', '']
  assert.throws(() => composeGraph(sample.remainder, props), /missing or ambiguous/)
})
