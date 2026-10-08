import { describe, expect, it } from 'vitest'
import { isHiddenPropertyKey, withoutHiddenValues } from './entity-secrets'

/** Ficha 0029: claves y formas que no salen de main (el criterio CA1 está en entity-detail). */
describe('entity-secrets (0029)', () => {
  it('reconoce las claves de línea de comandos, argumentos, entorno y rutas, con cualquier forma de escribirlas', () => {
    for (const key of [
      'COMMAND_LINE_ARGS',
      'EXE_PATH',
      'DOTNET_COMMAND',
      'DOTNET_COMMAND_PATH',
      'commandLine',
      'processCmdLine',
      'environmentVariables',
      'ENV_VARS',
      'args',
      'Arguments',
      'env'
    ]) {
      expect(isHiddenPropertyKey(key), key).toBe(true)
    }
  })

  it('deja las demás claves', () => {
    for (const key of [
      'EXE_NAME',
      'KUBERNETES_NAMESPACE',
      'detectedName',
      'listenPorts',
      'applicationEnvironment',
      'metadata'
    ]) {
      expect(isHiddenPropertyKey(key), key).toBe(false)
    }
  })

  it('quita entradas { key, value } de listas y campos de objetos, también anidados', () => {
    expect(
      withoutHiddenValues([
        { key: 'COMMAND_LINE_ARGS', value: 'x' },
        { key: 'EXE_NAME', value: 'app' },
        'texto',
        { nested: { commandLine: 'y', name: 'n' } }
      ])
    ).toEqual([{ key: 'EXE_NAME', value: 'app' }, 'texto', { nested: { name: 'n' } }])
  })

  it('más allá de la profundidad máxima no deja objetos ni listas (tampoco se pasarían a texto)', () => {
    expect(withoutHiddenValues({ a: { b: { c: { d: { commandLine: 'z' } } } } })).toEqual({
      a: { b: { c: { d: null } } }
    })
    expect(withoutHiddenValues([[[[['z']]]]])).toEqual([[[[null]]]])
    expect(withoutHiddenValues(7)).toBe(7)
  })
})
