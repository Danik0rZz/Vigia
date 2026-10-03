/**
 * Identidad de la app. "Vigía" es solo el nombre visible; todo lo técnico
 * (paquete, ejecutable, carpeta de datos, protocolo) usa `vigia`, sin tilde.
 */
export const APP_ID = 'vigia'
export const APP_NAME = 'Vigía'
export const APP_USER_MODEL_ID = 'com.vigia.app'

/** La interfaz se sirve por un protocolo propio en lugar de `file://`. */
export const APP_SCHEME = 'app'
export const APP_HOST = 'vigia'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`
