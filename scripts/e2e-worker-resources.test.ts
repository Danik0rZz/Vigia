import { createServer, type Server } from 'node:net'
import { isAbsolute, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listenOn, workerResources } from '../e2e/worker-resources'

/**
 * Ficha 0070, punto 4: con varios workers, cada uno lanza su app y su simulador, así que cada
 * worker usa su propio puerto del simulador y sus propias carpetas de datos de usuario
 * (`VIGIA_USER_DATA_DIR`) y de exportación (`VIGIA_EXPORT_DIR`), derivados del `workerIndex` de
 * Playwright.
 *
 * Contrato que fija este test (módulo `e2e/worker-resources.ts`, fuera de `e2e/views/` para que
 * otros specs, como `tls.spec.ts`, puedan usarlo sin pasar por «specs de vistas»):
 * - `workerResources(workerIndex)`: función pura (no crea nada en disco ni abre puertos) que
 *   devuelve `{ port, userDataDir, exportDir }`;
 * - `listenOn(server, port)`: pone el servidor a escuchar en `127.0.0.1:port` y, si el puerto está
 *   ocupado, rechaza con un error que nombra el puerto (no prueba otro en silencio). El simulador
 *   del arnés escucha con ella.
 */

const INDEXES = Array.from({ length: 16 }, (_, index) => index)

describe('CA6 (0070): workerResources da recursos propios a cada worker', () => {
  it('CA6 (0070): puertos distintos para los índices 0 a 15, en un rango válido', () => {
    const ports = INDEXES.map((index) => workerResources(index).port)
    expect(new Set(ports).size).toBe(INDEXES.length)
    for (const port of ports) {
      expect(Number.isInteger(port), `${port} es entero`).toBe(true)
      // Ni puertos reservados del sistema (< 1024) ni fuera del rango TCP.
      expect(port).toBeGreaterThanOrEqual(1024)
      expect(port).toBeLessThanOrEqual(65_535)
    }
  })

  it('CA6 (0070): carpetas de datos y de exportación distintas para los índices 0 a 15', () => {
    const dirs = INDEXES.flatMap((index) => {
      const resources = workerResources(index)
      return [resolve(resources.userDataDir), resolve(resources.exportDir)]
    })
    // Ninguna se repite: ni entre workers ni la de datos con la de exportación del mismo worker.
    expect(new Set(dirs.map((dir) => dir.toLowerCase())).size).toBe(dirs.length)
    for (const index of INDEXES) {
      const { userDataDir, exportDir } = workerResources(index)
      expect(isAbsolute(userDataDir), userDataDir).toBe(true)
      expect(isAbsolute(exportDir), exportDir).toBe(true)
    }
  })

  it('CA6 (0070): ninguna carpeta de un worker queda dentro de la de otro', () => {
    const dirs = INDEXES.flatMap((index) => {
      const resources = workerResources(index)
      return [resolve(resources.userDataDir), resolve(resources.exportDir)]
    }).map((dir) => dir.toLowerCase())
    for (const outer of dirs) {
      for (const inner of dirs) {
        if (outer === inner) continue
        expect(inner.startsWith(`${outer}\\`) || inner.startsWith(`${outer}/`), inner).toBe(false)
      }
    }
  })

  it('CA6 (0070): el mismo índice da siempre los mismos recursos', () => {
    for (const index of INDEXES) {
      const first = workerResources(index)
      const second = workerResources(index)
      expect(second).toEqual(first)
    }
  })
})

describe('CA6 (0070): con el puerto ocupado, el arnés falla y nombra el puerto', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((done) => (server.listening ? server.close(() => done()) : done()))
        )
    )
  })

  async function occupiedPort(): Promise<number> {
    const holder = createServer()
    servers.push(holder)
    await new Promise<void>((done) => holder.listen(0, '127.0.0.1', done))
    const address = holder.address()
    if (address === null || typeof address === 'string') throw new Error('sin puerto')
    return address.port
  }

  it('CA6 (0070): listenOn rechaza con un mensaje que nombra el puerto ocupado', async () => {
    const port = await occupiedPort()
    const second = createServer()
    servers.push(second)
    const attempt = listenOn(second, port)
    await expect(attempt).rejects.toThrow(String(port))
    // No ha probado otro puerto en silencio.
    expect(second.listening).toBe(false)
  })

  it('CA6 (0070): listenOn escucha en el puerto pedido si está libre', async () => {
    const port = await occupiedPort()
    // Se libera el puerto para pedirlo después: así se sabe cuál es y que está libre.
    const holder = servers.pop() as Server
    await new Promise<void>((done) => holder.close(() => done()))
    const server = createServer()
    servers.push(server)
    await listenOn(server, port)
    const address = server.address()
    expect(address !== null && typeof address === 'object' ? address.port : null).toBe(port)
  })
})
