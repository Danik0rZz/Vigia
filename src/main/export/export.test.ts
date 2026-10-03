import { describe, expect, it } from 'vitest'
import { resolveExportDir } from './export-dir'
import { buildCsv, buildTxt, exportFileName } from './index'

/**
 * Exportación de tablas (spec, "Exportación de datos"). ACEPTACIÓN DE LA FASE 6:
 * CSV con BOM, separador configurable y fórmulas neutralizadas.
 */

type Column = { key: string; header: string; type: 'string' | 'number' | 'date' }

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const T = Date.UTC(2026, 9, 3, 10, 5, 0)

const columns: Column[] = [
  { key: 'name', header: 'Nombre', type: 'string' },
  { key: 'value', header: 'Valor', type: 'number' },
  { key: 'when', header: 'Fecha', type: 'date' }
]

/** Texto del CSV sin BOM, en líneas (CRLF). */
function csvLines(buffer: Buffer): string[] {
  const text = buffer.subarray(3).toString('utf8')
  return text.split('\r\n').filter((line, i, all) => !(i === all.length - 1 && line === ''))
}

describe('buildCsv', () => {
  it('empieza por el BOM de UTF-8 y conserva acentos y eñes', () => {
    const buffer = buildCsv(columns, [{ name: 'Año de España', value: 1, when: T }], {
      separator: ';'
    })
    expect(buffer.subarray(0, 3).equals(BOM)).toBe(true)
    expect(buffer.toString('utf8')).toContain('Año de España')
  })

  it('separa con ; y usa CRLF, sin saltos de línea sueltos', () => {
    const buffer = buildCsv(
      columns,
      [
        { name: 'a', value: 1, when: T },
        { name: 'b', value: 2, when: T }
      ],
      { separator: ';' }
    )
    expect(csvLines(buffer)).toEqual([
      'Nombre;Valor;Fecha',
      'a;1;2026-10-03T10:05:00.000Z',
      'b;2;2026-10-03T10:05:00.000Z'
    ])
    expect(buffer.toString('utf8').replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('separa con , si se configura', () => {
    expect(
      csvLines(buildCsv(columns, [{ name: 'a', value: 1, when: null }], { separator: ',' }))
    ).toEqual(['Nombre,Valor,Fecha', 'a,1,'])
  })

  it('las fechas salen en ISO 8601 UTC, vengan en ms o en ISO; null sale vacío', () => {
    const lines = csvLines(
      buildCsv(
        columns,
        [
          { name: 'ms', value: null, when: T },
          { name: 'iso', value: null, when: '2026-10-03T12:05:00+02:00' },
          { name: 'vacía', value: null, when: null }
        ],
        { separator: ';' }
      )
    )
    expect(lines.slice(1)).toEqual([
      'ms;;2026-10-03T10:05:00.000Z',
      'iso;;2026-10-03T10:05:00.000Z',
      'vacía;;'
    ])
  })

  describe('comillas RFC 4180', () => {
    it.each([
      ['el separador', 'a;b', '"a;b"'],
      ['comillas, que se duplican', 'dice "hola"', '"dice ""hola"""'],
      ['un salto de línea', 'línea1\nlínea2', '"línea1\nlínea2"'],
      ['un retorno de carro', 'a\rb', '"a\rb"']
    ])('entrecomilla un valor con %s', (_case, value, expected) => {
      const text = buildCsv([columns[0] as Column], [{ name: value }], { separator: ';' })
        .subarray(3)
        .toString('utf8')
      expect(text.split('\r\n')[1]).toBe(expected)
    })

    it('con separador , entrecomilla las comas pero no los ;', () => {
      const lines = csvLines(
        buildCsv([columns[0] as Column], [{ name: 'a,b' }, { name: 'a;b' }], { separator: ',' })
      )
      expect(lines.slice(1)).toEqual(['"a,b"', 'a;b'])
    })
  })

  describe('neutralización de fórmulas (OWASP)', () => {
    it.each([
      ['=', '=SUMA(A1:A9)', "'=SUMA(A1:A9)"],
      ['+', '+34 600 000 000', "'+34 600 000 000"],
      ['-', '-rm', "'-rm"],
      ['@', '@SUM(1)', "'@SUM(1)"],
      ['tabulador', '\tx', "'\tx"]
    ])('un texto que empieza por %s lleva apóstrofo delante', (_case, value, expected) => {
      const lines = csvLines(
        buildCsv([columns[0] as Column], [{ name: value }], { separator: ';' })
      )
      expect(lines[1]).toBe(expected)
    })

    it('un texto que empieza por retorno de carro lleva apóstrofo y va entre comillas', () => {
      const text = buildCsv([columns[0] as Column], [{ name: '\rx' }], { separator: ';' })
        .subarray(3)
        .toString('utf8')
      expect(text).toContain(`"'\rx"`)
    })

    it('el apóstrofo va dentro de las comillas cuando además hay que entrecomillar', () => {
      const lines = csvLines(
        buildCsv([columns[0] as Column], [{ name: '=HYPERLINK("http://x";"y")' }], {
          separator: ';'
        })
      )
      expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"";""y"")"`)
    })

    it('un texto con el carácter peligroso en medio no se toca', () => {
      const lines = csvLines(
        buildCsv([columns[0] as Column], [{ name: 'a=b-c+d@e' }], { separator: ';' })
      )
      expect(lines[1]).toBe('a=b-c+d@e')
    })

    it('los números negativos NO se neutralizan', () => {
      const lines = csvLines(
        buildCsv([columns[1] as Column], [{ value: -5 }, { value: 0 }], { separator: ';' })
      )
      expect(lines.slice(1)).toEqual(['-5', '0'])
    })

    it('un número que llega como texto en una columna de texto sí se neutraliza', () => {
      const lines = csvLines(buildCsv([columns[0] as Column], [{ name: '-5' }], { separator: ';' }))
      expect(lines[1]).toBe("'-5")
    })
  })

  describe('decimales según el separador', () => {
    it('con ; la coma es el separador decimal', () => {
      const lines = csvLines(
        buildCsv(
          [columns[1] as Column],
          [{ value: 1.5 }, { value: -1.5 }, { value: 1000 }, { value: 0.25 }],
          { separator: ';' }
        )
      )
      expect(lines.slice(1)).toEqual(['1,5', '-1,5', '1000', '0,25'])
    })

    it('con , el punto es el separador decimal y no se entrecomilla', () => {
      const lines = csvLines(
        buildCsv([columns[1] as Column], [{ value: 1.5 }, { value: -1.5 }], { separator: ',' })
      )
      expect(lines.slice(1)).toEqual(['1.5', '-1.5'])
    })
  })
})

describe('buildTxt', () => {
  const rows = [
    { name: 'Año', value: 1.5, when: T },
    { name: 'servicio-largo', value: -20, when: null }
  ]

  it('es UTF-8 sin BOM', () => {
    const buffer = buildTxt(columns, rows, { tabs: false })
    expect(buffer.subarray(0, 3).equals(BOM)).toBe(false)
    expect(buffer.toString('utf8')).toContain('Año')
  })

  it('alinea las columnas con espacios, con cabecera y una línea de guiones', () => {
    const lines = buildTxt(columns, rows, { tabs: false })
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line: string) => line.length > 0)

    expect(lines).toHaveLength(4)
    expect(lines[1]).toMatch(/^[- ]+$/)
    expect(lines[1]).toContain('-')
    expect(lines.join('\n')).not.toContain('\t')

    // Cada columna empieza en la misma posición en todas las líneas.
    const valueStart = lines[0]?.indexOf('Valor') ?? -1
    const dateStart = lines[0]?.indexOf('Fecha') ?? -1
    expect(valueStart).toBeGreaterThan('servicio-largo'.length - 1)
    expect(lines[2]?.indexOf('1.5')).toBe(valueStart)
    expect(lines[3]?.indexOf('-20')).toBe(valueStart)
    expect(lines[2]?.indexOf('2026-10-03T10:05:00.000Z')).toBe(dateStart)
  })

  it('con tabuladores separa por \\t sin alinear; fechas en ISO UTC y punto decimal', () => {
    const lines = buildTxt(columns, rows, { tabs: true })
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line: string) => line.length > 0)
    expect(lines.map((line: string) => line.split('\t'))).toEqual([
      ['Nombre', 'Valor', 'Fecha'],
      ['Año', '1.5', '2026-10-03T10:05:00.000Z'],
      ['servicio-largo', '-20', '']
    ])
  })
})

describe('exportFileName', () => {
  // Fecha construida en hora local: el resultado no depende de la zona del equipo.
  const date = new Date(2026, 9, 3, 9, 5)
  const name = (client: string, environment = 'Prod', module = 'problems'): string =>
    exportFileName({ client, environment, module, date, ext: 'csv' })

  it('sigue el patrón <cliente>_<entorno>_<módulo>_<AAAAMMDD-HHmm>.<ext> con espacios a _', () => {
    expect(
      exportFileName({
        client: 'Cliente A',
        environment: 'Producción',
        module: 'problems',
        date,
        ext: 'xlsx'
      })
    ).toBe('Cliente_A_Producción_problems_20261003-0905.xlsx')
  })

  it('cambia los caracteres no válidos en Windows y los de control por _', () => {
    expect(name('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j_Prod_problems_20261003-0905.csv')
    expect(name('a\u0001b\u001fc')).toBe('a_b_c_Prod_problems_20261003-0905.csv')
  })

  it('quita puntos y espacios del final de cada trozo', () => {
    expect(name('Cliente. ', 'Prod..')).toBe('Cliente_Prod_problems_20261003-0905.csv')
  })

  it.each(['CON', 'prn', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9'])(
    'añade _ a un trozo que es el nombre reservado %s',
    (reserved) => {
      expect(name(reserved)).toBe(`${reserved}__Prod_problems_20261003-0905.csv`)
    }
  )

  it('no toca nombres que solo empiezan como uno reservado', () => {
    expect(name('CONSOLA')).toBe('CONSOLA_Prod_problems_20261003-0905.csv')
    expect(name('COM10')).toBe('COM10_Prod_problems_20261003-0905.csv')
  })

  it('un trozo vacío (o que queda vacío) pasa a "_"', () => {
    expect(name('')).toBe('__Prod_problems_20261003-0905.csv')
    expect(name('...')).toBe('__Prod_problems_20261003-0905.csv')
  })

  it('rellena mes, día, hora y minuto con ceros', () => {
    expect(
      exportFileName({
        client: 'A',
        environment: 'B',
        module: 'metrics',
        date: new Date(2026, 0, 2, 3, 4),
        ext: 'png'
      })
    ).toBe('A_B_metrics_20260102-0304.png')
  })
})

describe('resolveExportDir', () => {
  it('usa VIGIA_EXPORT_DIR solo sin empaquetar', () => {
    expect(resolveExportDir({ packaged: false, override: 'C:/tmp/export' })).toBe('C:/tmp/export')
    expect(resolveExportDir({ packaged: true, override: 'C:/tmp/export' })).toBeNull()
  })

  it.each([undefined, '', '   '])(
    'sin valor (%j) devuelve null y se usa el diálogo',
    (override) => {
      expect(resolveExportDir({ packaged: false, override })).toBeNull()
    }
  )
})
