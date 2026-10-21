import DOMPurify from 'dompurify'

export function isolateMailHtml(
  source: string,
  cidUrls = new Map<string, string>(),
  newsletterReading = false
): string {
  const document = DOMPurify.sanitize(source, {
    RETURN_DOM: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset', 'poster', 'background', 'formaction'],
  }) as HTMLElement
  for (const element of document.querySelectorAll<HTMLElement>('[src]')) {
    const src = element.getAttribute('src')?.trim() ?? ''
    const local = cidUrls.get(src.toLowerCase())
    if (element.tagName === 'IMG' && local) element.setAttribute('src', local)
    else element.removeAttribute('src')
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try {
      const target = new URL(anchor.getAttribute('href') ?? '')
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('unsupported link')
      anchor.href = target.href
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    } catch {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
    }
  }
  if (newsletterReading) {
    for (const table of document.querySelectorAll(
      'table[role="none"],table[role="presentation"]'
    )) {
      // Declared layout tables can reflow; nested data tables keep their own geometry.
      for (const element of [table, ...table.querySelectorAll('tr,td,th')]) {
        if (element.closest('table') !== table) continue
        for (const name of [
          'width',
          'height',
          'nowrap',
          'align',
          'valign',
          'cellpadding',
          'cellspacing',
        ])
          element.removeAttribute(name)
      }
    }
    for (const image of document.querySelectorAll<HTMLImageElement>('img:not([src])')) {
      const anchor = image.closest('a[href]')
      const label =
        image.alt.trim() || (anchor && !anchor.textContent?.trim() ? '查看图片链接' : '')
      image.replaceWith(document.ownerDocument.createTextNode(label))
    }
  }
  const readingStyle = newsletterReading
    ? 'table[role="none"],table[role="presentation"]{width:100%;max-width:100%;table-layout:auto}h4,h5,h6{font-size:1.05em;line-height:1.4;margin-block:1em .5em}'
    : ''
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'nonce-inkcre-mail'"><style nonce="inkcre-mail">body{margin:0;padding:16px;color:#202020;background:#fff;font:16px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.35;font-weight:600}h1{font-size:1.5em}h2{font-size:1.25em}h3{font-size:1.1em}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin-inline:0;padding-inline-start:16px;border-inline-start:2px solid #ccc}a{color:inherit}${readingStyle}</style></head><body>${document.innerHTML}</body></html>`
}
