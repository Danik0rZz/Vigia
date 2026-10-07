---
id: '0006'
titulo: 'SERVICE: exploración en vivo y canal de métricas del servicio (series y marcadores)'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0006-servicio-datos-metricas
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/query` (`metricSelector` hasta 10 métricas, `resolution`, `from`, `to`, `entitySelector`) y `GET /metrics/{metricId}` (unidad y `resolutionInfSupported`); `..\API\Dynatrace Environment APIv2\APIv2.json`. Transformaciones (`splitBy`, `median`, `percentile`, `fold`) en la documentación oficial de Dynatrace, "Metrics selector transformations" (enlace de la propia OpenAPI). Scope `metrics.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio» (fichas 0006 a 0010). Dani, sobre la página de análisis de una entidad SERVICE
(ficha 0003, hoy en construcción):

"Vamos a montar la de SERVICE." Con un ejemplo como el de Dynatrace («Request metrics»: cuatro
gráficos en rejilla de 2×2) y estos detalles:

- **Tiempos:** 3 series, «AVG», p90 y p99.
- **Actividad:** agrupada en OK y KO.
- **Errores:** la actividad KO.
- **Tasa de error.**

Las métricas que dio (con el id del servicio en un `filter(eq("dt.entity.service", …))` y
`splitBy("dt.entity.service")`; el id no se copia aquí):

- Tiempos: `builtin:service.response.server` con `:median`, `:percentile(90.0)` y
  `:percentile(99.0)`.
- Actividad OK: `builtin:service.requestCount.server`. KO: `builtin:service.errors.server.count`.
- Errores: `builtin:service.errors.server.count`.
- Tasa de error: `builtin:service.errors.server.rate`.

"Para tener un cuadro de mandos chulo, podríamos mostrar arriba de la página a modo de marcadores el
total de peticiones OK, KO, tiempos de respuesta y problemas abiertos y cerrados para esa entidad
(`/api/v2/problems?problemSelector=affectedEntities("<id>")`), ligada al timeframe seleccionado en
la aplicación. Para las cajas de arriba, ojo con la consulta a métricas: seguramente haya que poner
`:fold` para que haga un sum en las que aplique (peticiones OK y KO); en las demás basta con sacar el
dato."

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote:** tiempos con **mediana**, p90 y p99 (no la
media); OK = total − KO; marcador de tasa de error del rango (KO / total); la franja de problemas
sobre la tasa de error va en este lote (ficha 0010). Dani autoriza las lecturas de solo lectura del
tenant de pruebas que hagan falta para validar (`npm run test:live`).

Esta ficha trae los datos de las métricas a main; la interfaz va en la 0008 (marcadores) y la 0009
(gráficos), y los problemas en la 0007.

**Paso 0, exploración en vivo (solo lectura).** El test-writer escribe
`src/main/modules/service-metrics-explore.live.test.ts`, con el patrón de
`problems-event-metric.live.test.ts`: coge como mucho 3 servicios de los que aparecen como entidad
afectada en los problemas de los últimos 7 días (o `entitySelector=type("SERVICE")` con
`pageSize` pequeño si hiciera falta) y, con el rango por defecto (`now-2h`) y con `now-7d`, mira:

- la `unit` de las cuatro métricas en `GET /metrics/{metricId}` y si admiten `resolution=Inf`;
- que una sola consulta con las 6 expresiones de series (3 de tiempos, peticiones, errores y tasa)
  separadas por comas da 200 y en qué orden vuelven los resultados;
- que la versión con `entitySelector=entityId("<id>")` y la del filtro por
  `dt.entity.service` (como en la petición) devuelven lo mismo;
- para los marcadores: `:fold(sum)` en peticiones y errores frente a `resolution=Inf` (si coinciden),
  y para los tiempos `resolution=Inf` frente a `:fold(avg)`;
- si `requestCount.server` incluye las peticiones con error (comparando con `errors.server.count`
  y `errors.server.rate`);
- si llegan `null` en las series y qué `resolution` devuelve en 2 h y en 7 días.

El informe (`live-reports/`, ignorado) guarda solo comportamientos: unidades, códigos, si coinciden,
órdenes y tramos. Nunca ids, nombres ni valores. Lo que salga va a "Resultado" y a una sección
nueva de `docs/notas-api-v2.md` (doc-writer).

**Canal IPC nuevo `entities:serviceMetrics`** (`src/shared/ipc.ts`, con esquema Zod de entrada y de
salida):

- Entrada: `environmentId`, `entityId` y `timeRange` (el `timeRangeSchema` de siempre: el rango
  global de la app).
- `entityId` se valida con `^SERVICE-[0-9A-F]{16}$` en el esquema. Main construye los selectores con
  ese id ya validado; la interfaz nunca manda un selector. Motivo: el id viene de la ruta, que se
  puede escribir a mano, y así no se puede inyectar nada en el selector.
- Main hace **dos** `GET /metrics/query`:
  1. **Series:** las 6 expresiones en una consulta, con la resolución que elige la API para el
     rango (sin `resolution`; unos 120 puntos).
  2. **Marcadores:** total de peticiones y de errores (`:fold(sum)`, o `resolution=Inf` si la
     exploración dice que es lo mismo), y los tres tiempos del rango completo (`resolution=Inf` si
     la métrica lo admite; si no, `:fold(avg)`). Lo que se elija queda en "Resultado".
- Salida (nombres orientativos): `resolution` (la devuelta), `series` con `responseTime`
  (`median`, `p90`, `p99`), `requests`, `errors` y `errorRate` (cada una `timestamps` y `values`
  con `null` donde no hay dato), y `totals` con `requests`, `errors`, `ok`
  (`requests − errors`, nunca negativo), `errorRate` (`errors / requests`, `null` si no hay
  peticiones) y `responseTime` (`median`, `p90`, `p99`). Más `warnings` y `partial`, como
  `metrics:query`.
- **OK y KO:** `requestCount.server` cuenta todas las peticiones, también las fallidas (se confirma
  en el paso 0). Por eso OK = total − errores, punto a punto y en el total, y así las barras
  apiladas de la 0009 suman el total real. Si el paso 0 dice lo contrario, OK = `requestCount` tal
  cual y se anota.
- **Unidades:** los tiempos llegan de Dynatrace en la unidad que diga el descriptor (se espera
  microsegundos) y main los manda en **milisegundos**; la tasa, en porcentaje (0–100). Fijado en
  código y con test; el paso 0 lo confirma.
- Errores con `reason` (ADR-0005). Un servicio sin datos devuelve series vacías y totales a 0 o
  `null`, no un error.
- Sin refresco solo (ADR-0004): la clave de TanStack Query es entorno + entidad + rango.
- El simulador de los e2e (`e2e/`) aprende a responder a estas consultas con datos inventados.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): `service-metrics-explore.live.test.ts` genera su informe con lo del
  paso 0 y ningún valor del informe contiene un id o un nombre observado. Se salta sin
  `.env.live.local`.
- CA2 (unitario, shared): el esquema de entrada acepta `SERVICE-` + 16 hexadecimales en mayúsculas
  y rechaza otro tipo, minúsculas, longitudes distintas y caracteres como `"`, `)` o `,`.
- CA3 (unitario, main): con un `fetch` simulado, se hacen exactamente dos peticiones a
  `/metrics/query`; la de series lleva las 6 expresiones y la de marcadores las suyas, todas con el
  id del servicio y el `from`/`to` del rango pedido (relativo y absoluto).
- CA4 (unitario, main): la respuesta simulada se transforma en `series` y `totals`: OK = total −
  errores (punto a punto y en total, nunca negativo), tasa total `null` sin peticiones, `null`
  conservados en las series, tiempos convertidos a ms y `resolution` la devuelta.
- CA5 (unitario, main): un 400 o 404 de Dynatrace acaba en error con `reason`; una respuesta sin
  resultados acaba en series vacías y totales a 0 o `null`.
- CA6 (unitario, main): `warnings` y los resultados recortados (`dataPointCountRatio` o
  `dimensionCountRatio` < 1) llegan en `warnings` y `partial`.
- CA7 (e2e): el simulador responde a `entities:serviceMetrics` y un test lo llama por IPC con un id
  inventado y recibe las series y los totales esperados.

## Pruebas a mano para Dani

(las de la 0008 y la 0009: esta ficha no tiene interfaz)

## Fuera de alcance

- La interfaz (0008 y 0009) y los problemas de la entidad (0007).
- Otros tipos de entidad.
- Métricas por endpoint (`dt.entity.service_method`) o por clave de petición.
- Elegir la resolución a mano en esta página.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

**Tests (commit `f62a5b2`).** Fallan por falta del canal, no por el propio test (vitest: 28
fallos «canal/implementación de entities:serviceMetrics» indefinida; e2e: `UNKNOWN_CHANNEL`).

- CA1 → `src/main/modules/service-metrics-explore.live.test.ts`, «CA1 (0006): el informe no
  contiene ningún id ni nombre observado» (pasa; 33 GET, mediana 342 ms; se salta sin
  `.env.live.local`).
- CA2 → `src/shared/ipc.test.ts`, describe «CA2 (0006): entrada de entities:serviceMetrics».
- CA3 → `src/main/ipc/handlers/service-metrics.test.ts`, «CA3 (0006): dos consultas a
  /metrics/query con el id y el rango pedidos» (rango relativo y absoluto).
- CA4, CA5 y CA6 → el mismo fichero, describes «CA4 (0006)», «CA5 (0006)» y «CA6 (0006)».
- CA7 → `e2e/views.spec.ts`, «CA7 (0006): entities:serviceMetrics por IPC con un id inventado…»
  (simulador: `serviceMetricResponse`, id `SERVICE-00000000000E2E01`).
- Además, `modules.test.ts` («todos los canales de módulos») llama al canal nuevo.

**Nombres que fijan los tests (la ficha los daba como orientativos).** El canal se implementa en
`createModuleHandlers` (`src/main/ipc/handlers/modules.ts`). Salida: `resolution`;
`series.responseTime.{median,p90,p99}`, `series.requests`, `series.errors`, `series.ok`
(OK punto a punto) y `series.errorRate`, cada una `{ timestamps, values }`; `totals.requests`,
`totals.errors`, `totals.ok`, `totals.errorRate` (en %, `errors / requests × 100`) y
`totals.responseTime.{median,p90,p99}` (ms); `warnings` y `partial` con la forma de
`metrics:query`. Sin datos: series `{ timestamps: [], values: [] }`, totales de recuento a 0 y
el resto a `null`. OK con peticiones `null` en un punto → `null`.

**Paso 0, exploración en vivo (2026-10-07, 3 servicios afectados por problemas de 7 días, now-2h y
now-7d; informe en `live-reports/service-metrics-explore.json`).**

- Descriptores: `response.server` en `MicroSecond` (agregación por defecto `avg`; admite
  `median` y `percentile`); `requestCount.server` y `errors.server.count` en `Count`
  (agregación `value`); `errors.server.rate` en `Percent` (0–100). Las cuatro con
  `resolutionInfSupported: true` y `fold` entre sus transformaciones.
- Las 6 expresiones de series en una consulta (filtro `dt.entity.service` + `splitBy`): 200, un
  resultado por expresión **en el orden pedido**, una serie por resultado y los mismos
  `timestamps` en todas. El `metricId` devuelto **no** es la expresión enviada: Dynatrace le quita
  las comillas al id del filtro (`eq("dt.entity.service",SERVICE-…)`); casar por orden o
  normalizando. Sin `warnings`.
- Resolución sin `resolution`: `1m` en 2 h (10–150 puntos) y `1h` en 7 días (151–1000 puntos).
  Ningún `null` en las series de la muestra (tampoco en errores: llegan 0).
- `entitySelector=entityId("<id>")` sin filtro devuelve exactamente lo mismo que el filtro por
  `dt.entity.service` (valores y resolución).
- Marcadores: `:fold(sum)` (sin `resolution`) = suma de los puntos de la serie. `resolution=Inf`
  coincide con `:fold(sum)` en 2 h, pero **no en 7 días** (peticiones < 1 % de diferencia, errores
  ≥ 1 %). Tiempos: `resolution=Inf` y `:fold(avg)` dan valores distintos (≥ 1 %), como se espera
  (mediana del rango frente a media de medianas). **`:fold(...)` con `resolution=Inf` en la misma
  consulta da 400.** Con `resolution=Inf`, la tasa coincide con `errores / peticiones × 100`.
- OK/KO: errores ≤ peticiones en todos los puntos y en el total, y tasa = errores / peticiones ×
  100 → `requestCount.server` **incluye** las peticiones con error (OK = total − errores).
- `dataPointCountRatio` y `dimensionCountRatio` llegan **siempre**, entre 0 y 0,01, en respuestas
  normales (la OpenAPI: puntos pedidos / máximo permitido por consulta). Ver la nota de abajo.
- `tokenEnLog: false`; ningún id ni nombre en el informe (CA1).

**Para el Orquestador (no reinterpretado en los tests).**

1. Con dos consultas no se puede tener a la vez `:fold(sum)` en los recuentos y `resolution=Inf`
   en los tiempos (400). CA3 acepta, por cada marcador, recuentos con `:fold(sum)` o
   `resolution=Inf` y tiempos con `resolution=Inf` o `:fold(avg)`, pero no las dos cosas en la
   misma consulta; elegir (todo `Inf`, todo `fold`, o una tercera consulta, que CA3 no admite).
2. CA6 está escrito como «ratio < 1 = recortado», igual que `metrics:query`; en vivo los ratios son
   siempre < 0,01, así que con esa regla toda respuesta real saldría `partial`. El test sigue la
   ficha; el simulador de los e2e no manda ratios.

## Resultado

(pendiente)
