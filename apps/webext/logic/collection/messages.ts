import { browser } from 'wxt/browser'

export async function collectionMessage<T>(message: Record<string, unknown>): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as {
    ok: boolean
    value?: T
    error?: string
  }
  if (!response?.ok) throw new Error(response?.error ?? '扩展后台没有响应，请重新打开扩展。')
  return response.value as T
}
