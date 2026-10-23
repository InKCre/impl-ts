import {
  APIError,
  DBAPIClient,
  PostgreSQLBinaryStorage,
  Storage,
  WritableStorage,
  rawPostgrestFetch,
  type DatabaseTokenProvider,
} from '@inkcre/core'
import {
  WEB_RECORD_RESOLVER,
  WEB_MATERIAL_RESOLVER,
  decodeBytes,
  encodeBytes,
  validateSubmission,
  type SubmitMaterial,
  type MaterialReceipt,
  type MaterialRead,
  type SourceRecord,
} from './index'

const PART = 'extensions.web-collection.part.'
const NOTE = 'extensions.web-collection.note'
const MATERIAL = 'extensions.web-collection.material'
type Root = {
  key: string
  request_id: string
  mode: SubmitMaterial['mode']
  source: SourceRecord
  material?: SubmitMaterial['material']
}

function check(response: { error: { message: string; code?: string } | null; status: number }) {
  if (response.error)
    throw new APIError(
      [response.error.code, response.error.message].filter(Boolean).join(': '),
      response.status,
      response.error
    )
}

/** Peer-local collection over ordinary graph/storage operations; no database business RPC. */
export class WebMaterialClient {
  readonly blocks: DBAPIClient<'blocks'>
  readonly relations: DBAPIClient<'relations'>
  private readonly storages: DBAPIClient<'storages'>

  constructor(
    private readonly url: string,
    private readonly token: DatabaseTokenProvider
  ) {
    this.blocks = new DBAPIClient('blocks', undefined, 'inkcre', url, token)
    this.relations = new DBAPIClient('relations', undefined, 'inkcre', url, token)
    this.storages = new DBAPIClient('storages', undefined, 'inkcre', url, token)
  }

  async storage(id = -4): Promise<WritableStorage<Uint8Array>> {
    const { data, error, status } = await this.storages.from().select().eq('id', id).single()
    check({ error, status })
    const row = { ...data!, config: data!.config as Record<string, unknown> }
    if (row.type === 'postgresql_binary') {
      return new PostgreSQLBinaryStorage(
        row,
        (path, options) =>
          rawPostgrestFetch(path, {
            ...options,
            baseUrl: this.url,
            tokenProvider: this.token,
            credentials: 'omit',
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
          }),
        new DBAPIClient('storage_blobs', undefined, 'inkcre', this.url, this.token)
      )
    }
    const Handler = Storage.getHandler(row.type)
    const handler = Handler && new Handler(row)
    if (!(handler instanceof WritableStorage))
      throw new Error(`此 Peer 没有可写存储能力：${row.type}。请选择支持的存储或保留链接。`)
    return handler as WritableStorage<Uint8Array>
  }

  private async key(command: SubmitMaterial): Promise<string> {
    if (command.mode === 'fixed') return command.request_id
    // blocks.content is text. This derived key only narrows a normal LIKE query.
    const bytes = new TextEncoder().encode(
      JSON.stringify([command.source.scope, command.source.key])
    )
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  private async findRoot(command: SubmitMaterial, key: string) {
    const resolver = command.mode === 'record' ? WEB_RECORD_RESOLVER : WEB_MATERIAL_RESOLVER
    const { data, error, status } = await this.blocks
      .from()
      .select()
      .eq('resolver', resolver)
      .like('content', `%"key":"${key}"%`)
    check({ error, status })
    return data?.find((row) => {
      const root = JSON.parse(row.content) as Root
      return (
        root.mode === command.mode &&
        root.key === key &&
        root.source.scope === command.source.scope &&
        root.source.key === command.source.key
      )
    })
  }

  private async related(root: number, content: string) {
    const { data, error, status } = await this.relations
      .from()
      .select('to_')
      .eq('from_', root)
      .eq('content', content)
    check({ error, status })
    if (data!.length > 1) throw new Error('材料关联有歧义，请保留待办并检查图。')
    if (!data![0] || data![0].to_ === null) return null
    const block = await this.blocks.from().select().eq('id', data![0].to_).maybeSingle()
    check(block)
    return block.data
  }

  private async link(from: number, to: number, content: string) {
    const existing = await this.relations
      .from()
      .select('id')
      .eq('from_', from)
      .eq('to_', to)
      .eq('content', content)
      .limit(1)
    check(existing)
    if (existing.data!.length) return
    const result = await this.relations.insert({ from_: from, to_: to, content })
    check(result)
  }

  async hasMaterial(recordId: number): Promise<boolean> {
    const { data, error, status } = await this.relations
      .from()
      .select('id')
      .eq('from_', recordId)
      .eq('content', MATERIAL)
      .not('to_', 'is', null)
      .limit(1)
    check({ error, status })
    return !!data?.length
  }

  async submit(value: SubmitMaterial): Promise<MaterialReceipt> {
    const command = validateSubmission(value)
    const key = await this.key(command)
    const root: Root = {
      key,
      request_id: command.request_id,
      mode: command.mode,
      source: command.source,
      material: command.material,
    }
    let row = await this.findRoot(command, key)
    if (!row) {
      const created = await this.blocks
        .insert({
          resolver: command.mode === 'record' ? WEB_RECORD_RESOLVER : WEB_MATERIAL_RESOLVER,
          storage: null,
          content: JSON.stringify(root),
        })
        .select()
        .single()
      check(created)
      row = created.data!
    }
    const partIds: Record<string, number> = {}
    for (const part of command.parts ?? []) {
      const relation = PART + part.role
      const existing = await this.related(row.id, relation)
      if (existing && command.mode !== 'current') {
        partIds[part.role] = existing.id
        continue
      }
      const bytes = decodeBytes(part.base64)
      const storage = part.role === 'pdf' ? await this.storage(command.storage_id) : null
      const content = storage
        ? await storage.createRawContent(bytes)
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const values = { content, storage: storage?.id ?? null, resolver: `core.${part.role}.v1` }
      const saved = existing
        ? await this.blocks.update(values).eq('id', existing.id).select().single()
        : await this.blocks.insert(values).select().single()
      check(saved)
      partIds[part.role] = saved.data!.id
      await this.link(row.id, saved.data!.id, relation)
    }
    if (command.note && !(await this.related(row.id, NOTE))) {
      const saved = await this.blocks
        .insert({
          storage: null,
          resolver: 'core.text.v1',
          content: command.note,
        })
        .select()
        .single()
      check(saved)
      await this.link(row.id, saved.data!.id, NOTE)
    }
    const updated = await this.blocks.update({ content: JSON.stringify(root) }).eq('id', row.id)
    check(updated)
    if (command.mode === 'fixed') {
      const recordCommand: SubmitMaterial = { ...command, mode: 'record' }
      const record = await this.findRoot(recordCommand, await this.key(recordCommand))
      if (record) await this.link(record.id, row.id, MATERIAL)
    }
    // shortcut: a lost create response can leave duplicate/unlinked rows. Recovery
    // reuses visible roots and relations; it does not promise global exactly-once.
    return {
      request_id: command.request_id,
      root_id: row.id,
      source_id: row.id,
      mode: command.mode,
      part_ids: partIds,
      committed_at: new Date().toISOString(),
    }
  }

  async read(blockId: number): Promise<MaterialRead> {
    let row = await this.blocks.from().select().eq('id', blockId).single()
    check(row)
    if (![WEB_MATERIAL_RESOLVER, WEB_RECORD_RESOLVER].includes(row.data!.resolver)) {
      const parent = await this.relations
        .from()
        .select('from_')
        .eq('to_', blockId)
        .like('content', PART + '%')
      check(parent)
      if (parent.data?.length !== 1 || parent.data[0]!.from_ === null)
        throw new Error('未找到明确的网页材料。')
      row = await this.blocks.from().select().eq('id', parent.data[0]!.from_).single()
      check(row)
    }
    const root = JSON.parse(row.data!.content) as Root
    const result: MaterialRead = {
      root_id: row.data!.id,
      requested_id: blockId,
      mode: root.mode,
      source: root.source,
      material: root.material,
      part_ids: {},
      parts: [],
      notes: [],
    }
    for (const role of ['html', 'text', 'pdf'] as const) {
      const part = await this.related(row.data!.id, PART + role)
      if (!part) continue
      const bytes =
        part.storage === null
          ? new TextEncoder().encode(part.content)
          : await (await this.storage(part.storage)).getRawContent(part)
      result.part_ids[role] = part.id
      result.parts.push({ id: part.id, role, base64: encodeBytes(bytes) })
    }
    const note = await this.related(row.data!.id, NOTE)
    if (note) result.notes.push({ id: note.id, text: note.content })
    return result
  }
}
