// Busca `.env.live.local` en el directorio de trabajo y, si no está, en el checkout principal
// (ficha 0055). La usan scan-tenant.mjs y notify-telegram.mjs. Solo devuelve la ruta: nunca lee
// ni imprime el contenido.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const LIVE_ENV_FILE = '.env.live.local'

/** Ruta del checkout principal: la primera entrada de `git worktree list --porcelain` en `cwd`. */
export function mainCheckoutOf(cwd) {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    const first = output.split(/\r?\n/).find((l) => l.startsWith('worktree '))
    return first ? first.slice('worktree '.length).trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Ruta de `.env.live.local`: la del `cwd` si existe; si no, la del checkout principal; si
 * tampoco, `undefined`. `mainCheckout` (opcional) sustituye a la consulta a git. No lanza.
 */
export function findLiveEnv(cwd, { mainCheckout } = {}) {
  const local = join(cwd, LIVE_ENV_FILE)
  if (existsSync(local)) return local
  let main
  try {
    main = mainCheckout ? mainCheckout() : mainCheckoutOf(cwd)
  } catch {
    main = undefined
  }
  if (!main) return undefined
  const other = join(main, LIVE_ENV_FILE)
  return existsSync(other) ? other : undefined
}
