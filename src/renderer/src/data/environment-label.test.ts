import { describe, expect, it } from 'vitest'
import { environmentLabel } from './environment-label'

/**
 * Etiqueta de un entorno en la ruta, el selector, Ctrl+K y Ajustes: el tipo
 * traducido, con el nombre detrás solo si hay más de uno de ese tipo en el
 * mismo cliente; los de tipo "otro" se ven por su nombre.
 */

const TYPE_LABELS: Record<string, string> = {
  production: 'Producción',
  preproduction: 'Preproducción',
  integration: 'Integración',
  development: 'Desarrollo',
  other: 'Otro'
}
const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type

type Env = { id: string; name: string; type: string }
const env = (id: string, name: string, type: string): Env => ({ id, name, type })

describe('environmentLabel', () => {
  it('un único entorno de un tipo se ve por el tipo', () => {
    const prod = env('1', 'PRO-EU', 'production')
    const dev = env('2', 'Local', 'development')
    expect(environmentLabel(prod, [prod, dev], typeLabel)).toBe('Producción')
    expect(environmentLabel(dev, [prod, dev], typeLabel)).toBe('Desarrollo')
  })

  it('si hay dos del mismo tipo, cada uno lleva su nombre detrás', () => {
    const a = env('1', 'A', 'production')
    const b = env('2', 'B', 'production')
    const siblings = [a, b, env('3', 'Pruebas', 'integration')]
    expect(environmentLabel(a, siblings, typeLabel)).toBe('Producción · A')
    expect(environmentLabel(b, siblings, typeLabel)).toBe('Producción · B')
    expect(environmentLabel(siblings[2] as Env, siblings, typeLabel)).toBe('Integración')
  })

  it('los de tipo "otro" se ven siempre por su nombre, aunque haya varios', () => {
    const x = env('1', 'Sandbox', 'other')
    const y = env('2', 'Formación', 'other')
    expect(environmentLabel(x, [x], typeLabel)).toBe('Sandbox')
    expect(environmentLabel(x, [x, y], typeLabel)).toBe('Sandbox')
    expect(environmentLabel(y, [x, y], typeLabel)).toBe('Formación')
  })

  it('cuenta el propio entorno aunque no venga en siblings, y no se cuenta dos veces', () => {
    const prod = env('1', 'PRO', 'production')
    expect(environmentLabel(prod, [], typeLabel)).toBe('Producción')
    expect(environmentLabel(prod, [prod, { ...prod }], typeLabel)).toBe('Producción')
  })

  it('usa la función de traducción recibida (el idioma lo decide quien llama)', () => {
    const prod = env('1', 'PRO', 'production')
    expect(
      environmentLabel(prod, [prod], (type) => (type === 'production' ? 'Production' : type))
    ).toBe('Production')
  })
})
