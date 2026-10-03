import { z } from 'zod'

/** Preferencia de tema: "system" sigue al tema de Windows. */
export const themePreferences = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof themePreferences)[number]

/**
 * Contrato IPC: la única vía por la que la interfaz habla con el proceso main.
 *
 * Cada canal declara un esquema de entrada y otro de salida. El preload valida
 * la entrada antes de enviarla y main valida de nuevo todo lo que recibe y todo
 * lo que devuelve. Para añadir un canal: declararlo aquí e implementarlo en
 * `src/main/ipc/handlers`; el compilador avisa si falta la implementación.
 */
export const ipcContract = {
  /** Datos de la app y de su runtime, para la pantalla de inicio y "Acerca de". */
  'app:getInfo': {
    input: z.void(),
    output: z.object({
      name: z.string(),
      version: z.string(),
      packaged: z.boolean(),
      platform: z.string(),
      versions: z.object({
        electron: z.string(),
        chrome: z.string(),
        node: z.string()
      })
    })
  },
  /** Canal de ejemplo de la Fase 1: comprueba el recorrido renderer → preload → main. */
  'app:ping': {
    input: z.object({
      message: z.string().trim().min(1).max(200)
    }),
    output: z.object({
      reply: z.string(),
      receivedAt: z.iso.datetime()
    })
  },
  /**
   * Aplica la preferencia de tema a `nativeTheme`, para que los controles nativos
   * y la barra de título coincidan con la interfaz. El CSS lo resuelve el renderer.
   */
  'ui:setTheme': {
    input: z.object({ theme: z.enum(themePreferences) }),
    output: z.object({ dark: z.boolean() })
  }
} as const

export type IpcChannel = keyof typeof ipcContract

/** Lo que escribe quien llama (antes de validar). */
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcContract)[C]['input']>
/** Lo que recibe la implementación en main (ya validado y normalizado). */
export type IpcParsedInput<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['input']>
/** Lo que devuelve el canal. */
export type IpcOutput<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['output']>

/** Los canales sin entrada se llaman sin segundo argumento. */
export type IpcArgs<C extends IpcChannel> = [IpcInput<C>] extends [void] ? [] : [input: IpcInput<C>]

export const ipcErrorCodes = [
  'UNKNOWN_CHANNEL',
  'UNTRUSTED_SENDER',
  'INVALID_INPUT',
  'INVALID_OUTPUT',
  'INTERNAL'
] as const
export type IpcErrorCode = (typeof ipcErrorCodes)[number]

export interface IpcFailure {
  code: IpcErrorCode
  /** Mensaje apto para mostrar o registrar: nunca incluye secretos ni trazas. */
  message: string
}

/**
 * Sobre de respuesta. Los errores viajan como datos porque las excepciones
 * pierden su información al cruzar IPC y el puente de contexto.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcFailure }

/**
 * Esquemas de un canal con sus tipos concretos. TypeScript no relaciona por sí
 * solo el canal genérico con su esquema, así que la conversión se hace aquí,
 * en un único sitio.
 */
export function ipcSchemas<C extends IpcChannel>(
  channel: C
): { input: z.ZodType<IpcParsedInput<C>>; output: z.ZodType<IpcOutput<C>> } {
  return ipcContract[channel] as unknown as {
    input: z.ZodType<IpcParsedInput<C>>
    output: z.ZodType<IpcOutput<C>>
  }
}

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.hasOwn(ipcContract, value)
}

export function ipcFailure(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

/** Resume un error de validación de Zod sin volcar los datos recibidos. */
export function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(raíz)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

/** API que el preload expone en `window.vigia`. */
export interface VigiaApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<IpcOutput<C>>>
}
