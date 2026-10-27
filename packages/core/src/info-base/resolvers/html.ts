/**
 * Core HTML Resolver
 *
 * Handles HTML content from various sources.
 * Apps bind a presentation-neutral solved-content renderer.
 */

import { Parser } from 'htmlparser2'
import { Resolver } from './base'
import type { ProjectionOptions } from './contracts'
import { decodeHtml } from './decode'

export type HtmlRawContent = string | Uint8Array

/**
 * Abstract HTML resolver with logic implementation.
 * Apps bind the renderer without changing this Resolver contract.
 */
export class HtmlResolver extends Resolver<HtmlRawContent, string> {
  static readonly type = 'core.html.v1'

  protected async _getSolvedContent(options: ProjectionOptions): Promise<string> {
    return decodeHtml(await this.getRawContent(options), HtmlResolver.type)
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const source = await this.getSolvedContent(options)
    const text: string[] = []
    const stack: { name: string; href?: string }[] = []
    let ignored = 0
    let pre = 0
    const blocks = new Set([
      'p',
      'div',
      'article',
      'section',
      'blockquote',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'table',
      'tr',
      'pre',
    ])
    const hidden = new Set(['script', 'style', 'template', 'noscript'])
    const parser = new Parser(
      {
        onopentag(name, attributes) {
          stack.push({ name, href: name === 'a' ? attributes.href : undefined })
          if (hidden.has(name)) ignored++
          if (ignored) return
          if (blocks.has(name) || name === 'br') text.push('\n')
          if (name === 'pre') {
            pre++
            text.push('```\n')
          }
          if (name === 'img' && attributes.alt) text.push(attributes.alt)
          if (['img', 'video', 'audio', 'source', 'track'].includes(name))
            for (const attribute of ['src', 'poster'])
              if (attributes[attribute]) text.push(` (${attributes[attribute]})`)
        },
        ontext(value) {
          if (!ignored) text.push(pre ? value : value.replace(/\s+/g, ' '))
        },
        onclosetag(name) {
          const tag = stack.pop()
          if (hidden.has(name)) {
            ignored--
            return
          }
          if (ignored) return
          if (name === 'pre') {
            pre--
            text.push('\n```')
          }
          if (tag?.href) text.push(` (${tag.href})`)
          if (name === 'td' || name === 'th') text.push('\t')
          if (blocks.has(name)) text.push('\n')
        },
      },
      { decodeEntities: true }
    )
    parser.end(source)
    return text.join('').trim()
  }
}
