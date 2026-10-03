import type { IpcArgs, IpcChannel, IpcErrorCode, IpcOutput } from '@shared/ipc'

/** Error de un canal IPC, con el código que devolvió main o el preload. */
export class IpcError extends Error {
  readonly code: IpcErrorCode
  readonly channel: IpcChannel

  constructor(channel: IpcChannel, code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'IpcError'
    this.channel = channel
    this.code = code
  }
}

/**
 * Llama a un canal del contrato y devuelve su resultado tipado. Lanza
 * `IpcError` si la llamada falla, de forma que encaja con TanStack Query.
 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcOutput<C>> {
  const result = await window.vigia.invoke(channel, ...args)
  if (!result.ok) {
    throw new IpcError(channel, result.error.code, result.error.message)
  }
  return result.data
}
