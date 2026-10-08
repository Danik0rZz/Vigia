import { describe, expect, it } from 'vitest'
import {
  USAGE_ERROR_PCT,
  USAGE_WARNING_PCT,
  formatBitRate,
  formatByteRate,
  formatBytes,
  formatGigabytes,
  usageBar,
  usageLevel
} from './host-format'

/**
 * Ficha 0018: formato de los marcadores y gráficos de la página de un HOST. Red en bits/s con la
 * unidad adaptada (bit/s, kbit/s, Mbit/s y Gbit/s, de 1000 en 1000) y un decimal desde kbit/s;
 * memoria de bytes a GB (10^9 bytes) con un decimal; separador de miles siempre (ficha 0012) y,
 * sin dato, «—». Umbrales de uso fijos: aviso por encima del 80 % y error por encima del 90 %.
 *
 * Los espacios se normalizan: Intl puede poner un espacio duro (U+00A0 o U+202F) delante de
 * la unidad, y la ficha no fija cuál.
 */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ')

describe('CA4 (0018): unidades de red (bits/s)', () => {
  it('por debajo de 1000, en bit/s y sin decimales', () => {
    expect(plain(formatBitRate(650, 'es'))).toBe('650 bit/s')
    expect(plain(formatBitRate(650, 'en'))).toBe('650 bit/s')
    expect(plain(formatBitRate(0, 'es'))).toBe('0 bit/s')
  })

  it('desde 1000, en kbit/s con un decimal y la coma o el punto del idioma', () => {
    expect(plain(formatBitRate(3600, 'es'))).toBe('3,6 kbit/s')
    expect(plain(formatBitRate(3600, 'en'))).toBe('3.6 kbit/s')
    expect(plain(formatBitRate(1000, 'es'))).toBe('1,0 kbit/s')
  })

  it('desde un millón, en Mbit/s', () => {
    expect(plain(formatBitRate(1_500_000, 'es'))).toBe('1,5 Mbit/s')
    expect(plain(formatBitRate(1_500_000, 'en'))).toBe('1.5 Mbit/s')
    expect(plain(formatBitRate(250_000_000, 'es'))).toBe('250,0 Mbit/s')
  })

  it('desde mil millones, en Gbit/s, con separador de miles si hace falta', () => {
    expect(plain(formatBitRate(2_000_000_000, 'es'))).toBe('2,0 Gbit/s')
    expect(plain(formatBitRate(2_000_000_000, 'en'))).toBe('2.0 Gbit/s')
    expect(plain(formatBitRate(1_234_500_000_000, 'es'))).toBe('1.234,5 Gbit/s')
    expect(plain(formatBitRate(1_234_500_000_000, 'en'))).toBe('1,234.5 Gbit/s')
  })

  it('sin dato, «—» (nunca 0)', () => {
    expect(formatBitRate(null, 'es')).toBe('—')
    expect(formatBitRate(null, 'en')).toBe('—')
  })
})

describe('CA4 (0018): unidades de memoria (bytes a GB)', () => {
  it('en GB (10^9 bytes) con un decimal', () => {
    expect(plain(formatGigabytes(16_000_000_000, 'es'))).toBe('16,0 GB')
    expect(plain(formatGigabytes(16_000_000_000, 'en'))).toBe('16.0 GB')
    expect(plain(formatGigabytes(1_500_000_000, 'es'))).toBe('1,5 GB')
    expect(plain(formatGigabytes(200_000_000, 'en'))).toBe('0.2 GB')
  })

  it('con separador de miles', () => {
    expect(plain(formatGigabytes(1_234_000_000_000, 'es'))).toBe('1.234,0 GB')
    expect(plain(formatGigabytes(1_234_000_000_000, 'en'))).toBe('1,234.0 GB')
  })

  it('sin dato, «—»', () => {
    expect(formatGigabytes(null, 'es')).toBe('—')
    expect(formatGigabytes(null, 'en')).toBe('—')
  })
})

describe('CA5 (0018): umbrales de color de CPU, memoria y disco', () => {
  it('fijos: aviso al 80 % y error al 90 %', () => {
    expect(USAGE_WARNING_PCT).toBe(80)
    expect(USAGE_ERROR_PCT).toBe(90)
  })

  it('hasta el 80 % incluido, normal', () => {
    for (const value of [0, 33.5, 57, 79.9, 80])
      expect(usageLevel(value), `${value}`).toBe('normal')
  })

  it('por encima del 80 % y hasta el 90 % incluido, aviso', () => {
    for (const value of [80.1, 85, 90]) expect(usageLevel(value), `${value}`).toBe('warning')
  })

  it('por encima del 90 %, error', () => {
    for (const value of [90.1, 92, 95, 100]) expect(usageLevel(value), `${value}`).toBe('error')
  })

  it('sin dato, normal (sin color)', () => {
    expect(usageLevel(null)).toBe('normal')
  })
})

/**
 * Ficha 0019: tablas de discos y procesos. Lo que fijan estos tests (decisiones delegadas por
 * Dani, refinables):
 *
 * - `formatBytes(bytes, lang)`: B sin decimales por debajo de 1000 y kB, MB, GB y TB (de 1000 en
 *   1000, como Dynatrace) con un decimal; por encima de 1000 TB se queda en TB. Memoria de los
 *   procesos y tamaños de disco.
 * - `formatByteRate(bytesPerSecond, lang)`: lo mismo con «/s» (B/s, kB/s, MB/s, GB/s y TB/s).
 *   Lectura y escritura de cada disco.
 * - `usageBar(pct, lang)`: la barra de uso de un disco: `{ level, width, text, levelKey }`, con
 *   `level` de `usageLevel` (el color), `width` el ancho en % (0–100, recortado; 0 sin dato),
 *   `text` el % formateado (`formatUsagePct`) y `levelKey` la clave del texto del nivel
 *   (`entities.host.markers.levels.warning` o `.error`, las de la 0018) o null si es normal.
 */
describe('CA1 (0019): lectura y escritura en bytes/s adaptados, y tamaños en bytes', () => {
  it('por debajo de 1000, en B/s sin decimales', () => {
    expect(plain(formatByteRate(0, 'es'))).toBe('0 B/s')
    expect(plain(formatByteRate(300, 'es'))).toBe('300 B/s')
    expect(plain(formatByteRate(800, 'en'))).toBe('800 B/s')
  })

  it('desde 1000, kB/s, MB/s, GB/s y TB/s con un decimal y la coma o el punto del idioma', () => {
    expect(plain(formatByteRate(1500, 'es'))).toBe('1,5 kB/s')
    expect(plain(formatByteRate(1500, 'en'))).toBe('1.5 kB/s')
    expect(plain(formatByteRate(12_000, 'es'))).toBe('12,0 kB/s')
    expect(plain(formatByteRate(2_500_000, 'es'))).toBe('2,5 MB/s')
    expect(plain(formatByteRate(3_000_000_000, 'en'))).toBe('3.0 GB/s')
    expect(plain(formatByteRate(4_000_000_000_000, 'es'))).toBe('4,0 TB/s')
  })

  it('el redondeo no deja «1000,0» en la unidad pequeña', () => {
    expect(plain(formatByteRate(999_960, 'es'))).toBe('1,0 MB/s')
  })

  it('tamaños: B, kB, MB, GB y TB con un decimal desde 1000, y separador de miles', () => {
    expect(plain(formatBytes(512, 'es'))).toBe('512 B')
    expect(plain(formatBytes(300_000_000, 'es'))).toBe('300,0 MB')
    expect(plain(formatBytes(750_000_000, 'en'))).toBe('750.0 MB')
    expect(plain(formatBytes(455_000_000_000, 'es'))).toBe('455,0 GB')
    expect(plain(formatBytes(2_000_000_000_000, 'es'))).toBe('2,0 TB')
    expect(plain(formatBytes(1_234_000_000_000_000, 'es'))).toBe('1.234,0 TB')
  })

  it('sin dato, «—» (nunca 0)', () => {
    expect(formatByteRate(null, 'es')).toBe('—')
    expect(formatBytes(null, 'en')).toBe('—')
  })
})

describe('CA5 (0019): color y texto de la barra de uso según el % (umbrales 80 y 90)', () => {
  const WARNING = 'entities.host.markers.levels.warning'
  const ERROR = 'entities.host.markers.levels.error'

  it('hasta el 80 % incluido: normal, sin texto de nivel', () => {
    for (const pct of [0, 40, 80]) {
      const bar = usageBar(pct, 'es')
      expect(bar.level, `${pct}`).toBe('normal')
      expect(bar.levelKey, `${pct}`).toBeNull()
      expect(bar.width, `${pct}`).toBe(pct)
    }
    expect(plain(usageBar(40, 'es').text)).toBe('40 %')
  })

  it('por encima del 80 % y hasta el 90 %: aviso, con su texto', () => {
    for (const pct of [80.1, 85, 90]) {
      const bar = usageBar(pct, 'es')
      expect(bar.level, `${pct}`).toBe('warning')
      expect(bar.levelKey, `${pct}`).toBe(WARNING)
    }
    expect(plain(usageBar(85, 'es').text)).toBe('85 %')
  })

  it('por encima del 90 %: error, con su texto', () => {
    for (const pct of [90.1, 91, 100]) {
      const bar = usageBar(pct, 'es')
      expect(bar.level, `${pct}`).toBe('error')
      expect(bar.levelKey, `${pct}`).toBe(ERROR)
    }
    expect(plain(usageBar(91.5, 'es').text)).toBe('91,5 %')
    expect(plain(usageBar(91.5, 'en').text)).toBe('91.5%')
  })

  it('el ancho se queda entre 0 y 100; sin dato, barra vacía, «—» y normal', () => {
    expect(usageBar(120, 'es').width).toBe(100)
    expect(usageBar(-3, 'es').width).toBe(0)
    expect(usageBar(null, 'es')).toEqual({ level: 'normal', width: 0, text: '—', levelKey: null })
  })
})
