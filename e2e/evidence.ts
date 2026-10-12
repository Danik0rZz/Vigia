import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { moveToNeutral } from './hover'

/**
 * Capturas de evidencias de los e2e (ficha 0107). Un test de un criterio que cambia algo visible
 * llama, al final (cuando ya ha comprobado lo suyo), a `captureEvidence(page, { criterio, zona })`
 * por cada cosa que cambia. Con `VIGIA_EVIDENCIAS=1` en el entorno (se lee al llamarla), guarda en
 * `test-results/evidencias/<ficha>/`:
 * - `<CA>-<n>-zona.png`: la zona (`locator.screenshot()`);
 * - `<CA>-<n>-ventana.png`: la ventana entera (`page.screenshot()`, 1024×720 de `applyCiWindow`);
 * - una entrada en `manifiesto.json` (array JSON) con `criterio`, `titulo`, `nota`, `zona`,
 *   `ventana` (rutas relativas a la carpeta de la ficha) y `estable`.
 * Sin la variable no hace nada: los e2e de siempre no se alargan ni dejan ficheros.
 *
 * Solo del simulador: si el entorno activo de la app no apunta al simulador local
 * (`pointsToSimulator`), no guarda nada y lo dice en el log del test.
 *
 * Antes de capturar quita lo que se mueve y no es del criterio: el foco (`blur`) y el ratón (a la
 * zona neutra, y espera a que se cierren los tooltips), salvo con `conservarFoco` o
 * `conservarRaton`. Captura con `caret: 'hide'` y `animations: 'disabled'` (en Electron con
 * Playwright 1.63 funcionan: el cursor de texto no sale y las transiciones CSS se dan por acabadas,
 * comprobado en CA3c). ECharts anima en su lienzo y eso no lo para nada de lo anterior: por eso
 * captura hasta que dos capturas seguidas dan los mismos bytes, con un tiempo máximo; si se pasa,
 * guarda la última con `estable: false` y no falla.
 */

export const EVIDENCE_ENV = 'VIGIA_EVIDENCIAS'

/** Tiempo máximo para que zona y ventana dejen de cambiar (cada una). */
const STABLE_TIMEOUT_MS = 8_000
/** Pausa entre dos capturas que se comparan: más que un fotograma, para no caer en el mismo. */
const STABLE_INTERVAL_MS = 120
/** Tiempo máximo para que se cierren los tooltips tras llevar el ratón a la zona neutra. */
const TOOLTIP_TIMEOUT_MS = 2_000
/** Tiempo máximo esperando el cerrojo del manifiesto (otro worker escribiendo). */
const LOCK_TIMEOUT_MS = 10_000

const SHOT = { caret: 'hide', animations: 'disabled' } as const

export type EvidenceOptions = {
  /** El criterio tal como va en el título del test: «CA1 (0018)». */
  criterio: string
  /** Lo que enseña el criterio. */
  zona: Locator
  /** Texto corto opcional para el pie de la captura. */
  nota?: string
  /** El criterio es el foco: no se quita. */
  conservarFoco?: boolean
  /** El criterio es el hover (un tooltip): no se mueve el ratón. */
  conservarRaton?: boolean
}

export type EvidenceEntry = {
  criterio: string
  titulo: string
  nota: string | null
  zona: string
  ventana: string
  estable: boolean
}

/**
 * Si la URL es la del simulador de los e2e (HTTPS en 127.0.0.1, `e2e/views/simulator.ts`), con
 * cualquier puerto o ruta. Cualquier otra cosa (sin URL, no válida, otro host) es que no.
 */
export function pointsToSimulator(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url === '') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && parsed.hostname === '127.0.0.1'
}

/** Ficha y nombre corto del criterio: «CA1b (0107)» → { ficha: '0107', ca: 'CA1b' }. */
function parseCriterio(criterio: string): { ficha: string; ca: string } {
  const match = /^\s*([A-Za-z0-9]+)\s*\((\d{4})\)/.exec(criterio)
  if (match === null)
    throw new Error(`captureEvidence: criterio «${criterio}» sin la forma «CA1 (0018)»`)
  return { ca: match[1] as string, ficha: match[2] as string }
}

/** URL (o URLs) a las que apunta el entorno activo de la app, leídas por IPC. */
async function activeUrls(page: Page): Promise<(string | null)[] | null> {
  return page.evaluate(async () => {
    const api = (
      window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
    ).vigia
    const active = (await api.invoke('environments:getActive')) as {
      ok: boolean
      data?: { environmentId: string | null }
    }
    const id = active.ok ? active.data?.environmentId : null
    if (id === null || id === undefined) return null
    const list = (await api.invoke('tenants:list')) as {
      ok: boolean
      data?: {
        environments: { id: string; classicApiUrl: string | null; platformUrl: string | null }[]
      }
    }
    const found = list.data?.environments.find((environment) => environment.id === id)
    return found === undefined ? null : [found.classicApiUrl, found.platformUrl]
  })
}

/** La app apunta al simulador: la URL clásica lo es y la de plataforma, si la hay, también. */
async function appPointsToSimulator(page: Page): Promise<boolean> {
  const urls = await activeUrls(page)
  if (urls === null) return false
  const [classic, platform] = urls
  return pointsToSimulator(classic) && (platform === null || pointsToSimulator(platform))
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Captura hasta que dos seguidas dan los mismos bytes o se pasa el tiempo; devuelve la última. */
async function stableShot(
  shoot: () => Promise<Buffer>
): Promise<{ bytes: Buffer; stable: boolean }> {
  const deadline = Date.now() + STABLE_TIMEOUT_MS
  let previous = await shoot()
  for (;;) {
    await sleep(STABLE_INTERVAL_MS)
    const current = await shoot()
    if (Buffer.compare(current, previous) === 0) return { bytes: current, stable: true }
    previous = current
    if (Date.now() > deadline) return { bytes: current, stable: false }
  }
}

/** Cierra lo que se mueve y no es del criterio: foco y ratón (con sus tooltips). */
async function quiet(page: Page, options: EvidenceOptions): Promise<void> {
  if (options.conservarFoco !== true)
    await page.evaluate(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    })
  if (options.conservarRaton !== true) {
    await moveToNeutral(page)
    const deadline = Date.now() + TOOLTIP_TIMEOUT_MS
    while ((await page.getByRole('tooltip').count()) > 0 && Date.now() < deadline) await sleep(50)
  }
}

/** Cerrojo entre workers para el manifiesto (`mkdir` es atómico). */
async function withLock<T>(dir: string, body: () => T): Promise<T> {
  const lock = join(dir, '.manifiesto.lock')
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() > deadline) throw error
      await sleep(25)
    }
  }
  try {
    return body()
  } finally {
    rmdirSync(lock)
  }
}

function readManifest(file: string): EvidenceEntry[] {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8').trim()
  return text === '' ? [] : (JSON.parse(text) as EvidenceEntry[])
}

/**
 * Guarda la evidencia de un criterio (ver la cabecera). No hace nada sin `VIGIA_EVIDENCIAS=1` ni
 * si la app no apunta al simulador. Nunca hace fallar el test por no poder estabilizar la imagen.
 */
export async function captureEvidence(page: Page, options: EvidenceOptions): Promise<void> {
  if (process.env[EVIDENCE_ENV] !== '1') return
  // Import dinámico: así `pointsToSimulator` se puede probar con Vitest sin cargar Playwright Test.
  const { test } = await import('@playwright/test')
  const info = test.info()
  const { ficha, ca } = parseCriterio(options.criterio)

  if (!(await appPointsToSimulator(page))) {
    const message = `captureEvidence: la app no apunta al simulador; no se guarda la evidencia de ${options.criterio}`
    console.warn(message)
    info.annotations.push({ type: 'evidencia', description: message })
    return
  }

  await quiet(page, options)
  await options.zona.scrollIntoViewIfNeeded()
  const zone = await stableShot(() => options.zona.screenshot(SHOT))
  const whole = await stableShot(() => page.screenshot(SHOT))

  const dir = join(process.cwd(), 'test-results', 'evidencias', ficha)
  mkdirSync(dir, { recursive: true })
  await withLock(dir, () => {
    const file = join(dir, 'manifiesto.json')
    const entries = readManifest(file)
    // El número sigue a las evidencias de ese criterio (y salta si ya hay un PNG con él).
    let n = entries.filter((entry) => entry.criterio === options.criterio).length + 1
    while (existsSync(join(dir, `${ca}-${n}-zona.png`))) n += 1
    const entry: EvidenceEntry = {
      criterio: options.criterio,
      titulo: info.title,
      nota: options.nota ?? null,
      zona: `${ca}-${n}-zona.png`,
      ventana: `${ca}-${n}-ventana.png`,
      estable: zone.stable && whole.stable
    }
    writeFileSync(join(dir, entry.zona), zone.bytes)
    writeFileSync(join(dir, entry.ventana), whole.bytes)
    writeFileSync(file, `${JSON.stringify([...entries, entry], null, 2)}\n`)
  })
}
