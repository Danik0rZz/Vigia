import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ipcContract, type IpcChannel } from '@shared/ipc'
import {
  createIpcHandler,
  type IpcHandlerDeps,
  type IpcImplementation,
  type IpcImplementations,
  type IpcSender
} from './handler'

function describeSender(event: IpcMainInvokeEvent): IpcSender {
  // `senderFrame` es null si el frame se destruyó o navegó antes de atender el mensaje.
  const frame = event.senderFrame
  return {
    url: frame?.url,
    isMainFrame: frame !== null && frame.parent === null
  }
}

/** Registra en `ipcMain` todos los canales del contrato, y solo esos. */
export function registerIpcHandlers(
  implementations: IpcImplementations,
  deps: IpcHandlerDeps
): void {
  const register = <C extends IpcChannel>(channel: C): void => {
    const implementation = implementations[channel] as IpcImplementation<C>
    const handler = createIpcHandler(channel, implementation, deps)
    ipcMain.handle(channel, (event, rawInput: unknown) => handler(describeSender(event), rawInput))
  }

  for (const channel of Object.keys(ipcContract) as IpcChannel[]) {
    register(channel)
  }
}
