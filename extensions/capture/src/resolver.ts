import { markRaw } from 'vue'
import { Block, Resolver, ResolverCache, type ProjectionOptions } from '@inkcre/core'
import CaptureContent from './CaptureContent.vue'
import CapturePreview from './CapturePreview.vue'
import AttachmentContent from './AttachmentContent.vue'
import AttachmentPreview from './AttachmentPreview.vue'
import {
  captureMetadata,
  attachmentMetadata,
  type SolvedCapture,
  type SolvedAttachment,
  type SolvedMaterial,
} from './schema'

async function solve(
  id: number,
  allowed: string[],
  options: ProjectionOptions
): Promise<SolvedMaterial> {
  const block = await Block.find(id)
  if (!block) throw new Error(`采集材料 Block ${id} 已不存在。`)
  if (!allowed.includes(block.resolver)) throw new Error(`采集材料 Block ${id} 的格式不符合合同。`)
  const resolver = await ResolverCache.getResolver(block)
  return {
    block,
    resolver,
    solvedContent: await resolver.getSolvedContent({ ...options, materializeMissing: false }),
  }
}

export class CaptureResolver extends Resolver<string, SolvedCapture> {
  static readonly type = 'extensions.capture.capture.v1'
  static readonly previewRenderer = markRaw(CapturePreview)
  static readonly solvedContentRenderer = markRaw(CaptureContent)

  protected override async _getSolvedContent(options: ProjectionOptions): Promise<SolvedCapture> {
    const metadata = captureMetadata.parse(JSON.parse(await this.getRawContent(options)))
    const outgoing = await this.getRelations({
      includeIn: false,
      includeOut: true,
      refresh: options.refresh,
    })
    const materials = outgoing.filter((relation) => relation.content.startsWith('material:'))
    if (materials.some((relation) => !/^material:(0|[1-9]\d*)$/.test(relation.content))) {
      throw new Error('采集材料顺序格式不正确。')
    }
    materials.sort((left, right) => Number(left.content.slice(9)) - Number(right.content.slice(9)))
    if (
      materials.length > 128 ||
      materials.some((relation, index) => relation.content !== `material:${index}`)
    ) {
      throw new Error('采集材料顺序不连续或重复。')
    }
    const annotations = outgoing.filter((relation) => relation.content === 'annotation')
    if (annotations.length > 1) throw new Error('采集内容存在重复附注。')
    const result: SolvedCapture = { metadata, materials: [], annotation: null }
    for (const relation of materials) {
      result.materials.push(
        await solve(relation.to_, ['core.text.v1', AttachmentResolver.type], options)
      )
    }
    if (annotations[0])
      result.annotation = await solve(annotations[0].to_, ['core.text.v1'], options)
    return result
  }

  override async getText(options: ProjectionOptions = {}): Promise<string> {
    const content = await this.getSolvedContent(options)
    const origin = content.metadata.origin
    const parts = [`采集时间：${content.metadata.captured_at}`, `入口：${content.metadata.entry}`]
    if (origin?.title) parts.push(`来源标题：${origin.title}`)
    if (origin?.url) parts.push(`来源位置：${origin.url}`)
    if (origin?.application_id) parts.push(`来源应用：${origin.application_id}`)
    for (const material of content.materials) {
      const text = await material.resolver.getText(options)
      if (text !== null) parts.push(`原材料：\n${text}`)
    }
    if (content.annotation)
      parts.push(`用户附注：\n${await content.annotation.resolver.getText(options)}`)
    return parts.join('\n\n')
  }
}

export class AttachmentResolver extends Resolver<string, SolvedAttachment> {
  static readonly type = 'extensions.capture.attachment.v1'
  static readonly previewRenderer = markRaw(AttachmentPreview)
  static readonly solvedContentRenderer = markRaw(AttachmentContent)

  protected override async _getSolvedContent(
    options: ProjectionOptions
  ): Promise<SolvedAttachment> {
    const metadata = attachmentMetadata.parse(JSON.parse(await this.getRawContent(options)))
    const relations = await this.getRelations({
      includeIn: false,
      includeOut: true,
      refresh: options.refresh,
    })
    const content = relations.filter((relation) => relation.content === 'content')
    if (content.length !== 1 || !content[0]) throw new Error('图片附件必须引用一份原始内容。')
    return { metadata, content: await solve(content[0].to_, ['core.image.v1'], options) }
  }

  override async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const content = await this.getSolvedContent(options)
    return content.metadata.filename ?? `图片（${content.metadata.mime_type}）`
  }
}
