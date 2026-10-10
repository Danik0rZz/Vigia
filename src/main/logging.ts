import { app } from 'electron'
import { join } from 'node:path'
import log from 'electron-log/main'
import { maskLogMessage } from './log-mask'
import { logsDir } from './paths'

const MAX_LOG_BYTES = 5 * 1024 * 1024

/**
 * Logs en fichero rotado dentro de la carpeta de datos, para poder depurar en
 * equipos ajenos. Regla del proyecto: nunca se registran secretos, cabeceras
 * `Authorization` ni cookies.
 */
export function initLogging(): void {
  log.transports.file.resolvePathFn = () => join(logsDir(), 'main.log')
  log.transports.file.maxSize = MAX_LOG_BYTES
  log.transports.file.level = app.isPackaged ? 'info' : 'debug'
  log.transports.console.level = app.isPackaged ? false : 'debug'

  // Filtro final de secretos para todo transporte (ficha 0060). Es la última
  // barrera: cada llamada sigue enmascarando lo suyo.
  if (!log.hooks.includes(maskLogMessage)) log.hooks.push(maskLogMessage)

  // Excepciones y promesas rechazadas sin capturar van al log, sin diálogo.
  log.errorHandler.startCatching({ showDialog: false })
}

export { log }
