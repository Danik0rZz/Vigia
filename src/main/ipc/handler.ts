import {
  describeValidationError,
  ipcFailure,
  ipcSchemas,
  type IpcChannel,
  type IpcOutput,
  type IpcParsedInput,
  type IpcResult
} from '@shared/ipc'
import { DomainError } from '../errors'

/** Lo que main necesita saber de quien envía un mensaje para decidir si se fía. */
export interface IpcSender {
  /** URL del frame que envía; `undefined` si el frame ya no existe. */
  url: string | undefined
  /** `true` si es el frame principal de la ventana, no un iframe. */
  isMainFrame: boolean
}

export type IpcImplementation<C extends IpcChannel> = (
  input: IpcParsedInput<C>
) => IpcOutput<C> | Promise<IpcOutput<C>>

export type IpcImplementations = { [C in IpcChannel]: IpcImplementation<C> }

export interface IpcHandlerDeps {
  isTrustedSender: (sender: IpcSender) => boolean
  logger: {
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

export type IpcHandler<C extends IpcChannel> = (
  sender: IpcSender,
  rawInput: unknown
) => Promise<IpcResult<IpcOutput<C>>>

/**
 * Envuelve la implementación de un canal con las comprobaciones comunes:
 * remitente de confianza, entrada válida, salida válida y errores controlados.
 * No importa Electron, así que se prueba con Vitest sin arrancar la app.
 */
export function createIpcHandler<C extends IpcChannel>(
  channel: C,
  implementation: IpcImplementation<C>,
  deps: IpcHandlerDeps
): IpcHandler<C> {
  const { input: inputSchema, output: outputSchema } = ipcSchemas(channel)

  return async (sender, rawInput) => {
    if (!deps.isTrustedSender(sender)) {
      deps.logger.warn(`IPC ${channel}: remitente rechazado`, sender.url ?? '(sin frame)')
      return ipcFailure('UNTRUSTED_SENDER', 'Remitente no autorizado.')
    }

    const input = inputSchema.safeParse(rawInput)
    if (!input.success) {
      return ipcFailure('INVALID_INPUT', describeValidationError(input.error))
    }

    let result: unknown
    try {
      result = await implementation(input.data)
    } catch (error) {
      // Errores esperados: llegan con su código y su mensaje, que no lleva secretos.
      if (error instanceof DomainError) return ipcFailure(error.code, error.message)
      // El detalle va solo al log de main; al renderer llega un mensaje genérico.
      deps.logger.error(`IPC ${channel}: error en la implementación`, error)
      return ipcFailure('INTERNAL', 'Error interno al procesar la petición.')
    }

    const output = outputSchema.safeParse(result)
    if (!output.success) {
      deps.logger.error(
        `IPC ${channel}: la respuesta no cumple el contrato`,
        describeValidationError(output.error)
      )
      return ipcFailure('INVALID_OUTPUT', 'La respuesta no cumple el contrato del canal.')
    }

    return { ok: true, data: output.data }
  }
}
