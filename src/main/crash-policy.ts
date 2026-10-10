import { APP_NAME } from '@shared/app'

/**
 * Qué hacer cuando el proceso de la interfaz cae o deja de responder
 * (ficha 0061, C-05). Lógica pura: el reloj, el log y las acciones de Electron
 * llegan inyectados y `window.ts` solo la llama.
 */

export type CrashLanguage = 'es' | 'en'

export interface CrashTexts {
  /** Diálogo de la segunda caída seguida: remite al log. */
  goneMessage: string
  /** Diálogo de la interfaz que no responde. */
  unresponsiveMessage: string
  wait: string
  close: string
}

const TEXTS: Record<CrashLanguage, CrashTexts> = {
  es: {
    goneMessage:
      'La interfaz se ha cerrado de forma inesperada dos veces seguidas y Vigía se va a cerrar. ' +
      'Los detalles están en el log (carpeta logs de los datos de la app).',
    unresponsiveMessage:
      'La interfaz no responde. Puedes esperar a que se recupere o cerrar Vigía.',
    wait: 'Esperar',
    close: 'Cerrar'
  },
  en: {
    goneMessage:
      'The interface closed unexpectedly twice in a row and Vigía will now close. ' +
      'The details are in the log (logs folder in the app data).',
    unresponsiveMessage:
      'The interface is not responding. You can wait for it to recover or close Vigía.',
    wait: 'Wait',
    close: 'Close'
  }
}

export function crashTexts(language: CrashLanguage): CrashTexts {
  return TEXTS[language]
}

/**
 * Idioma de los diálogos de main. El idioma elegido vive en el `localStorage`
 * del renderer, que main no lee: se usa el del sistema (`app.getLocale()`),
 * con español por defecto como la interfaz. Decisión refinable (ficha 0061).
 */
export function crashLanguageFromLocale(locale: string): CrashLanguage {
  return locale.toLowerCase().startsWith('en') ? 'en' : 'es'
}

/** Dos caídas en menos de este tiempo (desde la última recarga) cierran la app. */
export const CRASH_WINDOW_MS = 60_000

/** Salidas del proceso que no son una caída: cierre normal o matado a propósito. */
const NOT_A_CRASH = new Set(['clean-exit', 'killed'])

interface CrashLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface CrashPolicyDeps {
  now: () => number
  logger: CrashLogger
  reload: () => void
  showErrorBox: (title: string, content: string) => void
  quit: () => void
  language: () => CrashLanguage
}

export interface RenderProcessGoneDetails {
  reason: string
  exitCode: number
}

export interface CrashPolicy {
  renderProcessGone(details: RenderProcessGoneDetails): void
}

/** Primera caída: log y recarga. Otra antes de un minuto desde la recarga: diálogo y cierre. */
export function createCrashPolicy(deps: CrashPolicyDeps): CrashPolicy {
  let lastReload: number | null = null
  let closing = false

  return {
    renderProcessGone({ reason, exitCode }) {
      if (closing || NOT_A_CRASH.has(reason)) return
      deps.logger.error('El proceso de la interfaz ha caído', { reason, exitCode })

      const now = deps.now()
      if (lastReload !== null && now - lastReload < CRASH_WINDOW_MS) {
        closing = true
        deps.logger.error('La interfaz ha vuelto a caer antes de un minuto: se cierra la app')
        deps.showErrorBox(APP_NAME, crashTexts(deps.language()).goneMessage)
        deps.quit()
        return
      }

      lastReload = now
      deps.logger.info('Se recarga la interfaz tras la caída')
      deps.reload()
    }
  }
}

/** Segundos que se espera, tras `unresponsive`, antes de preguntar. */
export const UNRESPONSIVE_DELAY_MS = 5_000

export type UnresponsiveChoice = 'wait' | 'close'

export interface UnresponsivePolicyDeps {
  logger: CrashLogger
  schedule: (fn: () => void, ms: number) => unknown
  cancel: (handle: unknown) => void
  /** Muestra el diálogo con «Esperar» y «Cerrar» y devuelve la elección. */
  ask: (texts: CrashTexts) => Promise<UnresponsiveChoice>
  close: () => void
  language: () => CrashLanguage
}

export interface UnresponsivePolicy {
  unresponsive(): void
  responsive(): void
}

/**
 * Interfaz colgada: si sigue sin responder tras unos segundos, pregunta. Con
 * «Esperar» vuelve a preguntar pasado el mismo tiempo si sigue colgada; si se
 * recupera entre medias, no pregunta.
 */
export function createUnresponsivePolicy(deps: UnresponsivePolicyDeps): UnresponsivePolicy {
  let hung = false
  let timer: unknown = null
  let asking = false

  const check = (): void => {
    timer = null
    if (!hung || asking) return
    asking = true
    void deps.ask(crashTexts(deps.language())).then(
      (choice) => {
        asking = false
        if (choice === 'close') {
          deps.logger.warn('La interfaz no responde: se cierra a petición del usuario')
          deps.close()
        } else if (hung) {
          timer = deps.schedule(check, UNRESPONSIVE_DELAY_MS)
        }
      },
      (error: unknown) => {
        asking = false
        deps.logger.error('No se pudo mostrar el diálogo de interfaz colgada', error)
      }
    )
  }

  return {
    unresponsive() {
      if (hung) return
      hung = true
      deps.logger.warn('La interfaz no responde')
      timer = deps.schedule(check, UNRESPONSIVE_DELAY_MS)
    },
    responsive() {
      if (!hung) return
      hung = false
      deps.logger.info('La interfaz vuelve a responder')
      if (timer !== null) deps.cancel(timer)
      timer = null
    }
  }
}
