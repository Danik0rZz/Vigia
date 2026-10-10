import type { HostBreakdownResult, HostDisk, HostProcess } from '@shared/modules'
import {
  descending,
  firstValue,
  lastValue,
  mergeMeta,
  namesOf,
  seriesByDimension
} from './metric-series'
import type { MetricData } from './metrics'

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

function toDisks(series: MetricData, range: MetricData): HostDisk[] {
  const pct = seriesByDimension(series, 0, DISK_DIM)
  const used = seriesByDimension(series, 1, DISK_DIM)
  const avail = seriesByDimension(series, 2, DISK_DIM)
  const pctMax = seriesByDimension(range, 0, DISK_DIM)
  const read = seriesByDimension(range, 1, DISK_DIM)
  const write = seriesByDimension(range, 2, DISK_DIM)
  const names = namesOf([pct, used, avail, pctMax, read, write])
  const disks = [...names].map(([id, name]) => ({
    id,
    name,
    usedPct: { last: lastValue(pct.get(id)?.values), max: firstValue(pctMax.get(id)?.values) },
    used: lastValue(used.get(id)?.values),
    avail: lastValue(avail.get(id)?.values),
    read: firstValue(read.get(id)?.values),
    write: firstValue(write.get(id)?.values)
  }))
  // Del más lleno ahora (último dato de uso) al menos; sin uso, al final.
  return disks.sort((a, b) => descending(a.usedPct.last, b.usedPct.last))
}

function toProcesses(range: MetricData): HostBreakdownResult['processes'] {
  const cpuAvg = seriesByDimension(range, 0, PROCESS_DIM)
  const cpuMax = seriesByDimension(range, 1, PROCESS_DIM)
  const memory = seriesByDimension(range, 2, PROCESS_DIM)
  const names = namesOf([cpuAvg, cpuMax, memory])
  const all: HostProcess[] = [...names].map(([id, name]) => ({
    id,
    name,
    cpu: { avg: firstValue(cpuAvg.get(id)?.values), max: firstValue(cpuMax.get(id)?.values) },
    memory: firstValue(memory.get(id)?.values)
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
  return {
    disks: toDisks(diskSeries, diskRange),
    processes: toProcesses(processRange),
    ...mergeMeta([diskSeries, diskRange, processRange])
  }
}
