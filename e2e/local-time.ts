/**
 * Ficha 0011: instante de una hora de pared («2026-10-03T09:00», como la escribe el campo
 * datetime-local) en una zona horaria dada. Los e2e lo usan con la zona del renderer, que es en
 * la que la app interpreta lo escrito: así lo esperado no supone la zona de la máquina (el CI va
 * en UTC y la VPS en Europe/Madrid). Probado en src/test/e2e-support.test.ts.
 */
export function wallTimeToEpoch(wallTime: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wallTime)
  if (match === null) throw new Error(`wallTimeToEpoch: hora no válida: ${wallTime}`)
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number
  ]
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  // Dos pasadas: la diferencia de la zona se mide cerca del instante buscado, por si entre
  // medias hay un cambio de hora.
  const first = asUtc - zoneOffset(asUtc, timeZone)
  return asUtc - zoneOffset(first, timeZone)
}

/** Diferencia (ms) entre la hora de pared de `timeZone` y UTC en el instante `epoch`. */
function zoneOffset(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(epoch))
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second')
  )
  return wall - Math.floor(epoch / 1000) * 1000
}
