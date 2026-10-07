---
id: '0006'
titulo: 'SERVICE: exploración en vivo y canal de métricas del servicio (series y marcadores)'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

## En espera (Orquestador, 2026-10-07)

**Decidido por el Orquestador (diseño dentro de la ficha):** `:fold` y `resolution=Inf` en la misma
consulta dan 400 (paso 0). Los marcadores van así, sin una tercera consulta: los totales de peticiones
y errores, sumando la serie de la consulta 1 (igual que `fold(sum)`, comprobado en vivo); los tres
tiempos del rango, en la consulta 2 con `resolution=Inf` (mediana y percentiles reales del rango, no
una media de medianas). El test-writer ajusta CA3 a esto.

**[ALCANCE] para Dani:** CA6 dice que un ratio < 1 es un resultado recortado, pero la OpenAPI v2
define `dataPointCountRatio` y `dimensionCountRatio` como «pedido / máximo permitido» y en vivo
llegan entre 0 y 0,01: recortado es un ratio > 1. `metrics:query` (Métricas) ya usa la regla
«< 1» (`src/main/modules/metrics.ts:44-52`), así que hoy avisa de «solo parte de los puntos» en casi
todas las consultas reales. Opciones:

1. Corregir CA6 (> 1) y arreglar también Métricas en esta ficha, con un criterio nuevo.
2. Corregir CA6 solo en el canal nuevo y llevar el arreglo de Métricas a una ficha aparte.

**Decisión (2026-10-07):** Dani delegó la decisión en el Orquestador («toma la mejor decisión, es muy
técnica»). Opción 1: es la misma regla en dos sitios y el arreglo es pequeño; con la 2, la app
tendría dos criterios distintos para lo mismo y Métricas seguiría avisando en falso. CA6 corregido,
CA8 nuevo y una prueba a mano para Métricas. La ficha vuelve a `en_desarrollo`.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): `service-metrics-explore.live.test.ts` genera su informe con lo del
  paso 0 y ningún valor del informe contiene un id o un nombre observado. Se salta sin
  `.env.live.local`.
- CA2 (unitario, shared): el esquema de entrada acepta `SERVICE-` + 16 hexadecimales en mayúsculas
  y rechaza otro tipo, minúsculas, longitudes distintas y caracteres como `"`, `)` o `,`.
- CA3 (unitario, main): con un `fetch` simulado, se hacen exactamente dos peticiones a
  `/metrics/query`; la de series lleva las 6 expresiones y la de marcadores los tres tiempos con
  `resolution=Inf` (sin `:fold`: mezclarlos da 400), todas con el id del servicio y el `from`/`to`
  del rango pedido (relativo y absoluto). Los totales de peticiones y errores salen de sumar la
  serie de la primera (igual que `fold(sum)`, comprobado en vivo). (Ajustado el 2026-10-07, ver "En
  espera".)
- CA4 (unitario, main): la respuesta simulada se transforma en `series` y `totals`: OK = total −
  errores (punto a punto y en total, nunca negativo), tasa total `null` sin peticiones, `null`
  conservados en las series, tiempos convertidos a ms y `resolution` la devuelta.
- CA5 (unitario, main): un 400 o 404 de Dynatrace acaba en error con `reason`; una respuesta sin
  resultados acaba en series vacías y totales a 0 o `null`.
- CA6 (unitario, main): `warnings` y los resultados recortados llegan en `warnings` y `partial`.
  Recortado es `dataPointCountRatio` o `dimensionCountRatio` **mayor que 1** (la OpenAPI los define
  como «pedido / máximo permitido»); un ratio de 1 o menos no es recortado. (Corregido el
  2026-10-07: antes decía «< 1».)
- CA7 (e2e): el simulador responde a `entities:serviceMetrics` y un test lo llama por IPC con un id
  inventado y recibe las series y los totales esperados.
- CA8 (unitario, main; arreglo de la app): `metrics:query` (Métricas) usa la misma regla que CA6:
  con ratios entre 0 y 1 (lo normal en vivo) no hay `partial` ni aviso de «solo parte de los
  puntos»; con un ratio mayor que 1, sí. Las dos funciones comparten la regla en un solo sitio.
  (Nuevo el 2026-10-07, ver "En espera".)

## Pruebas a mano para Dani

- (las del servicio, en la 0008 y la 0009: esta ficha no tiene interfaz propia)
- **Arreglado en la app (Métricas):** con una consulta normal de Métricas (por ejemplo, una métrica
  de CPU de los hosts con el rango por defecto) ya no sale el aviso «la API ha devuelto solo parte
  de los puntos». Antes salía en casi todas las consultas aunque no faltara nada.

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

**Para el Orquestador (no reinterpretado en los tests).** Las dos dudas de la primera ronda (CA3
con `fold` e `Inf`, y CA6 con «< 1») están resueltas en "En espera" y en los tests de abajo.

**Tests de los criterios ajustados (commit `14927c8`).** Fallan con el código actual.

- CA3 → «CA3 (0006)» de `service-metrics.test.ts`: la consulta de marcadores lleva solo los tres
  tiempos, con `resolution=Inf` y sin `:fold(`. CA4 comprueba que los totales de peticiones y
  errores son la suma de la serie (el simulador devuelve otros recuentos en los marcadores, por si
  main los pidiera ahí); CA7 (e2e), lo mismo.
- CA6 → «CA6 (0006)» del mismo fichero: un ratio de 1,5 o 2 sale en `partial`; con 0,005 o 1, no.
- CA8 → `src/main/modules/metrics.test.ts`, «CA8 (0006): solo los resultados con algún ratio > 1…» y
  «CA8 (0006): ratios entre 0 y 1…», y `src/main/ipc/handlers/modules.test.ts`, «CA8 (0006):
  metrics:query devuelve partial con los ratios > 1…». **Tests que fijaban la regla vieja (< 1) y
  que han cambiado:** en `metrics.test.ts`, «solo los resultados con algún ratio < 1» y «ratio 0
  también es recorte» (sustituidos por los dos CA8); en `modules.test.ts`, «AUD-13: metrics:query
  devuelve partial con los ratios < 1 de la API» (ahora el CA8); y en `e2e/views.spec.ts`,
  «AUD-13: recortes y warnings…», que pasa a llamarse «AUD-13 y CA8 (0006): …»: usa ratios de 1,5 y
  4, ya no comprueba el porcentaje del aviso y, al final, con ratios de 0,005 no espera ningún aviso.
  Con un ratio > 1, el porcentaje del aviso actual («solo parte de los puntos (150 %)») no tiene
  sentido: el texto lo decide el developer (el test solo busca «solo parte de los puntos»).

## Resultado

**Canal `entities:serviceMetrics` (developer, 2026-10-07).** En `createModuleHandlers`
(`src/main/ipc/handlers/modules.ts`), con la lógica pura en `src/main/modules/service-metrics.ts` y
los esquemas en `src/shared/modules.ts` (`serviceEntityIdSchema`, `serviceMetricsResultSchema`).

- Selectores: el filtro de la petición original,
  `:filter(eq("dt.entity.service","<id>")):splitBy("dt.entity.service")` (la forma del paso 0;
  `entitySelector` daba lo mismo). Series: mediana, p90, p99, peticiones, errores y tasa, en ese
  orden y sin `resolution`. Marcadores: los tres tiempos con `resolution=Inf` y sin `:fold`. Las dos
  consultas van en paralelo.
- Los resultados se casan **por posición** (en vivo vuelven en el orden pedido y el `metricId` no es
  la expresión enviada). Se toma la primera serie de cada resultado (el filtro deja un servicio).
- Totales: peticiones y errores, suma de la serie (los puntos `null` no suman); OK = total − errores,
  nunca negativo; tasa = errores × 100 / peticiones (en ese orden, para no arrastrar decimales),
  `null` sin peticiones. Tiempos del rango: el único punto de la consulta `Inf`, en ms.
- OK punto a punto: `null` si las peticiones son `null`; un error `null` en un punto con peticiones
  cuenta como 0 (en vivo llegan 0). Los errores se casan con las peticiones por `timestamp`.
- Unidades fijadas en código: tiempos de µs a ms (÷ 1000), sin pedir el descriptor; la tasa tal
  cual (ya es 0–100).
- `warnings` de las dos consultas, sin duplicados; `partial` de las dos, con la regla compartida.
- Errores: un 400 o 404 se relanza con `reason` `serviceMetricsRejected` (estado y texto de
  Dynatrace como parámetros; es y en). El resto, como siempre.
- `src/main/ipc/channel-coverage.test.ts` (lista de canales por factoría, no es un test de la ficha)
  añade el canal nuevo, como pide su comentario.
- Sin hook de TanStack Query en el renderer: esta ficha no tiene interfaz y quedaría sin uso. La
  clave entorno + entidad + rango la pone la 0008 al pintar.

**Métricas (CA8, arreglo de la app).** Qué fallaba: `toMetricSeries` tomaba por recortado un
`dataPointCountRatio` o `dimensionCountRatio` **menor que 1**, pero la API los manda siempre (entre 0
y 0,01 en consultas normales) y significan «pedido / máximo permitido». Cómo se veía: bajo casi
cualquier gráfico de Métricas salía «<métrica>: la API ha devuelto solo parte de los puntos (0 %)»
(o «(1 %)»), y lo mismo con las dimensiones, aunque no faltara nada; también iba como «Aviso» en el
XLSX. Qué se cambió: la regla vive en `truncatedResults` (`src/main/modules/metrics.ts`), recortado
es un ratio **> 1**, y la usan `metrics:query` y `entities:serviceMetrics`. El aviso
(`metrics.partialPoints` y `metrics.partialDimensions`, es y en) ya no pinta el ratio como
porcentaje (con 1,5 habría dicho «150 %»): dice la parte que sí llegó, aproximada (1 / ratio, como
mínimo 1 %): «la API ha devuelto solo parte de los puntos (alrededor del 67 % de los pedidos)» y
«… (about 67 % of those requested)» (`MetricChartPanel.tsx`).

**Comprobación.** `npm run check` en verde (95 ficheros, 2019 tests; cobertura 91,3 % de
sentencias). e2e completo (`src/shared/ipc.ts` es transversal): 177 en verde y 3 fallos, los
conocidos de la VPS con `withContentSize` (ventana 960×602 con el escritorio al 150 %): CA2, CA1 y
CA4 de la 0005, que fallan igual en `main`. «CA7 (0006)» y «AUD-13 y CA8 (0006)», en verde.
