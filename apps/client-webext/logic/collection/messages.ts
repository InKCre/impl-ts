import { browser } from 'wxt/browser'
import type { CollectionCommand, CommandRequest, CommandResult } from './commands'

export async function collectionMessage<K extends CollectionCommand>(
  message: CommandRequest<K>
): Promise<CommandResult<K>> {
  const response = (await browser.runtime.sendMessage(message)) as {
    ok: boolean
    value?: CommandResult<K>
    error?: string
  }
  if (!response?.ok) throw new Error(response?.error ?? '扩展后台没有响应，请重新打开扩展。')
  return response.value as CommandResult<K>
}
