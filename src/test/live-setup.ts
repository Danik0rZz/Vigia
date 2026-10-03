import { loadLiveEnv } from './live-env'

/**
 * globalSetup de `npm run test:live`: si no hay credenciales, lo dice claro
 * antes de que los tests se salten (sin mostrar nada del fichero).
 */
export default function setup(): void {
  if (loadLiveEnv() === null) {
    console.warn('AVISO: .env.live.local no existe o está vacío; las pruebas en vivo se saltan.')
  }
}
