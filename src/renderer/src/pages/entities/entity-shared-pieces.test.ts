import { describe, expect, it } from 'vitest'

/**
 * Ficha 0058, CA3: las piezas de marcadores y tablas que copiaban las páginas de entidad (host,
 * proceso, process group, disco, monitores, servicio y aplicación) viven en `EntityMarkers.tsx`
 * (`LEVEL_CLASS`, `MarkerBody`, `BigValue`) y `EntityTables.tsx` (`TableCard`). Este test falla si
 * un fichero de la carpeta vuelve a definir alguna por su cuenta.
 */

const sources = import.meta.glob<string>(['./*.tsx', './*.ts', '!./*.test.ts', '!./*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true
})

const SHARED_HOME: Record<string, string> = {
  LEVEL_CLASS: './EntityMarkers.tsx',
  MarkerBody: './EntityMarkers.tsx',
  BigValue: './EntityMarkers.tsx',
  TableCard: './EntityTables.tsx'
}

/** Una definición (no un uso ni un import): `const X`, `function X`, `let X` o `class X`. */
function defines(source: string, name: string): boolean {
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`).test(source)
}

describe('CA3 (0058): nadie vuelve a definir las piezas comunes de las páginas de entidad', () => {
  it('CA3 (0058): cada pieza está exportada desde su fichero común', () => {
    for (const [name, home] of Object.entries(SHARED_HOME)) {
      const source = sources[home]
      expect(source, `${home} no existe`).toBeDefined()
      expect(
        new RegExp(`export\\s+(?:const|function)\\s+${name}\\b`).test(source ?? ''),
        `${name} no se exporta desde ${home}`
      ).toBe(true)
    }
  })

  it('CA3 (0058): ningún otro fichero de pages/entities define LEVEL_CLASS, MarkerBody, BigValue ni TableCard', () => {
    // El recorrido encuentra los ficheros de verdad (si no, el test no probaría nada).
    expect(Object.keys(sources).length).toBeGreaterThan(40)
    expect(sources['./HostMarkers.tsx']).toBeDefined()
    const offenders = Object.entries(sources).flatMap(([path, source]) =>
      Object.entries(SHARED_HOME)
        .filter(([name, home]) => path !== home && defines(source, name))
        .map(([name]) => `${path}: ${name}`)
    )
    expect(offenders).toEqual([])
  })

  it('CA3 (0058): el detector reconoce una definición y no un uso', () => {
    expect(defines('const LEVEL_CLASS: Record<Level, string> = {}', 'LEVEL_CLASS')).toBe(true)
    expect(defines('function MarkerBody({ value }) {}', 'MarkerBody')).toBe(true)
    expect(defines('<BigValue level="error">1</BigValue>', 'BigValue')).toBe(false)
    expect(defines("import { TableCard } from './EntityTables'", 'TableCard')).toBe(false)
  })
})
