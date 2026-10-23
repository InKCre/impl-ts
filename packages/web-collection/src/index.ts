import { z } from 'zod'

export const WEB_RECORD_RESOLVER = 'extensions.web-collection.record.v1'
export const WEB_MATERIAL_RESOLVER = 'extensions.web-collection.material.v1'
export const MATERIAL_BYTE_LIMIT = 32 * 1024 * 1024
export const MATERIAL_WIRE_LIMIT = 48 * 1024 * 1024

export const SourceRecordSchema = z
  .object({
    scope: z.string().min(1).max(512),
    key: z.string().min(1).max(2048),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict()
export const MaterialPartSchema = z
  .object({
    role: z.enum(['html', 'text', 'pdf']),
    base64: z.string().min(1),
  })
  .strict()
export const MaterialMetadataSchema = z
  .object({
    captured_at: z.iso.datetime(),
    url: z.url().refine((value) => /^https?:\/\//.test(value), '只支持 HTTP(S) 网页'),
    method: z.string().min(1).max(128),
    title: z.string(),
    coverage: z.array(z.string()),
  })
  .catchall(z.unknown())
export const SubmitMaterialSchema = z
  .object({
    request_id: z.uuid(),
    mode: z.enum(['record', 'fixed', 'current']),
    source: SourceRecordSchema,
    storage_id: z.number().int().optional(),
    material: MaterialMetadataSchema.optional(),
    parts: z.array(MaterialPartSchema).min(1).max(3).optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.mode === 'record') {
      if (command.material || command.parts)
        ctx.addIssue({ code: 'custom', message: '来源记录不能携带正文' })
    } else if (!command.material || !command.parts) {
      ctx.addIssue({ code: 'custom', message: '材料需要出处和正文' })
    }
    if (command.mode === 'current' && command.note)
      ctx.addIssue({ code: 'custom', message: '附注请另存为主动材料' })
    if (new Set(command.parts?.map((part) => part.role)).size !== (command.parts?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: '正文类型不能重复' })
  })
export type SubmitMaterial = z.infer<typeof SubmitMaterialSchema>
export type SourceRecord = z.infer<typeof SourceRecordSchema>
export type MaterialMetadata = z.infer<typeof MaterialMetadataSchema>
export type MaterialPart = z.infer<typeof MaterialPartSchema>

export const MaterialReceiptSchema = z.object({
  request_id: z.uuid(),
  root_id: z.number().int(),
  source_id: z.number().int().optional(),
  mode: z.enum(['record', 'fixed', 'current']),
  part_ids: z.record(z.string(), z.number().int()),
  committed_at: z.string(),
})
export type MaterialReceipt = z.infer<typeof MaterialReceiptSchema>

export const MaterialReadSchema = z.object({
  root_id: z.number().int(),
  requested_id: z.number().int(),
  mode: z.enum(['record', 'fixed', 'current']),
  source: SourceRecordSchema,
  material: MaterialMetadataSchema.optional(),
  part_ids: z.record(z.string(), z.number().int()),
  parts: z.array(MaterialPartSchema.extend({ id: z.number().int() })),
  notes: z.array(z.object({ id: z.number().int(), text: z.string() })),
})
export type MaterialRead = z.infer<typeof MaterialReadSchema>

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
export function decodeBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}
export function textPart(role: 'html' | 'text', text: string): MaterialPart {
  return { role, base64: encodeBytes(new TextEncoder().encode(text)) }
}
export function validateSubmission(value: unknown): SubmitMaterial {
  const command = SubmitMaterialSchema.parse(value)
  const total =
    command.parts?.reduce((sum, part) => sum + decodeBytes(part.base64).byteLength, 0) ?? 0
  if (
    total > MATERIAL_BYTE_LIMIT ||
    new TextEncoder().encode(JSON.stringify(command)).byteLength > MATERIAL_WIRE_LIMIT
  )
    throw new Error('材料超过 32 MiB 正文 / 48 MiB 请求上限，请仅保存链接或缩小选区。')
  return command
}
