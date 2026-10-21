import ICAL from 'ical.js'
import { z } from 'zod'

export const propertyPrefix = 'caldav:property:'
export const graphContentSchema = z.object({ href: z.string(), remainder: z.string() }).strict()
export const propertyLinkSchema = z
  .object({
    component: z.tuple([z.string(), z.string(), z.string()]).nullable(),
    alarm: z.number().int().nonnegative().nullable(),
    name: z.string(),
    params: z.record(z.string(), z.array(z.string())),
    group: z.string().nullable(),
    position: z.number().int().nonnegative(),
    representation: z.enum(['text', 'uri', 'binary', 'data-uri', 'reference']),
    media_type: z.string().nullable(),
  })
  .strict()
export type PropertyLink = z.infer<typeof propertyLinkSchema>
export interface GraphProperty {
  id: number
  link: PropertyLink
  value: string | Uint8Array
}

export function resourceUid(text: string): string {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name === 'vcard') return String(root.getFirstPropertyValue('uid') ?? '')
  const uids = new Set(
    root
      .getAllSubcomponents()
      .filter((component) => ['vevent', 'vtodo', 'vjournal'].includes(component.name))
      .map((component) => String(component.getFirstPropertyValue('uid') ?? ''))
  )
  if (uids.size !== 1) throw new Error('DAV calendar must have exactly one UID.')
  return [...uids][0]!
}

function targetComponent(root: ICAL.Component, link: PropertyLink): ICAL.Component {
  if (link.component === null && root.name === 'vcard') return root
  if (link.component === null) throw new Error('Missing DAV component selector.')
  const [name, uid, recurrence] = link.component
  const recurrenceKey = recurrence ? ICAL.Property.fromString(recurrence).toICALString() : ''
  const targets = root
    .getAllSubcomponents()
    .filter(
      (component) =>
        component.name === name.toLowerCase() &&
        component.getFirstPropertyValue('uid') === uid &&
        (component.getFirstProperty('recurrence-id')?.toICALString() ?? '') === recurrenceKey
    )
  if (targets.length !== 1)
    throw new Error('DAV property refers to a missing or ambiguous component.')
  if (link.alarm === null) return targets[0]!
  const alarm = targets[0]!.getAllSubcomponents('valarm')[link.alarm]
  if (!alarm) throw new Error('DAV property refers to a missing alarm.')
  return alarm
}

function base64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

export function composeGraph(remainder: string, properties: GraphProperty[]): string {
  const root = new ICAL.Component(ICAL.parse(remainder))
  const targets = properties.map((field) => targetComponent(root, field.link))
  for (let index = 0; index < properties.length; index++) {
    if (targets[index]!.hasProperty(properties[index]!.link.name.toLowerCase())) {
      throw new Error('DAV property has both native and graph authority.')
    }
  }
  const seen = new Set<string>()
  for (const field of [...properties].sort((a, b) => a.link.position - b.link.position)) {
    const { link } = field
    const key = JSON.stringify([link.component, link.alarm, link.name, link.position])
    if (seen.has(key)) throw new Error('Duplicate DAV property position.')
    seen.add(key)
    const target = targetComponent(root, link)
    const property = new ICAL.Property(link.name.toLowerCase(), target)
    target.addProperty(property)
    for (const [name, values] of Object.entries(link.params)) {
      if (name === 'VALUE') continue
      property.setParameter(name.toLowerCase(), values.length === 1 ? values[0]! : values)
    }
    const valueType = link.params.VALUE?.[0]
    if (valueType) property.resetType(valueType.toLowerCase())
    let value: string
    if (link.representation === 'binary' || link.representation === 'data-uri') {
      if (!(field.value instanceof Uint8Array)) throw new Error('DAV media requires bytes.')
      value = base64(field.value)
      if (link.representation === 'data-uri') {
        value = `data:${link.media_type || 'application/octet-stream'};base64,${value}`
      }
    } else {
      if (typeof field.value !== 'string') throw new Error('DAV text requires a string.')
      value = field.value
    }
    property.setValue(value)
    // vCard groups qualify wire names; the renderer reads the unqualified semantic property.
    if (link.group) property.jCal[0] = `${link.group.toLowerCase()}.${link.name.toLowerCase()}`
  }
  return root.toString()
}
