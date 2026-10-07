import { describe, expect, it } from 'vitest'
import { ipcContract } from './ipc'

/**
 * Ficha 0007: entrada del canal `entities:problemCounts`. El id de la entidad
 * acaba dentro de un problemSelector que construye main; el esquema es la
 * única barrera para que no se pueda inyectar nada en él.
 */

type SafeParser = { safeParse: (value: unknown) => { success: boolean } }

/** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
function input(): SafeParser {
  const contract = ipcContract as unknown as Record<string, { input: SafeParser } | undefined>
  const entry = contract['entities:problemCounts']
  expect(entry, 'canal entities:problemCounts').toBeDefined()
  return entry!.input
}

const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }

describe('CA1 (0007): entrada de entities:problemCounts', () => {
  it.each([
    ['SERVICE', 'SERVICE-0123456789ABCDEF'],
    ['HOST', 'HOST-FEDCBA9876543210'],
    ['PROCESS_GROUP_INSTANCE', 'PROCESS_GROUP_INSTANCE-00000000000000A1'],
    ['APPLICATION', 'APPLICATION-0000000000000000']
  ])('acepta un id estándar de %s con 16 hexadecimales', (_type, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(true)
  })

  it('acepta el rango relativo y el absoluto de la app', () => {
    const entityId = 'SERVICE-0123456789ABCDEF'
    for (const timeRange of ['2h', '24h', '7d']) {
      expect(input().safeParse({ ...base, entityId, timeRange }).success).toBe(true)
    }
    expect(
      input().safeParse({
        ...base,
        entityId,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['minúsculas en el hexadecimal', 'SERVICE-0123456789abcdef'],
    ['minúsculas en el tipo', 'service-0123456789ABCDEF'],
    ['tipo personalizado con dos puntos', 'custom:device-0123456789ABCDEF'],
    ['tipo personalizado con dos puntos en mayúsculas', 'CUSTOM:DEVICE-0123456789ABCDEF'],
    ['comillas', 'SERVICE-0123456789ABCDE"'],
    ['paréntesis', 'SERVICE-0123456789ABCDE)'],
    ['coma', 'SERVICE-0123456789ABCDE,'],
    ['inyección tras un id válido', 'SERVICE-0123456789ABCDEF"),status("closed'],
    ['15 hexadecimales', 'SERVICE-0123456789ABCDE'],
    ['17 hexadecimales', 'SERVICE-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'SERVICE-0123456789ABCDEG'],
    ['sin tipo', '-0123456789ABCDEF'],
    ['tipo que empieza por número', '1SERVICE-0123456789ABCDEF'],
    ['espacios alrededor', ' SERVICE-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid, un rango que no es el de la app y un selector propio', () => {
    const entityId = 'SERVICE-0123456789ABCDEF'
    expect(input().safeParse({ ...base, entityId, environmentId: 'x' }).success).toBe(false)
    expect(input().safeParse({ ...base, entityId, timeRange: '3h' }).success).toBe(false)
    // La interfaz no manda selectores: el canal no los acepta.
    const parsed = input().safeParse({
      ...base,
      entityId,
      problemSelector: 'status("open")'
    }) as { success: boolean; data?: Record<string, unknown> }
    if (parsed.success) expect(parsed.data?.['problemSelector']).toBeUndefined()
  })
})
