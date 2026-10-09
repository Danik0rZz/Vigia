import { describe, expect, it } from 'vitest'
import type { HostLogProcess } from '@shared/modules'
import { fileStatusKey, fileStatusTone, sortLogProcesses, sourceStateKey } from './host-logs'

/** Ficha 0041: textos, tonos y orden de la tarjeta «Logs» del host. */
const process = (id: string, name: string, lastUpdate: number | null): HostLogProcess => ({
  id: `PROCESS_GROUP_INSTANCE-00000000000000${id}`,
  name,
  fileStatus: null,
  sourceState: null,
  lastUpdate,
  logCount: 1
})

describe('host-logs (0041)', () => {
  it('los estados conocidos tienen su texto; los demás, «unknown»', () => {
    expect(fileStatusKey('FILE_STATUS_OK')).toBe('FILE_STATUS_OK')
    expect(fileStatusKey('FILE_STATUS_NUEVO')).toBe('unknown')
    expect(fileStatusKey(null)).toBe('unknown')
    expect(sourceStateKey('LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE')).toBe(
      'LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE'
    )
    expect(sourceStateKey('OTRO')).toBe('unknown')
    expect(sourceStateKey(null)).toBe('unknown')
  })

  it('el tono distingue el fichero que se lee, el que no existe y el que ya no se monitoriza', () => {
    expect(fileStatusTone('FILE_STATUS_OK')).toBe('ok')
    expect(fileStatusTone('FILE_STATUS_NOT_EXIST')).toBe('error')
    expect(fileStatusTone('FILE_STATUS_NOT_MONITORED_ANY_MORE')).toBe('warning')
    expect(fileStatusTone(null)).toBe('neutral')
  })

  it('los más recientes primero, sin fecha al final y, a igual fecha, por nombre', () => {
    const sorted = sortLogProcesses(
      [
        process('01', 'b', 10),
        process('02', 'sin-fecha', null),
        process('03', 'a', 10),
        process('04', 'c', 20)
      ],
      'es'
    )
    expect(sorted.map((p) => p.name)).toEqual(['c', 'a', 'b', 'sin-fecha'])
  })
})
