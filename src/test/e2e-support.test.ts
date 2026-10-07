import { afterEach, describe, expect, it } from 'vitest'
import { wallTimeToEpoch } from '../../e2e/local-time'
import { CONTENT_SIZE_TOLERANCE_PX, fitsContentSize } from '../../e2e/window-size'

/**
 * Ficha 0011: ayudas de los e2e que no pueden depender de la máquina. Viven en e2e/ (las usa
 * Playwright), pero se prueban aquí con Vitest, que solo recoge src/ y scripts/.
 */

const machineZone = process.env['TZ']

afterEach(() => {
  // vitest.config.ts fija Europe/Madrid para todo el proceso: se deja como estaba.
  process.env['TZ'] = machineZone
})

describe('CA1 (0011): la hora esperada de un rango personalizado no depende de la zona de la máquina', () => {
  // La zona de la máquina se cambia desde el propio test (Node la relee al cambiar TZ): así el
  // resultado se comprueba en las dos zonas aunque vitest.config.ts fije Europe/Madrid.
  for (const zone of ['UTC', 'Europe/Madrid']) {
    describe(`con la máquina en ${zone}`, () => {
      it('convierte la hora de pared de una zona dada a su instante', () => {
        process.env['TZ'] = zone
        // Octubre, horario de verano en Madrid (UTC+2).
        expect(wallTimeToEpoch('2026-10-03T09:00', 'Europe/Madrid')).toBe(
          Date.UTC(2026, 9, 3, 7, 0)
        )
        expect(wallTimeToEpoch('2026-10-03T13:00', 'Europe/Madrid')).toBe(
          Date.UTC(2026, 9, 3, 11, 0)
        )
        expect(wallTimeToEpoch('2026-10-03T09:00', 'UTC')).toBe(Date.UTC(2026, 9, 3, 9, 0))
        expect(wallTimeToEpoch('2026-10-03T09:00', 'America/New_York')).toBe(
          Date.UTC(2026, 9, 3, 13, 0)
        )
        // Tras el cambio de hora (25/10/2026, 03:00 CEST pasa a 02:00 CET): UTC+1.
        expect(wallTimeToEpoch('2026-10-25T04:00', 'Europe/Madrid')).toBe(
          Date.UTC(2026, 9, 25, 3, 0)
        )
        // Invierno en Madrid (UTC+1).
        expect(wallTimeToEpoch('2026-01-15T09:30', 'Europe/Madrid')).toBe(
          Date.UTC(2026, 0, 15, 8, 30)
        )
      })

      it('coincide con cómo interpreta la app la hora local (new Date) en la zona de la máquina', () => {
        process.env['TZ'] = zone
        for (const wall of ['2026-10-03T09:00', '2026-10-03T13:00', '2026-01-15T09:30']) {
          expect(wallTimeToEpoch(wall, zone), wall).toBe(new Date(wall).getTime())
        }
      })
    })
  }

  it('rechaza una hora mal escrita', () => {
    expect(() => wallTimeToEpoch('03/10/2026 09:00', 'UTC')).toThrow()
  })
})

describe('CA2 (0011): el tamaño del contenido acepta el redondeo de Windows al escalar', () => {
  const wanted = { width: 600, height: 600 }

  it('el margen es de 2 px', () => {
    expect(CONTENT_SIZE_TOLERANCE_PX).toBe(2)
  })

  it('acepta el tamaño exacto', () => {
    expect(fitsContentSize({ width: 600, height: 600 }, wanted)).toBe(true)
  })

  it('acepta hasta 2 px de diferencia en alto o en ancho', () => {
    expect(fitsContentSize({ width: 600, height: 602 }, wanted)).toBe(true)
    expect(fitsContentSize({ width: 601, height: 600 }, wanted)).toBe(true)
    expect(fitsContentSize({ width: 598, height: 599 }, wanted)).toBe(true)
    expect(fitsContentSize({ width: 602, height: 602 }, wanted)).toBe(true)
  })

  it('rechaza más de 2 px de diferencia', () => {
    expect(fitsContentSize({ width: 600, height: 603 }, wanted)).toBe(false)
    expect(fitsContentSize({ width: 603, height: 600 }, wanted)).toBe(false)
    expect(fitsContentSize({ width: 597, height: 600 }, wanted)).toBe(false)
    expect(fitsContentSize({ width: 600, height: 597 }, wanted)).toBe(false)
  })
})
