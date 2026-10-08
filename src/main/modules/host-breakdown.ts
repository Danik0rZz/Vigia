import type { HostBreakdownResult, HostDisk, HostProcess } from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Discos y procesos de una entidad HOST (ficha 0017, canal `entities:hostBreakdown`).
 * Lo observado en vivo (paso 0 de la ficha 0017):
 * - discos: con `entitySelector=entityId("<id>")`, una serie por disco y métrica, en
 *   el orden pedido; `bytesRead` y `bytesWritten` pueden traer discos que no están
 *   en `usedPct`, `used` y `avail`;
 * - procesos: las métricas de proceso no tienen la dimensión `dt.entity.host`; solo
 *   los limita al host el entitySelector por relación `isProcessOf`;
 * - los nombres llegan en `dimensionMap` («<dimensión>.name») solo con `:names`;
 * - `:last` (y `:fold`) con `resolution=Inf` dan 400: el último dato sale del último
 *   punto con dato de la serie, que a menudo acaba en null;
 * - unidades: % en 0–100, bytes y bytes/s; se entregan sin convertir.
 */

const DISK_PCT = 'builtin:host.disk.usedPct'
const DISK_USED = 'builtin:host.disk.used'
const DISK_AVAIL = 'builtin:host.disk.avail'
const DISK_READ = 'builtin:host.disk.bytesRead'
const DISK_WRITE = 'builtin:host.disk.bytesWritten'
const PROC_CPU = 'builtin:tech.generic.cpu.usage'
const PROC_MEM = 'builtin:tech.generic.mem.workingSetSize'

const DISK_DIM = 'dt.entity.disk'
const PROCESS_DIM = 'dt.entity.process_group_instance'

/** Cuántos procesos se devuelven (decisión de Dani al aprobar el lote «host»). */
export const TOP_PROCESSES = 10

/**
 * entitySelector de los procesos del host, por relación. El id ya viene validado
 * por `hostEntityIdSchema` (HOST- y 16 hexadecimales): no puede cerrar la comilla
 * ni el paréntesis.
 */
export function hostProcessSelector(entityId: string): string {
  return `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${entityId}"))`
}

/** Consulta 1 (series de disco, sin Inf), en este orden: uso, usados y libres. */
export const DISK_SERIES_SELECTOR = [DISK_PCT, DISK_USED, DISK_AVAIL]
  .map((metric) => `${metric}:names`)
  .join(',')

/** Consulta 2 (disco, con `resolution=Inf`), en este orden: uso máximo, lectura y escritura. */
export const DISK_RANGE_SELECTOR = [`${DISK_PCT}:max`, `${DISK_READ}:avg`, `${DISK_WRITE}:avg`]
  .map((expression) => `${expression}:names`)
  .join(',')

/** Consulta 3 (procesos, con `resolution=Inf`), en este orden: CPU media y máxima y memoria. */
export const PROCESS_RANGE_SELECTOR = [`${PROC_CPU}:avg`, `${PROC_CPU}:max`, `${PROC_MEM}:avg`]
  .map((expression) => `${expression}:names`)
  .join(',')

interface Entry {
  name: string | null
  values: (number | null)[]
}

/**
 * Las series del resultado en la posición `index`, por id de la dimensión. Una
 * serie sin el id se descarta.
 */
function byEntity(data: MetricData, index: number, dimension: string): Map<string, Entry> {
  const entries = new Map<string, Entry>()
  for (const series of data.result[index]?.data ?? []) {
    const id = series.dimensionMap[dimension]
    if (id === undefined || id === '') continue
    entries.set(id, {
      name: series.dimensionMap[`${dimension}.name`] ?? null,
      values: series.values
    })
  }
  return entries
}

/** Valor del último punto con dato; null si no hay ninguno. */
function lastValue(values: (number | null)[] | undefined): number | null {
  for (let i = (values?.length ?? 0) - 1; i >= 0; i -= 1) {
    const value = values?.[i]
    if (value !== null && value !== undefined) return value
  }
  return null
}

/** Único valor de una serie de un punto (consulta con `resolution=Inf`). */
function single(values: (number | null)[] | undefined): number | null {
  return values?.[0] ?? null
}

/** Ids de todas las series, en el orden en que aparecen, y su nombre (el primero que llegue). */
function entitiesOf(maps: Map<string, Entry>[]): Map<string, string> {
  const names = new Map<string, string | null>()
  for (const map of maps) {
    for (const [id, entry] of map) {
      if (!names.has(id) || names.get(id) === null) names.set(id, entry.name)
    }
  }
  return new Map([...names].map(([id, name]) => [id, name ?? id]))
}

/** De mayor a menor; los null, al final. `sort` es estable: los empates guardan el orden. */
function descending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return b - a
}

function toDisks(series: MetricData, range: MetricData): HostDisk[] {
  const pct = byEntity(series, 0, DISK_DIM)
  const used = byEntity(series, 1, DISK_DIM)
  const avail = byEntity(series, 2, DISK_DIM)
  const pctMax = byEntity(range, 0, DISK_DIM)
  const read = byEntity(range, 1, DISK_DIM)
  const write = byEntity(range, 2, DISK_DIM)
  const names = entitiesOf([pct, used, avail, pctMax, read, write])
  const disks = [...names].map(([id, name]) => ({
    id,
    name,
    usedPct: { last: lastValue(pct.get(id)?.values), max: single(pctMax.get(id)?.values) },
    used: lastValue(used.get(id)?.values),
    avail: lastValue(avail.get(id)?.values),
    read: single(read.get(id)?.values),
    write: single(write.get(id)?.values)
  }))
  // Del más lleno ahora (último dato de uso) al menos; sin uso, al final.
  return disks.sort((a, b) => descending(a.usedPct.last, b.usedPct.last))
}

function toProcesses(range: MetricData): HostBreakdownResult['processes'] {
  const cpuAvg = byEntity(range, 0, PROCESS_DIM)
  const cpuMax = byEntity(range, 1, PROCESS_DIM)
  const memory = byEntity(range, 2, PROCESS_DIM)
  const names = entitiesOf([cpuAvg, cpuMax, memory])
  const all: HostProcess[] = [...names].map(([id, name]) => ({
    id,
    name,
    cpu: { avg: single(cpuAvg.get(id)?.values), max: single(cpuMax.get(id)?.values) },
    memory: single(memory.get(id)?.values)
  }))
  all.sort((a, b) => descending(a.cpu.avg, b.cpu.avg))
  return { items: all.slice(0, TOP_PROCESSES), total: all.length }
}

/** Junta las tres respuestas (series de disco, disco con Inf y procesos con Inf). */
export function toHostBreakdown(
  diskSeries: MetricData,
  diskRange: MetricData,
  processRange: MetricData
): HostBreakdownResult {
  const responses = [diskSeries, diskRange, processRange]
  return {
    disks: toDisks(diskSeries, diskRange),
    processes: toProcesses(processRange),
    warnings: [...new Set(responses.flatMap((data) => data.warnings ?? []))],
    partial: responses.flatMap(truncatedResults)
  }
}
