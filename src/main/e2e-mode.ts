/** Variable con la que los e2e piden que la ventana no tome el foco del sistema. */
export const E2E_ENV = 'VIGIA_E2E'

/**
 * Modo e2e: la ventana se muestra sin activarse, para no quitarle el foco a
 * quien trabaja en el PC mientras corren las pruebas (y para que una tecla suya
 * no acabe en la ventana de un test). Solo sin empaquetar, como
 * VIGIA_USER_DATA_DIR: en la app empaquetada se ignora siempre.
 */
export function isE2eMode(options: { packaged: boolean; value: string | undefined }): boolean {
  return !options.packaged && options.value === '1'
}
