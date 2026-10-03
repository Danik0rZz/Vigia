/** Alto de la barra superior de la interfaz; los botones nativos se alinean con ella. */
export const TITLE_BAR_HEIGHT = 40

export interface TitleBarColors {
  /** Fondo de la ventana mientras carga la interfaz. */
  background: string
  /** Zona de los botones nativos (minimizar, maximizar, cerrar). */
  overlay: { color: string; symbolColor: string; height: number }
}

/**
 * Colores de la ventana según el tema activo. Deben coincidir con los tokens
 * `--background` y `--foreground` de `src/renderer/src/assets/main.css`.
 */
export function titleBarColors(dark: boolean): TitleBarColors {
  return dark
    ? {
        background: '#0f1218',
        overlay: { color: '#0f1218', symbolColor: '#e6e9ef', height: TITLE_BAR_HEIGHT }
      }
    : {
        background: '#eef1f6',
        overlay: { color: '#eef1f6', symbolColor: '#1b2130', height: TITLE_BAR_HEIGHT }
      }
}
