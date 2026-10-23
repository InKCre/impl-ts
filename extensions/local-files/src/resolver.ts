import { markRaw } from 'vue'
import { Block, Resolver, type ProjectionOptions } from '@inkcre/core'
import { fileMetadata, type SolvedFile } from './schema'
import FileContent from './FileContent.vue'
import FilePreview from './FilePreview.vue'

export class LocalFileResolver extends Resolver<string, SolvedFile> {
  static readonly type = 'extensions.local_files.file.v1'
  static readonly previewRenderer = markRaw(FilePreview)
  static readonly solvedContentRenderer = markRaw(FileContent)

  protected override async _getSolvedContent(options: ProjectionOptions): Promise<SolvedFile> {
    const metadata = fileMetadata.parse(JSON.parse(await this.getRawContent(options)))
    const relations = await this.getRelations({
      includeIn: false,
      includeOut: true,
      refresh: options.refresh,
    })
    const bodies = relations.filter((item) => item.content === 'body')
    if (bodies.length > 1 || (metadata.revision && !bodies.length))
      throw new Error('文件资料的正文关系无效。')
    const body = bodies[0]
    if (!body) return { metadata, text: null, bodyID: null }
    const block = await Block.find(body.to_)
    if (!block || block.resolver !== 'core.text.v1' || block.storage !== null)
      throw new Error('文件正文不存在或类型不符。')
    return { metadata, text: block.content, bodyID: block.id }
  }

  override async getText(options: ProjectionOptions = {}): Promise<string> {
    const { metadata, text } = await this.getSolvedContent({
      ...options,
      materializeMissing: false,
    })
    const parts = [`原件位置：${metadata.location}`]
    if (!metadata.available) parts.push('原件已失效；保留最后收入的正文。')
    if (metadata.issue) parts.push(`当前提取失败：${metadata.issue}。正文对应上次成功修订。`)
    if (metadata.revision?.scope === 'main_document')
      parts.push('DOCX 主文档文字，不含脚注、批注。')
    if (text !== null) parts.push(text)
    return parts.join('\n\n')
  }
}
