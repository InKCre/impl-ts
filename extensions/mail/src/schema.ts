import { z } from 'zod'
import type { Block } from '@inkcre/core'

export const CanonicalEmailSchema = z.strictObject({
  message_id: z.string().nullable().default(null),
  email_id: z.string().nullable().default(null),
  subject: z.string().nullable().default(null),
  authored_at: z.coerce.date().nullable().default(null),
})
export type CanonicalEmail = z.infer<typeof CanonicalEmailSchema>

export const CanonicalMailingListSchema = z.strictObject({
  list_id: z.string(),
  name: z.string().nullable().default(null),
})
export type CanonicalMailingList = z.infer<typeof CanonicalMailingListSchema>

export const CanonicalMailboxSchema = z.strictObject({
  name: z.string(),
  special_uses: z.array(z.string()).default([]),
  mailbox_id: z.string().nullable().default(null),
})
export type CanonicalMailbox = z.infer<typeof CanonicalMailboxSchema>

export const CanonicalEmailAddressSchema = z.strictObject({ address: z.string() })
export type CanonicalEmailAddress = z.infer<typeof CanonicalEmailAddressSchema>

export const CanonicalMailFlagSchema = z.strictObject({
  name: z.string(),
  description: z.string().nullable().default(null),
})
export type CanonicalMailFlag = z.infer<typeof CanonicalMailFlagSchema>

export const CanonicalMimePartSchema = z.strictObject({
  media_type: z.string(),
  charset: z.string().nullable().default(null),
  filename: z.string().nullable().default(null),
  content_id: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  transfer_encoding: z.string().nullable().default(null),
  encoded_size: z.number().int().nonnegative().nullable().default(null),
  content_location: z.string().nullable().default(null),
})
export type CanonicalMimePart = z.infer<typeof CanonicalMimePartSchema>

export const ComponentRelationSchema = z.strictObject({
  role: z.enum(['body', 'attachment', 'inline']),
  part_id: z.string(),
  alternative_groups: z.array(z.string()).nullable().default(null),
})
export type ComponentRelation = z.infer<typeof ComponentRelationSchema>

export const ParticipantRelationSchema = z.strictObject({
  role: z.enum(['from', 'sender', 'reply_to', 'to', 'cc', 'bcc']),
  order: z.number().int().nonnegative(),
  display_name: z.string().nullable().default(null),
})
export type ParticipantRelation = z.infer<typeof ParticipantRelationSchema>

export const ContainsRelationSchema = z.strictObject({
  type: z.literal('contains'),
  uid_validity: z.number().int().positive(),
  uid: z.number().int().positive(),
})
export type ContainsRelation = z.infer<typeof ContainsRelationSchema>

export const EmbeddedReferenceRelationSchema = z.strictObject({
  type: z.literal('embeds'),
  reference: z.string(),
})

export interface SolvedBlock<Content = unknown> {
  block: Block
  solvedContent: Content
}

export interface SolvedMimePart {
  root: CanonicalMimePart
  content: SolvedBlock | null
}

export interface SolvedEmail {
  root: CanonicalEmail
  bodies: Array<SolvedBlock<string> & { relation: ComponentRelation }>
  mailingLists: Array<SolvedBlock<CanonicalMailingList>>
  mimeParts: Array<SolvedBlock<SolvedMimePart> & { relation: ComponentRelation }>
  participants: Array<{
    relation: ParticipantRelation
    address: SolvedBlock<CanonicalEmailAddress>
  }>
  mailboxes: Array<{ relation: ContainsRelation; mailbox: SolvedBlock<CanonicalMailbox> }>
  flags: Array<{ flag: SolvedBlock<CanonicalMailFlag> }>
  parents: Array<SolvedBlock<CanonicalEmail>>
  references: Array<SolvedBlock<CanonicalEmail>>
  embedded: Array<{
    body: Block
    reference: string
    mimePart: SolvedBlock<SolvedMimePart>
  }>
}

export interface SolvedMailingList {
  root: CanonicalMailingList
  emails: Array<SolvedBlock<CanonicalEmail>>
}

export function parseJson(value: string): unknown {
  return JSON.parse(value)
}
