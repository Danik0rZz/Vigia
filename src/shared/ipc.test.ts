import { describe, expect, it } from 'vitest'
import { ipcContract, ipcFailure, isIpcChannel } from './ipc'

describe('contrato IPC', () => {
  it('reconoce solo los canales declarados', () => {
    expect(isIpcChannel('app:ping')).toBe(true)
    expect(isIpcChannel('app:getInfo')).toBe(true)
    expect(isIpcChannel('fs:readFile')).toBe(false)
    expect(isIpcChannel('toString')).toBe(false)
    expect(isIpcChannel('__proto__')).toBe(false)
    expect(isIpcChannel(undefined)).toBe(false)
  })

  it('nombra todos los canales como ámbito:acción', () => {
    for (const channel of Object.keys(ipcContract)) {
      expect(channel).toMatch(/^[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$/)
    }
  })

  it('construye fallos con código y mensaje', () => {
    expect(ipcFailure('INTERNAL', 'x')).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'x' }
    })
  })
})

describe('CA2 (0006): entrada de entities:serviceMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:serviceMetrics']
    expect(entry, 'canal entities:serviceMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }

  it('acepta SERVICE- y 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: 'SERVICE-0123456789ABCDEF' }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: 'SERVICE-FEDCBA9876543210',
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['otro tipo', 'HOST-0123456789ABCDEF'],
    ['otro tipo con el mismo largo', 'PROCESS_GROUP-0123456789ABCDEF'],
    ['minúsculas en el id', 'SERVICE-0123456789abcdef'],
    ['minúsculas en el tipo', 'service-0123456789ABCDEF'],
    ['15 hexadecimales', 'SERVICE-0123456789ABCDE'],
    ['17 hexadecimales', 'SERVICE-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'SERVICE-0123456789ABCDEG'],
    ['comillas', 'SERVICE-0123456789ABCDE"'],
    ['paréntesis', 'SERVICE-0123456789ABCDE)'],
    ['coma', 'SERVICE-0123456789ABCDE,'],
    ['inyección tras un id válido', 'SERVICE-0123456789ABCDEF"),type("HOST'],
    ['espacios alrededor', ' SERVICE-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    const entityId = 'SERVICE-0123456789ABCDEF'
    expect(input().safeParse({ ...base, entityId, environmentId: 'x' }).success).toBe(false)
    expect(input().safeParse({ ...base, entityId, timeRange: '3h' }).success).toBe(false)
  })
})
