export interface UiSourcePackage {
  root: string
  version: string
  identity: string
  entries: Record<string, string>
  globalComponents: string
}

export const uiSourceEnvironmentVariable: 'INKCRE_UI_SOURCE_ROOT'
export const uiSourceDedupe: string[]

export function isPathInside(directory: string, path: string): boolean
export function readUiSourceInput(argv: string[]): string
export function resolveUiSourcePackage(
  input: string,
  options?: { cwd?: string }
): Promise<UiSourcePackage>
export function resolveUiSourceFromEnvironment(): Promise<UiSourcePackage | null>
export function resolveUiSourceForVite(command: string): Promise<UiSourcePackage | null>
export function createUiSourceAliases(
  uiSource: UiSourcePackage
): Array<{ find: RegExp; replacement: string }>
export function createUiSourceTsconfig(
  uiSource: UiSourcePackage,
  appRoot: string,
  runtimeRoot: string
): Record<string, unknown>
