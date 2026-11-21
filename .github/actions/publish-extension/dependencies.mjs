export { satisfies, subset, valid as validSemVer, validRange } from 'semver'

export async function loadWebpack() {
  return (await import('webpack')).default
}
