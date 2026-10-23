/** Firefox match patterns cannot include a port; collection policy still uses the exact origin. */
export function siteMatchPattern(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP(S) 站点权限。')
  return `${url.protocol}//${url.hostname}/*`
}
