import type { DtErrorCode } from '@shared/dynatrace'
import { maskSecrets } from './mask'

const MAX_MESSAGE = 300

/**
 * Error de una llamada a Dynatrace, con un código que la interfaz traduce. El
 * mensaje (a menudo el de Dynatrace) se enmascara antes de truncarlo, para que
 * un token cortado a medias tampoco se filtre.
 */
export class DtError extends Error {
  readonly code: DtErrorCode
  readonly status: number | undefined

  constructor(code: DtErrorCode, message: string, status?: number) {
    super(maskSecrets(message).slice(0, MAX_MESSAGE))
    this.name = 'DtError'
    this.code = code
    this.status = status
  }
}
