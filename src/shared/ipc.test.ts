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
