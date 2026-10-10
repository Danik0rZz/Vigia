/** Nombres reservados de Windows: no pueden usarse como nombre de fichero. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Un trozo del nombre válido en Windows: sin \/:*?"<>|, controles ni espacios o puntos finales. */
function sanitize(part: string): string {
  let text = part
    // Primero los puntos y espacios finales, antes de que los espacios pasen a "_".
    .replace(/[.\s]+$/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s/g, '_')
  if (text === '') text = '_'
  if (RESERVED.test(text)) text = `${text}_`
  return text
}

const two = (value: number): string => String(value).padStart(2, '0')

/** `AAAAMMDD` del día local de `date` (no el de UTC: a las 00:30 en Madrid ya es el día nuevo). */
export function localDateStamp(date: Date): string {
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`
}

/** `<cliente>_<entorno>_<módulo>_<AAAAMMDD-HHmm>.<ext>`, en hora local. */
export function exportFileName(input: {
  client: string
  environment: string
  module: string
  date: Date
  ext: string
}): string {
  const { date } = input
  const stamp = `${localDateStamp(date)}-${two(date.getHours())}${two(date.getMinutes())}`
  return `${[input.client, input.environment, input.module].map(sanitize).join('_')}_${stamp}.${input.ext}`
}
