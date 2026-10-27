import {
  MATERIAL_BYTE_LIMIT,
  encodeBytes,
  textPart,
  type MaterialMetadata,
  type MaterialPart,
} from '@inkcre/web-collection'
import { browser } from 'wxt/browser'
import { parsePublicHTML } from './parse-html'
import { siteMatchPattern } from './permissions'

let openingParser: Promise<void> | undefined
async function parseHTML(
  html: string,
  url: string
): Promise<{ text: string; title: string; canonical?: string }> {
  if (typeof DOMParser !== 'undefined') return parsePublicHTML(html, url)
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL('/parser.html')],
  })
  if (!contexts.length) {
    openingParser ??= browser.offscreen
      .createDocument({
        url: 'parser.html',
        reasons: ['DOM_PARSER'],
        justification: '解析用户已确认导入的网页正文，不执行网页脚本。',
      })
      .finally(() => {
        openingParser = undefined
      })
    await openingParser
  }
  return browser.runtime.sendMessage({ type: 'collection-parse-html', html, url })
}
export async function fetchMaterial(
  url: string,
  pdfOnly = false
): Promise<{ material: MaterialMetadata; parts: MaterialPart[] }> {
  const parsedURL = new URL(url)
  if (!['http:', 'https:'].includes(parsedURL.protocol))
    throw new Error('仅支持在线 HTTP(S) 内容。')
  if (!(await browser.permissions.contains({ origins: [siteMatchPattern(url)] })))
    throw new Error('尚未授权访问该站点，请先授权或打开原页保存。')
  const response = await fetch(url, {
    credentials: pdfOnly ? 'include' : 'omit',
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`原站返回 HTTP ${response.status}，来源记录仍然保留。`)
  const length = Number(response.headers.get('content-length'))
  if (length > MATERIAL_BYTE_LIMIT) throw new Error('原始内容超过 32 MiB 上限，请仅保存链接。')
  if (!response.body) throw new Error('原站未返回正文。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MATERIAL_BYTE_LIMIT) throw new Error('原始内容超过 32 MiB 上限，请仅保存链接。')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const contentType = response.headers.get('content-type') ?? ''
  const type = contentType.split(';')[0]?.trim().toLowerCase()
  const isPDF = new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
  const base: MaterialMetadata = {
    url: response.url || url,
    title: '',
    captured_at: new Date().toISOString(),
    method: pdfOnly ? 'online-pdf' : 'public-fetch',
    coverage: ['本次从原站获取的内容；不代表历史访问或收藏时的网页。'],
  }
  if (isPDF && (pdfOnly || type === 'application/pdf'))
    return { material: base, parts: [{ role: 'pdf', base64: encodeBytes(bytes) }] }
  if (pdfOnly) throw new Error('原站没有返回可识别的 PDF 原始内容；可仅保存链接。')
  if (type === 'text/plain')
    return {
      material: base,
      parts: [textPart('text', new TextDecoder('utf-8', { fatal: true }).decode(bytes))],
    }
  if (!['text/html', 'application/xhtml+xml'].includes(type ?? ''))
    throw new Error(`暂不支持该内容类型：${type ?? '未知'}；来源记录已保留。`)
  const declared =
    /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1] ??
    /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(
      new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
    )?.[1] ??
    'utf-8'
  const html = new TextDecoder(declared, { fatal: true }).decode(bytes)
  const content = await parseHTML(html, response.url || url)
  return {
    material: { ...base, title: content.title, canonical: content.canonical },
    parts: [textPart('html', html), textPart('text', content.text)],
  }
}
