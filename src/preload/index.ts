import { contextBridge, ipcRenderer } from 'electron'
import {
  describeValidationError,
  ipcFailure,
  ipcSchemas,
  isIpcChannel,
  type VigiaApi
} from '@shared/ipc'

/**
 * Preload en sandbox: solo puede cargar `electron`, `events`, `timers` y `url`,
 * así que se compila en un único fichero con Zod dentro.
 *
 * Expone una única función. No se entrega `ipcRenderer` a la interfaz: solo se
 * pueden invocar los canales del contrato, con la entrada ya validada. Main
 * vuelve a validar todo; esta comprobación solo sirve para fallar pronto.
 */
const api: VigiaApi = {
  async invoke(channel, ...args) {
    if (!isIpcChannel(channel)) {
      return ipcFailure('UNKNOWN_CHANNEL', 'Canal IPC desconocido.')
    }

    const input = ipcSchemas(channel).input.safeParse(args[0])
    if (!input.success) {
      return ipcFailure('INVALID_INPUT', describeValidationError(input.error))
    }

    return ipcRenderer.invoke(channel, input.data)
  }
}

contextBridge.exposeInMainWorld('vigia', api)
