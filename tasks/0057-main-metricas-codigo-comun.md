---
id: '0057'
titulo: 'Main: un solo código para consultar y transformar métricas en todos los canales de entidad'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-codigo-comun
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0057-main-metricas-codigo-comun
adrs: [2, 5]
adr_nuevo:
api: ninguna nueva (los mismos endpoints y expresiones de métrica ya probados en vivo)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «auditoria-codigo-comun» (0057 a 0059), de la revisión de código del 2026-10-09 (hallazgo
M-01). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario.

## Especificación

**El problema.** Cuando se hizo la revisión, `src/main/ipc/handlers/modules.ts` repetía seis veces
el mismo patrón (un `query = (metricSelector, resolution?) => client.dtRequest({ path:
'/metrics/query', … })` y un `catch` que reenvuelve `BAD_REQUEST`/`NOT_FOUND` en `DtError` con
`params: { status, detail }`, cambiando solo la clave del `reason`). Los módulos copiaban
`seriesAt`, `single`, `EMPTY`, la mezcla de `warnings`/`partial`, `lastValue`, `byEntity`,
`entitiesOf` y comparadores, con pequeñas diferencias ya (`single` con `undefined` frente a `?? null`).
Desde entonces se han añadido más canales (process group, aplicación, disco, RUM…): **el
developer hace el inventario de todos los canales de métricas de entidad en `main`** y lo anota.
Además, las implementaciones llaman a `repo.getEnvironment(environmentId)` sin usar el resultado,
solo para que lance `NOT_FOUND`.

**Arreglo (sin cambiar el contrato IPC ni ninguna expresión de métrica; `src/main/CLAUDE.md` exige
que cada expresión sea exactamente la probada en vivo):**

- Módulo puro `src/main/modules/metric-series.ts` con `seriesAt`, `singleValue`, `lastValue`,
  `seriesByDimension`, `namesOf`, comparadores y `mergeMeta(responses) => { warnings, partial }`.
  Los módulos se quedan con sus selectores y su transformación.
- En el handler: `createMetricsQuery(client, envId, range)` (devuelve la función `query`),
  `rethrowRejected(error, reasonKey)` (el `catch`) y `repo.requireEnvironment(id)` (nombre que dice
  lo que hace).
- Donde dos copias diferían, se elige un comportamiento y se anota en "Resultado".

## Criterios de aceptación

- CA1 (unitario): `metric-series.test.ts` cubre los bordes: serie vacía, último punto `null`,
  dimensión ausente, avisos duplicados y resultados recortados.
- CA2 (unitario): `rethrowRejected` reenvuelve `BAD_REQUEST` y `NOT_FOUND` con la clave dada y deja
  pasar el resto; `requireEnvironment` lanza `NOT_FOUND`.
- CA3 (unitario): un test de guardia falla si un módulo de `src/main/modules/` vuelve a definir
  `seriesAt`, `single`/`singleValue` o `lastValue` por su cuenta.
- CA4 (unitario y e2e): los tests existentes de todos los canales de métricas de entidad y los e2e
  de las páginas de entidad pasan **sin tocar sus expectativas**.

## Pruebas a mano para Dani

(ninguna: no cambia nada visible)

## Fuera de alcance

- Cambiar expresiones de métrica o el contrato de los canales.

## Ideas surgidas (fuera de alcance)

- (developer) `src/main/ipc/handlers/connection.ts` también llama a `repo.getEnvironment(environmentId)`
  sin usar el resultado (3 veces): podría pasar a `requireEnvironment`.
- (developer) `metrics:query` (el explorador, no es de entidad) sigue con su `dtRequest` propio:
  admite cualquier `resolution`, no solo `Inf`; `createMetricsQuery` podría aceptarla.
- (developer) `instancesOf` (process group) y `topActionsOf` (aplicación) repiten «casar series por
  id de dimensión con su nombre»; no encajan en `seriesByDimension` (juntan dos dimensiones o varios
  resultados en un objeto) y se han dejado como estaban.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Legibilidad] `src/main/modules/service-metrics.ts:139-145`: `inMs` quedó entre el comentario de
   `rateSeries` y la función, con dos JSDoc seguidos (el de arriba no le corresponde) y `rateSeries`
   sin comentario. Mover `inMs` con su comentario por encima o por debajo de `rateSeries`.

Bien: peticiones idénticas (`buildQuery` descarta los `undefined`; mismo orden de parámetros en los
11 canales; mismas expresiones y número de consultas, ≤ 10 por consulta); salida idéntica
(`rethrowRejected` igual que el `catch` anterior; `mergeMeta` conserva el orden); cambios sutiles
equivalentes (`?? null`, `firstValue`, comparadores). Tras `7080d03` solo cambian
`problems.live.test.ts` (`72d2874`, añade `requireEnvironment` sin tocar expectativas) y
`areas.json`; ningún test de los 11 canales. Guardias de CA3 y de `repo.getEnvironment(` reales.

Opcional: recuperar la línea en blanco entre `entities:hostBreakdown` y `entities:hostLogs` en
`handlers/modules.ts`.

## Verificación

Tests escritos en el commit `7080d03` (test-writer, 2026-10-10). Antes se comprobó en `main` que el
problema sigue: `modules.ts` repite el `query` y el `catch` de `BAD_REQUEST`/`NOT_FOUND` en 11
canales y llama 23 veces a `repo.getEnvironment(environmentId)` sin usar el resultado; 9 módulos
definen su `seriesAt`/`single`/`lastValue` (18 definiciones) y 2 su `byEntity`/`entitiesOf`.

- CA1 → `src/main/modules/metric-series.test.ts`: `seriesAt` casa por posición (el `metricId` no
  sirve, ficha 0040), serie vacía, posición fuera de rango o `undefined`; `singleValue` (null y
  nunca `undefined`, 0 es dato); `lastValue` con último punto `null`; `seriesByDimension` con
  dimensión ausente o vacía; `namesOf`; `ascending`/`descending` con los null al final;
  `mergeMeta` con avisos duplicados y recortes (solo ratio > 1, de todas las respuestas).
- CA2 → `src/main/ipc/handlers/metrics-query.test.ts` (`createMetricsQuery` y `rethrowRejected`)
  y `src/main/tenants/require-environment.test.ts` (`requireEnvironment` lanza `NOT_FOUND` con
  `environmentMissing`, más una guardia: ninguna línea de `modules.ts` empieza por
  `repo.getEnvironment(`).
- CA3 → `src/main/modules/metric-series-guard.test.ts`: ningún `.ts` de `src/main/modules/` salvo
  `metric-series.ts` define `seriesAt`, `single`, `singleValue` ni `lastValue`.
- CA4 → los tests existentes, sin tocar: `src/main/ipc/handlers/{service-metrics,
service-metric-set,host-metrics,host-breakdown,process-metrics,process-group-metrics,
disk-metrics,application-metrics,application-rum,monitor-metrics,monitor-breakdown}.test.ts`,
  los de `src/main/modules/` y los e2e de `e2e/views.spec.ts`. El límite de 10 expresiones por
  consulta ya lo vigilan los de host, disco, RUM y conjunto de servicio (el simulador da 400 con
  más): no se añade otro test para eso.

Decisiones del test-writer (Dani las delegó; razonables y refinables):

- `lastValue` recibe la lista de valores (`lastValue(series.values)`), no la serie, para que
  sirva también a los desgloses por dimensión.
- `seriesByDimension(data, index, dimension)` da `Map<id, { name, values }>` (el desglose de
  monitores, que guardaba `value`, usa `singleValue`/`values[0]`); `namesOf(maps)` da
  `Map<id, nombre o id>`.
- Comparadores: `ascending` y `descending`, con los null al final.
- `createMetricsQuery` y `rethrowRejected` van en `src/main/ipc/handlers/metrics-query.ts`.
  `createMetricsQuery(client, envId, range)` mete en la consulta todo lo que traiga `range`: el
  canal con `entitySelector` lo pasa ahí (`{ ...timeRangeToDt(t), entitySelector }`), sin un
  cuarto parámetro.
- `rethrowRejected` siempre lanza (`never`): conserva código, mensaje y estado, y pone
  `params.status` a 0 si no llega estado (como hoy).
- `requireEnvironment` se añade al repositorio; `getEnvironment` sigue para quien usa el
  resultado (servicios, conexión, exportación).

## Resultado

Developer, 2026-10-10. Sin cambios en el contrato IPC ni en las expresiones de métrica.

**Inventario de canales de métricas de entidad en `main`** (los 11 de
`src/main/ipc/handlers/modules.ts`): `entities:serviceMetrics`, `hostMetrics`, `hostBreakdown`,
`processMetrics`, `processGroupMetrics`, `processGroupInstances`, `diskMetrics`,
`applicationMetrics`, `applicationRum`, `monitorMetrics` y `monitorBreakdown`. Sus módulos
(`service-metrics`, `host-metrics`, `host-breakdown`, `process-metrics`, `process-group-metrics`,
`disk-metrics`, `application-metrics`, `application-rum`, `monitor-metrics` y `monitor-breakdown`)
usan ahora `src/main/modules/metric-series.ts`. `metrics:query` (explorador) no es de entidad y no
se toca. Las 23 llamadas sueltas a `repo.getEnvironment` de `modules.ts` son ahora
`repo.requireEnvironment`.

Decisiones (Dani las delegó; razonables y refinables):

- Donde las copias diferían: `single` con `=== undefined ? null` frente a `?? null` daba lo mismo
  (los valores son `number | null`), y `singleValue` usa `?? null`. El `single` del servicio, que
  dividía, es ahora `inMs(singleValue(...), divisor)` en `service-metrics.ts`.
- Se añade `firstValue(values)` a `metric-series.ts` (no estaba en los tests): el primer valor de
  una lista, o null, para los desgloses por dimensión (host, monitor) y RUM, que trabajan con
  listas y no con `(data, index)`. La guardia de CA3 no lo cuenta como copia.
- El desglose del monitor guardaba `value` en su `Entry`; ahora usa `DimensionEntry` (`values`) y
  `firstValue`. Los comparadores en línea con los null al final de `process-group-metrics` y
  `application-metrics` pasan a `descending` (mismo orden, estable).
- `seriesAt` devuelve una serie vacía nueva cada vez (antes, una constante `EMPTY` compartida).
- `createMetricsQuery` conserva el orden de parámetros de la URL que tenía cada canal
  (`metricSelector`, `entitySelector`, `resolution`, `from`, `to`). Los canales con dos ámbitos
  (aplicación y sus acciones; discos y procesos del host) crean dos `query`; el desglose del
  monitor, una por consulta.
- `requireEnvironment` devuelve `void`. La prueba en vivo `problems.live.test.ts` pasaba un
  repositorio simulado con solo `getEnvironment`: se le añade `requireEnvironment` en un commit
  propio (no cambia ninguna expectativa).
- `metrics-query.ts` va en el área de módulos de `e2e/areas.json`.

`npm run check` en verde (3328 tests) y `npm run test:e2e:affected -- main..HEAD`: 353 pasados.
