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

describe('CA6 (0014): entrada de entities:names', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:names']
    expect(entry, 'canal entities:names').toBeDefined()
    return entry!.input
  }
  const environmentId = '00000000-0000-4000-8000-000000000001'
  /** Ids inventados del mismo tipo, con el formato de Dynatrace (16 hexadecimales). */
  const hosts = (count: number): string[] =>
    Array.from(
      { length: count },
      (_, i) => `HOST-${i.toString(16).toUpperCase().padStart(16, '0')}`
    )

  it('acepta de 1 a 50 ids del mismo tipo', () => {
    expect(input().safeParse({ environmentId, entityIds: hosts(1) }).success).toBe(true)
    expect(input().safeParse({ environmentId, entityIds: hosts(50) }).success).toBe(true)
    expect(
      input().safeParse({
        environmentId,
        entityIds: [
          'PROCESS_GROUP_INSTANCE-00000000000000A1',
          'PROCESS_GROUP_INSTANCE-00000000000000B2'
        ]
      }).success
    ).toBe(true)
  })

  it('rechaza 0 ids y más de 50', () => {
    expect(input().safeParse({ environmentId, entityIds: [] }).success).toBe(false)
    expect(input().safeParse({ environmentId, entityIds: hosts(51) }).success).toBe(false)
  })

  it.each([
    ['minúsculas en el id', 'HOST-0123456789abcdef'],
    ['minúsculas en el tipo', 'host-0123456789ABCDEF'],
    ['15 hexadecimales', 'HOST-0123456789ABCDE'],
    ['17 hexadecimales', 'HOST-0123456789ABCDEF0'],
    ['comillas', 'HOST-0123456789ABCDE"'],
    ['inyección tras un id válido', 'HOST-0123456789ABCDEF"),type("SERVICE'],
    ['tipo personalizado con dos puntos', 'custom:device-0123456789ABCDEF'],
    ['espacios alrededor', ' HOST-0123456789ABCDEF '],
    ['vacío', '']
  ])('rechaza un id con %s (aunque los demás sean válidos)', (_case, bad) => {
    expect(input().safeParse({ environmentId, entityIds: [...hosts(2), bad] }).success).toBe(false)
  })

  it('rechaza tipos mezclados (la API exige que sean del mismo tipo)', () => {
    expect(
      input().safeParse({
        environmentId,
        entityIds: ['HOST-0123456789ABCDEF', 'SERVICE-0123456789ABCDEF']
      }).success
    ).toBe(false)
    // Un tipo que es prefijo de otro también es otro tipo.
    expect(
      input().safeParse({
        environmentId,
        entityIds: ['PROCESS_GROUP-0123456789ABCDEF', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF']
      }).success
    ).toBe(false)
  })

  it('rechaza un entorno que no es uuid y una lista que no es lista', () => {
    expect(input().safeParse({ environmentId: 'x', entityIds: hosts(1) }).success).toBe(false)
    expect(input().safeParse({ environmentId, entityIds: 'HOST-0123456789ABCDEF' }).success).toBe(
      false
    )
  })
})

describe('CA2 (0016): entrada de entities:hostMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:hostMetrics']
    expect(entry, 'canal entities:hostMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }

  it('acepta HOST- y 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: 'HOST-0123456789ABCDEF' }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: 'HOST-FEDCBA9876543210',
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['otro tipo', 'SERVICE-0123456789ABCDEF'],
    ['otro tipo que empieza por HOST', 'HOST_GROUP-0123456789ABCDEF'],
    ['otro tipo con el mismo largo', 'DISK-0123456789ABCDEF'],
    ['minúsculas en el id', 'HOST-0123456789abcdef'],
    ['minúsculas en el tipo', 'host-0123456789ABCDEF'],
    ['15 hexadecimales', 'HOST-0123456789ABCDE'],
    ['17 hexadecimales', 'HOST-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'HOST-0123456789ABCDEG'],
    ['comillas', 'HOST-0123456789ABCDE"'],
    ['paréntesis', 'HOST-0123456789ABCDE)'],
    ['coma', 'HOST-0123456789ABCDE,'],
    ['inyección tras un id válido', 'HOST-0123456789ABCDEF"),type("SERVICE'],
    ['espacios alrededor', ' HOST-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    const entityId = 'HOST-0123456789ABCDEF'
    expect(input().safeParse({ ...base, entityId, environmentId: 'x' }).success).toBe(false)
    expect(input().safeParse({ ...base, entityId, timeRange: '3h' }).success).toBe(false)
  })
})

describe('CA2 (0022): entrada de entities:monitorMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:monitorMetrics']
    expect(entry, 'canal entities:monitorMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }

  it.each([
    ['browser monitor', 'SYNTHETIC_TEST-0123456789ABCDEF'],
    ['HTTP monitor', 'HTTP_CHECK-FEDCBA9876543210']
  ])('acepta un %s con 16 hexadecimales en mayúsculas, con rango relativo o absoluto', (_c, id) => {
    expect(input().safeParse({ ...base, entityId: id }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: id,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['otro tipo', 'SERVICE-0123456789ABCDEF'],
    ['un host', 'HOST-0123456789ABCDEF'],
    ['un paso de browser monitor', 'SYNTHETIC_TEST_STEP-0123456789ABCDEF'],
    ['una petición de HTTP monitor', 'HTTP_CHECK_STEP-0123456789ABCDEF'],
    ['una localización', 'SYNTHETIC_LOCATION-0123456789ABCDEF'],
    ['un monitor de la API v1 (sin tipo de entidad)', 'SYNTHETIC_TEST_0123456789ABCDEF'],
    ['minúsculas en el id', 'SYNTHETIC_TEST-0123456789abcdef'],
    ['minúsculas en el tipo', 'http_check-0123456789ABCDEF'],
    ['15 hexadecimales', 'HTTP_CHECK-0123456789ABCDE'],
    ['17 hexadecimales', 'SYNTHETIC_TEST-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'HTTP_CHECK-0123456789ABCDEG'],
    ['comillas', 'SYNTHETIC_TEST-0123456789ABCDE"'],
    ['paréntesis', 'HTTP_CHECK-0123456789ABCDE)'],
    ['coma', 'SYNTHETIC_TEST-0123456789ABCDE,'],
    ['inyección tras un id válido', 'HTTP_CHECK-0123456789ABCDEF"),type("HOST'],
    ['espacios alrededor', ' SYNTHETIC_TEST-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    const entityId = 'HTTP_CHECK-0123456789ABCDEF'
    expect(input().safeParse({ ...base, entityId, environmentId: 'x' }).success).toBe(false)
    expect(input().safeParse({ ...base, entityId, timeRange: '3h' }).success).toBe(false)
  })
})

describe('CA2 (0027): entrada de entities:processMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:processMetrics']
    expect(entry, 'canal entities:processMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }
  const PROCESS_ID = 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF'

  it('acepta un PROCESS_GROUP_INSTANCE con 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: PROCESS_ID }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: PROCESS_ID,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['un host', 'HOST-0123456789ABCDEF'],
    ['un servicio', 'SERVICE-0123456789ABCDEF'],
    ['un process group (sin instancia)', 'PROCESS_GROUP-0123456789ABCDEF'],
    ['un browser monitor', 'SYNTHETIC_TEST-0123456789ABCDEF'],
    ['minúsculas en el id', 'PROCESS_GROUP_INSTANCE-0123456789abcdef'],
    ['minúsculas en el tipo', 'process_group_instance-0123456789ABCDEF'],
    ['15 hexadecimales', 'PROCESS_GROUP_INSTANCE-0123456789ABCDE'],
    ['17 hexadecimales', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEG'],
    ['comillas', 'PROCESS_GROUP_INSTANCE-0123456789ABCDE"'],
    ['paréntesis', 'PROCESS_GROUP_INSTANCE-0123456789ABCDE)'],
    ['coma', 'PROCESS_GROUP_INSTANCE-0123456789ABCDE,'],
    ['inyección tras un id válido', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF"),type("HOST'],
    ['espacios alrededor', ' PROCESS_GROUP_INSTANCE-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    expect(input().safeParse({ ...base, entityId: PROCESS_ID, environmentId: 'x' }).success).toBe(
      false
    )
    expect(input().safeParse({ ...base, entityId: PROCESS_ID, timeRange: '3h' }).success).toBe(
      false
    )
  })
})

describe('CA3 (0040): entrada de entities:diskMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:diskMetrics']
    expect(entry, 'canal entities:diskMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }
  const DISK_ID = 'DISK-0123456789ABCDEF'

  it('acepta un DISK con 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: DISK_ID }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: DISK_ID,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['un host', 'HOST-0123456789ABCDEF'],
    ['un proceso', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF'],
    ['minúsculas en el id', 'DISK-0123456789abcdef'],
    ['minúsculas en el tipo', 'disk-0123456789ABCDEF'],
    ['15 hexadecimales', 'DISK-0123456789ABCDE'],
    ['17 hexadecimales', 'DISK-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'DISK-0123456789ABCDEG'],
    ['comillas', 'DISK-0123456789ABCDE"'],
    ['paréntesis', 'DISK-0123456789ABCDE)'],
    ['coma', 'DISK-0123456789ABCDE,'],
    ['inyección tras un id válido', 'DISK-0123456789ABCDEF")),builtin:host.cpu.usage:filter(eq("a'],
    ['espacios alrededor', ' DISK-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    expect(input().safeParse({ ...base, entityId: DISK_ID, environmentId: 'x' }).success).toBe(
      false
    )
    expect(input().safeParse({ ...base, entityId: DISK_ID, timeRange: '3h' }).success).toBe(false)
  })
})

describe('CA2 (0041): entrada de entities:hostLogs', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:hostLogs']
    expect(entry, 'canal entities:hostLogs').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }
  const HOST_ID = 'HOST-0123456789ABCDEF'

  it('acepta un HOST con 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: HOST_ID }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: HOST_ID,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['un proceso', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF'],
    ['un disco', 'DISK-0123456789ABCDEF'],
    ['minúsculas en el id', 'HOST-0123456789abcdef'],
    ['15 hexadecimales', 'HOST-0123456789ABCDE'],
    ['17 hexadecimales', 'HOST-0123456789ABCDEF0'],
    ['comillas', 'HOST-0123456789ABCDE"'],
    ['paréntesis', 'HOST-0123456789ABCDE)'],
    ['inyección tras un id válido', 'HOST-0123456789ABCDEF")),type("SERVICE'],
    ['espacios alrededor', ' HOST-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    expect(input().safeParse({ ...base, entityId: HOST_ID, environmentId: 'x' }).success).toBe(
      false
    )
    expect(input().safeParse({ ...base, entityId: HOST_ID, timeRange: '3h' }).success).toBe(false)
  })
})

describe('CA2 (0031): entrada de entities:processGroupMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:processGroupMetrics']
    expect(entry, 'canal entities:processGroupMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }
  const GROUP_ID = 'PROCESS_GROUP-0123456789ABCDEF'

  it('acepta un PROCESS_GROUP con 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: GROUP_ID }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: GROUP_ID,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['un host', 'HOST-0123456789ABCDEF'],
    ['un servicio', 'SERVICE-0123456789ABCDEF'],
    ['una instancia del grupo (un proceso)', 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF'],
    ['un tipo que empieza igual', 'PROCESS_GROUP_X-0123456789ABCDEF'],
    ['un browser monitor', 'SYNTHETIC_TEST-0123456789ABCDEF'],
    ['minúsculas en el id', 'PROCESS_GROUP-0123456789abcdef'],
    ['minúsculas en el tipo', 'process_group-0123456789ABCDEF'],
    ['15 hexadecimales', 'PROCESS_GROUP-0123456789ABCDE'],
    ['17 hexadecimales', 'PROCESS_GROUP-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'PROCESS_GROUP-0123456789ABCDEG'],
    ['comillas', 'PROCESS_GROUP-0123456789ABCDE"'],
    ['paréntesis', 'PROCESS_GROUP-0123456789ABCDE)'],
    ['coma', 'PROCESS_GROUP-0123456789ABCDE,'],
    ['inyección tras un id válido', 'PROCESS_GROUP-0123456789ABCDEF"),type("HOST'],
    ['espacios alrededor', ' PROCESS_GROUP-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    expect(input().safeParse({ ...base, entityId: GROUP_ID, environmentId: 'x' }).success).toBe(
      false
    )
    expect(input().safeParse({ ...base, entityId: GROUP_ID, timeRange: '3h' }).success).toBe(false)
  })
})

describe('CA2 (0033): entrada de entities:applicationMetrics', () => {
  /** El canal aún puede no existir: se busca sin tipos para que el test falle, no la compilación. */
  const input = (): { safeParse: (value: unknown) => { success: boolean } } => {
    const contract = ipcContract as unknown as Record<
      string,
      { input: { safeParse: (value: unknown) => { success: boolean } } } | undefined
    >
    const entry = contract['entities:applicationMetrics']
    expect(entry, 'canal entities:applicationMetrics').toBeDefined()
    return entry!.input
  }
  const base = { environmentId: '00000000-0000-4000-8000-000000000001', timeRange: '2h' }
  const APP_ID = 'APPLICATION-0123456789ABCDEF'

  it('acepta un APPLICATION con 16 hexadecimales en mayúsculas, con rango relativo o absoluto', () => {
    expect(input().safeParse({ ...base, entityId: APP_ID }).success).toBe(true)
    expect(
      input().safeParse({
        ...base,
        entityId: APP_ID,
        timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      }).success
    ).toBe(true)
  })

  it.each([
    ['un host', 'HOST-0123456789ABCDEF'],
    ['un servicio', 'SERVICE-0123456789ABCDEF'],
    ['una acción de usuario', 'APPLICATION_METHOD-0123456789ABCDEF'],
    ['un grupo de acciones', 'APPLICATION_METHOD_GROUP-0123456789ABCDEF'],
    ['una aplicación móvil', 'MOBILE_APPLICATION-0123456789ABCDEF'],
    ['una aplicación personalizada', 'CUSTOM_APPLICATION-0123456789ABCDEF'],
    ['una aplicación en la nube', 'CLOUD_APPLICATION-0123456789ABCDEF'],
    ['un browser monitor', 'SYNTHETIC_TEST-0123456789ABCDEF'],
    ['minúsculas en el id', 'APPLICATION-0123456789abcdef'],
    ['minúsculas en el tipo', 'application-0123456789ABCDEF'],
    ['15 hexadecimales', 'APPLICATION-0123456789ABCDE'],
    ['17 hexadecimales', 'APPLICATION-0123456789ABCDEF0'],
    ['letras que no son hexadecimales', 'APPLICATION-0123456789ABCDEG'],
    ['comillas', 'APPLICATION-0123456789ABCDE"'],
    ['paréntesis', 'APPLICATION-0123456789ABCDE)'],
    ['coma', 'APPLICATION-0123456789ABCDE,'],
    ['inyección tras un id válido', 'APPLICATION-0123456789ABCDEF"),type("HOST'],
    ['espacios alrededor', ' APPLICATION-0123456789ABCDEF '],
    ['vacío', ''],
    ['sin id', undefined]
  ])('rechaza %s', (_case, entityId) => {
    expect(input().safeParse({ ...base, entityId }).success).toBe(false)
  })

  it('rechaza un entorno que no es uuid y un rango que no es el de la app', () => {
    expect(input().safeParse({ ...base, entityId: APP_ID, environmentId: 'x' }).success).toBe(false)
    expect(input().safeParse({ ...base, entityId: APP_ID, timeRange: '3h' }).success).toBe(false)
  })
})
