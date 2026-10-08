---
id: '0022'
titulo: 'Monitores (browser y HTTP): análisis de métricas en vivo y canal de series y marcadores'
estado: en_desarrollo # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0022-monitores-exploracion-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector` con comodín `builtin:synthetic.browser.*` y `builtin:synthetic.http.*`, `fields`), `GET /metrics/{metricId}` y `GET /metrics/query`; `GET /entities/{entityId}` (de la 0014) para SYNTHETIC_TEST y HTTP_CHECK; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read` (ya en uso) y `entities.read` (0014).
migracion: no
rondas_revision: 1
---

## Petición original

Lotes «monitores» (0022 a 0026) y «proceso» (0027 a 0029). Dani:

"Haz lo mismo ahora con PROCESS_INSTANCE, SYNTHETIC_TEST y HTTP. Ten en cuenta que cada entidad tiene
sus métricas «clave». Por ejemplo, SYNTHETIC_TEST tiene disponibilidad, rendimiento, localizaciones,
pasos… Haz un análisis de las métricas y determina cuáles son las idóneas para mostrar en su página
principal."

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

**Las dos páginas de monitor van juntas.** Browser monitor (`SYNTHETIC_TEST`) y HTTP monitor
(`HTTP_CHECK`) tienen la misma forma (disponibilidad, duración, ejecuciones, localizaciones y pasos o
peticiones), así que comparten canal y componentes; cambia el catálogo de métricas de cada uno.

**Análisis de métricas (lo que pidió Dani).** El Planificador no puede consultar el catálogo de
métricas del tenant: el análisis es el **paso 0** de esta ficha, con una regla fija para elegir y el
resultado anotado en la ficha.

1. **Catálogo:** `GET /metrics?metricSelector=builtin:synthetic.browser.*` y
   `…=builtin:synthetic.http.*` (la OpenAPI admite el comodín final), con `fields` de unidad,
   dimensiones y agregaciones. Son métricas integradas de Dynatrace: sus claves pueden ir al
   informe y a la ficha.
2. **Con datos:** para 3 monitores de cada tipo sacados de los problemas de los últimos 7 días (o de
   `GET /entities?entitySelector=type("SYNTHETIC_TEST")` / `type("HTTP_CHECK")` con `pageSize` 3),
   qué métricas del catálogo tienen datos en `now-24h` y con qué dimensiones
   (`dt.entity.synthetic_location`, pasos o peticiones) y si `dimensionMap` trae sus nombres.
3. **Elección**, por papel y en este orden de preferencia (la primera del catálogo que tenga datos):

| Papel                      | Qué se busca (browser / HTTP)                                                     |
| -------------------------- | --------------------------------------------------------------------------------- |
| Disponibilidad             | disponibilidad total por localización (%), sin y con ventanas de mantenimiento    |
| Duración                   | duración total de la ejecución (ms)                                               |
| Ejecuciones                | ejecuciones correctas y fallidas (recuento)                                       |
| Por localización           | disponibilidad y duración con la dimensión de localización                        |
| Por paso / petición        | duración por paso (browser) o por petición (HTTP)                                 |
| Rendimiento (solo browser) | métricas de experiencia: LCP, visually complete, CLS o speed index (las que haya) |
| Respuesta HTTP (solo HTTP) | código de estado o tiempos de DNS/TCP/TLS, si existen                             |

Una métrica sin datos en los monitores de muestra no se usa. Si un papel se queda sin métrica,
ese marcador o gráfico no se pinta y se anota. La tabla final (papel → clave de métrica, unidad,
agregación) va a "Resultado" y a `docs/notas-api-v2.md`.

4. **Entidad (la fuente de los datos del monitor, decisión de Dani):** con
   `GET /entities/{entityId}` de los monitores de muestra y `fields` con `+properties`, relaciones,
   `+firstSeenTms` y `+lastSeenTms`, qué `properties` y relaciones traen (nombres de clave, nunca
   valores): en especial, si vienen frecuencia, si está activo, tipo de monitor, localizaciones,
   pasos o peticiones y la aplicación monitorizada. Es lo que usa la tarjeta de la 0026.

Informe solo de comportamientos, sin ids ni nombres de monitores, localizaciones o pasos.

**Canal `entities:monitorMetrics`** (Zod en `src/shared/ipc.ts`), con el patrón de
`entities:serviceMetrics`:

- Entrada: `environmentId`, `entityId` (`^(SYNTHETIC_TEST|HTTP_CHECK)-[0-9A-F]{16}$`) y
  `timeRange`. El tipo sale del id; main elige el catálogo y construye los selectores.
- Dos consultas: series y marcadores (rango completo), como el servicio.
- Salida: `kind` (`browser` | `http`), `series` por papel (`availability`, `duration`,
  `executions` con `ok` y `failed`, y `performance` o `httpTimings` si hay) y `totals`
  (disponibilidad del rango, duración media y mediana, ejecuciones correctas y fallidas). Los papeles
  sin métrica llegan como `null`.
- Errores con `reason`; sin datos, series vacías. El simulador de los e2e responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe trae el catálogo de cada tipo, qué métricas tienen datos y
  con qué dimensiones, y las claves de la entidad, sin ids ni nombres. Se salta sin
  `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de SYNTHETIC_TEST y HTTP_CHECK y rechaza otros tipos
  y caracteres como `"`, `)` o `,`.
- CA3 (unitario, main): con `fetch` simulado, un id de cada tipo produce las consultas de su
  catálogo, con el id y el rango.
- CA4 (unitario, main): la transformación por papel, con un papel sin métrica (`null`) y `null`
  conservados en las series.
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin datos → series vacías.
- CA6 (e2e): el simulador responde a los dos tipos y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0024)

## Fuera de alcance

- La API v1 de sintéticos (`GET /synthetic/monitors/{monitorId}`): Dani prefiere los datos de
  `/entities` (2026-10-07). El script del monitor no se enseña.
- Ejecuciones a demanda y el detalle de la última ejecución.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: CAMBIOS

1. [API] `monitor-metrics.ts:50-58` y `:77-83`: el canal añade `:splitBy("dt.entity.synthetic_test")` a métricas de
   browser que el paso 0 probó sin `splitBy` (`totalDuration`, `success`, `failure` y las de rendimiento);
   solo `availability.location.total` se probó con `splitBy`. La frase de la ficha («todas 200, una serie tras
   `splitBy`») no es cierta en browser. Los tests no lo detectan porque el simulador acepta los dos caminos.
   **Decisión del Orquestador: opción (a)**, quitar `BROWSER_SPLIT` de esas métricas y dejarlo solo en
   `availability.location.total`, para que cada expresión sea la verificada; corregir la frase de la ficha.

Comprobado y correcto: CA1-CA6 con su test; métricas de la tabla; HTTP sin `:median`; papeles sin métrica
en `null`; id validado antes del selector; `monitorMetricsRejected` (ADR-0005); sin datos del tenant.

Opcional: los recuentos con `Inf` contradicen la lección de `src/main/CLAUDE.md` (recuentos sumando la
serie); el live midió diferencias de menos del 1 %: matizar la lección y anotarlo en las notas de la API.

## Verificación

Tests escritos en `e1c7127` (`test(monitores): criterios de la ficha 0022`). Los unitarios y el e2e
fallan porque el canal no existe (`canal entities:monitorMetrics: expected undefined`,
`implementación de entities:monitorMetrics: expected undefined`, `UNKNOWN_CHANNEL` en el e2e), no
por el test: 38 unitarios nuevos en rojo (21 de CA2 y 17 de CA3 a CA5) y el e2e de CA6 en rojo.

| Criterio | Test                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/monitor-metrics-explore.live.test.ts` › `CA1 (0022): el informe no contiene ningún id ni nombre observado` (ya pasa: paso 0 hecho)                   |
| CA2      | `src/shared/ipc.test.ts` › `CA2 (0022): entrada de entities:monitorMetrics`                                                                                            |
| CA3      | `src/main/ipc/handlers/monitor-metrics.test.ts` › `CA3 (0022): cada tipo pide las métricas de su catálogo, con el id y el rango` (browser y http, relativo y absoluto) |
| CA4      | `src/main/ipc/handlers/monitor-metrics.test.ts` › `CA4 (0022): la respuesta se transforma por papel`                                                                   |
| CA5      | `src/main/ipc/handlers/monitor-metrics.test.ts` › `CA5 (0022): errores de Dynatrace y monitor sin datos` (browser y http)                                              |
| CA6      | `e2e/views.spec.ts` › `CA6 (0022): entities:monitorMetrics por IPC con ids inventados de browser y HTTP monitor`                                                       |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-08:** 3 browser monitors (los 3 de los
problemas de los últimos 7 días) y 3 HTTP monitors (2 de los problemas y 1 de
`type("HTTP_CHECK")`), `now-24h`, 124 peticiones GET, token fuera del log. Informe en
`live-reports/monitor-metrics-explore.json` (ignorado), sin ids ni nombres.

- Catálogo: `GET /metrics?metricSelector=builtin:synthetic.browser.*` da 109 métricas y
  `…http.*` 22, en una sola página (`pageSize=500`). Todas admiten `resolution=Inf`.
- Las métricas `*.event.*` (browser) y `*.request.*` (HTTP) no tienen la dimensión del monitor,
  solo la del paso: con `filter(eq("dt.entity.synthetic_test", …))` salen vacías. Con
  `entitySelector=type("SYNTHETIC_TEST_STEP")` (o `"HTTP_CHECK_STEP"`)
  `,fromRelationships.isStepOf(entityId("<id>"))` sí traen datos.
- Con `:names`, `dimensionMap` trae `<dimensión>.name` de monitor, localización y paso.
- Las de browser con sufijo `.geo` y `availability.location.total` van por
  `dt.entity.geolocation` (región), no por `dt.entity.synthetic_location`; en HTTP, las `.geo` y
  `availability.location.total` sí van por `dt.entity.synthetic_location`.
- `builtin:synthetic.{browser,http}.availability` dice `Count`, pero sus valores son % (0–100) y
  trae la dimensión `interpolated` (`true`/`false`).
- Expresiones del canal comprobadas en los 6 monitores (`entitySelector=entityId("<id>")`): todas
  200, una serie tras `splitBy("<dimensión del monitor>")`, `metricId` igual a la expresión,
  ratios < 0,01. Resolución `10m` con `now-24h`. Con Inf, `:avg` ≈ media de la serie y los
  recuentos = suma de la serie (iguales o < 1 %).
- `http.duration.geo:median` da 200 pero devuelve lo mismo que `:avg` (median no está en sus
  agregaciones): el HTTP monitor no tiene mediana. `browser.totalDuration:median` sí es distinta.
- `http.resultStatus` tiene «Result status» = `SUCCESS` / `FAILURE`; con
  `filter(eq("Result status","FAILURE"))` y sin fallos, el resultado llega sin series.
  `http.execution.status` (`execution_state` = `SUCCESS` / `FAIL`) da los mismos recuentos.
- Entidad (`GET /entities/{id}` con `+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms`):
  - `properties` de SYNTHETIC_TEST: `assignedLocations`, `browserMonitorSubtype`, `createdBy`,
    `customizedName`, `detectedName`, `deviceProfile`, `isEnabled`, `lastExecutionTimestamp`,
    `lastModificationSource`, `lastModifiedBy`, `manuallyAssignedApplications`,
    `modificationTimestamp`, `steps`, `syntheticMonitorFrequency`, `syntheticScreenshot*Uri` (4)
    y, no siempre, `url`.
  - `properties` de HTTP_CHECK: `assignedLocations`, `createdBy`, `detectedName`,
    `httpMonitorSubtype`, `isEnabled`, `lastExecutionTimestamp`, `lastModificationSource`,
    `lastModifiedBy`, `manuallyAssignedApplications`, `modificationTimestamp`, `steps`,
    `syntheticMonitorFrequency`.
  - Relaciones: `fromRelationships.runsOn` (SYNTHETIC_LOCATION), `toRelationships.isStepOf`
    (SYNTHETIC_TEST_STEP / HTTP_CHECK_STEP), a veces `fromRelationships.monitors` (APPLICATION);
    en HTTP, a veces `fromRelationships.calls` (SERVICE) y `toRelationships.isApplicationOfSyntheticTest`
    (APPLICATION). `firstSeenTms` y `lastSeenTms`, números.

**Elección por papel** (la primera candidata con datos; todas con datos en los 3 monitores de su
tipo):

| Tipo    | Papel                            | Métrica                                                                                         | Unidad      | Agregación (por defecto; usada)                | Dimensiones                                                                                 |
| ------- | -------------------------------- | ----------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| browser | Disponibilidad                   | `builtin:synthetic.browser.availability.location.total`                                         | Percent     | avg; `splitBy("dt.entity.synthetic_test"):avg` | `dt.entity.synthetic_test`, `dt.entity.geolocation`                                         |
| browser | Disp. sin mantenimiento          | `builtin:synthetic.browser.availability.location.totalWoMaintenanceWindow`                      | Percent     | avg                                            | igual                                                                                       |
| browser | Duración                         | `builtin:synthetic.browser.totalDuration`                                                       | MilliSecond | avg; `:avg` y `:median` (marcador)             | `dt.entity.synthetic_test`                                                                  |
| browser | Ejecuciones correctas            | `builtin:synthetic.browser.success`                                                             | Count       | value                                          | `dt.entity.synthetic_test`                                                                  |
| browser | Ejecuciones fallidas             | `builtin:synthetic.browser.failure`                                                             | Count       | value                                          | `dt.entity.synthetic_test`                                                                  |
| browser | Disp. por localización           | `builtin:synthetic.browser.availability`                                                        | Count (%)   | avg                                            | `dt.entity.synthetic_location`, `dt.entity.synthetic_test`, `interpolated`                  |
| browser | Duración por localización        | `builtin:synthetic.browser.duration`                                                            | MilliSecond | avg                                            | `dt.entity.synthetic_location`, `dt.entity.synthetic_test`                                  |
| browser | Duración por paso                | `builtin:synthetic.browser.step.duration`                                                       | MilliSecond | avg                                            | `dt.entity.synthetic_test_step`, `dt.entity.synthetic_location`, `dt.entity.synthetic_test` |
| browser | Rendimiento: LCP                 | `builtin:synthetic.browser.largestContentfulPaint.load`                                         | MilliSecond | avg                                            | `dt.entity.synthetic_test`                                                                  |
| browser | Rendimiento: visually complete   | `builtin:synthetic.browser.visuallyComplete.load`                                               | MilliSecond | avg                                            | `dt.entity.synthetic_test`                                                                  |
| browser | Rendimiento: CLS                 | `builtin:synthetic.browser.cumulativeLayoutShift.load`                                          | Unspecified | avg                                            | `dt.entity.synthetic_test`                                                                  |
| browser | Rendimiento: speed index         | `builtin:synthetic.browser.speedIndex.load`                                                     | MilliSecond | avg                                            | `dt.entity.synthetic_test`                                                                  |
| http    | Disponibilidad                   | `builtin:synthetic.http.availability.location.total`                                            | Percent     | avg; `splitBy("dt.entity.http_check"):avg`     | `dt.entity.http_check`, `dt.entity.synthetic_location`                                      |
| http    | Disp. sin mantenimiento          | `builtin:synthetic.http.availability.location.totalWoMaintenanceWindow`                         | Percent     | avg                                            | igual                                                                                       |
| http    | Duración                         | `builtin:synthetic.http.duration.geo`                                                           | MilliSecond | avg; `splitBy("dt.entity.http_check"):avg`     | `dt.entity.http_check`, `dt.entity.synthetic_location`                                      |
| http    | Ejecuciones correctas y fallidas | `builtin:synthetic.http.resultStatus` con `filter(eq("Result status","SUCCESS"))` / `"FAILURE"` | Count       | avg; `splitBy("dt.entity.http_check"):sum`     | `dt.entity.http_check`, `Result status`, `dt.entity.synthetic_location`                     |
| http    | Disp. por localización           | `builtin:synthetic.http.availability`                                                           | Count (%)   | avg                                            | `dt.entity.synthetic_location`, `dt.entity.http_check`, `interpolated`                      |
| http    | Duración por localización        | `builtin:synthetic.http.duration.geo`                                                           | MilliSecond | avg                                            | `dt.entity.http_check`, `dt.entity.synthetic_location`                                      |
| http    | Duración por petición            | `builtin:synthetic.http.request.duration.geo`                                                   | MilliSecond | avg                                            | `dt.entity.http_check_step`, `dt.entity.synthetic_location` (sin la del monitor)            |
| http    | Tiempos HTTP: DNS                | `builtin:synthetic.http.dns.geo`                                                                | MilliSecond | avg; `splitBy("dt.entity.http_check"):avg`     | `dt.entity.http_check`, `dt.entity.synthetic_location`                                      |
| http    | Tiempos HTTP: TCP                | `builtin:synthetic.http.tcpConnectTime.geo`                                                     | MilliSecond | avg; igual                                     | igual                                                                                       |
| http    | Tiempos HTTP: TLS                | `builtin:synthetic.http.tlsHandshakeTime.geo`                                                   | MilliSecond | avg; igual                                     | igual                                                                                       |
| http    | Tiempos HTTP: primer byte        | `builtin:synthetic.http.timeToFirstByte.geo`                                                    | MilliSecond | avg; igual                                     | igual                                                                                       |
| http    | Código de estado                 | `builtin:synthetic.http.statusCode`                                                             | Count       | value                                          | `dt.entity.http_check`, `dt.entity.synthetic_location`, `Status code`                       |

Papeles sin métrica: **mediana de la duración en HTTP** (no hay agregación median) y, por tipo,
`performance` en HTTP y `httpTimings` en browser. Ningún tipo se quedó sin monitores en el tenant.

**Decisiones del test-writer (delegadas por Dani, a refinar si hace falta):**

- Disponibilidad = `availability.location.total` (cuenta las ventanas de mantenimiento). La variante
  `totalWoMaintenanceWindow` tiene datos pero no va en la salida de la 0022.
- Forma de la salida (con `resolution`, `warnings` y `partial`, como `entities:serviceMetrics`):
  `series.availability`, `series.duration`, `series.executions.{ok,failed}`,
  `series.performance.{largestContentfulPaint,visuallyComplete,cumulativeLayoutShift,speedIndex}`
  (null en HTTP), `series.httpTimings.{dns,tcpConnect,tlsHandshake,timeToFirstByte}` (null en
  browser); `totals.availability`, `totals.duration.{avg,median}` y
  `totals.executions.{ok,failed}`.
- Series sin `resolution` (la elige la API) y marcadores con `resolution=Inf` sin `fold`, ≤ 10
  expresiones por consulta, todas acotadas al id (en `entitySelector` o en el filtro).
- Marcadores de disponibilidad y duración, del valor Inf; los recuentos coinciden con la suma de
  la serie (el test acepta cualquiera de los dos caminos).
- Sin datos: disponibilidad y duraciones a `null`; recuentos a `0` (como el servicio). Un HTTP
  monitor sin fallos recibe la serie de fallidas vacía y `failed: 0`.
- Las métricas por localización y por paso o petición quedan en la tabla para la 0023; no van en
  `entities:monitorMetrics`. El código de estado HTTP tampoco (los tiempos cubren el papel).

**Decisiones del developer (delegadas por Dani, a refinar si hace falta):**

- Todas las expresiones van con `entitySelector=entityId("<id>")` y
  `splitBy("<dimensión del monitor>")` (lo que el paso 0 comprobó en vivo), en
  `src/main/modules/monitor-metrics.ts`; se casan por posición, como en el servicio y el host.
- Recuentos del rango (`totals.executions`) del marcador con Inf, no de sumar la serie: el paso 0
  los vio iguales (o < 1 %) y así sale todo de la misma consulta. Sin dato, 0.
- HTTP: la consulta de marcadores no pide `:median` (daría lo mismo que `:avg`); `median` va a
  `null` por tipo.
- Motivo nuevo `monitorMetricsRejected` (400 y 404), con su texto en es y en.
- `src/main/ipc/channel-coverage.test.ts` y `src/main/ipc/handlers/modules.test.ts` (registros de
  canales, no tests de la ficha) llevan el canal nuevo, como en la 0016.

## Resultado

(pendiente)
