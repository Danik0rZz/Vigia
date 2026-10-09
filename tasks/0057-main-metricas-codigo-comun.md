---
id: '0057'
titulo: 'Main: un solo código para consultar y transformar métricas en todos los canales de entidad'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
