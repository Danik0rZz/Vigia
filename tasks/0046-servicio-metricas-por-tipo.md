---
id: '0046'
titulo: 'SERVICE: las métricas dependen del serviceType (servidor, cliente, unificadas o solo actividad)'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-tipos
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0046-servicio-metricas-por-tipo
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /entities/{entityId}` (`fields` con `+properties.serviceType`, `+properties.webServerName`, `+properties.remoteEndpoint` y `+properties.remoteServiceName`), `GET /entities` (`entitySelector=type("SERVICE"),serviceType("…")`, atributo de entidad según la OpenAPI), `GET /metrics/{metricId}` y `GET /metrics/query`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `entities.read` y `metrics.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio-tipos» (0046 a 0048). Dani (2026-10-10): "Para la página de SERVICE hay que consultar
primero el detalle de la entidad y de ahí sacar el `serviceType`, ya que según el tipo aplican unas
métricas u otras." Pasó un ejercicio suyo, resumido por una IA, con la relación entre tipos y
métricas, y pidió quedarse **solo con los nombres de las métricas y los tipos de servicio, sin sus
variables ni sus parámetros**.

## Especificación

**La relación (de Dani; solo tipos y métricas):**

| Conjunto           | Cuándo (serviceType y propiedades)                                                                                                                                                                    | Métricas                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Servidor**       | `WEB_SERVICE`, `CUSTOM_SERVICE`, `BACKGROUND_ACTIVITY`, `SPAN`, `MESSAGING_SERVICE`, `EXTERNAL`; `WEB_REQUEST_SERVICE` con `webServerName`; `RPC_SERVICE` sin `remoteEndpoint` ni `remoteServiceName` | `builtin:service.response.server`, `builtin:service.errors.server.count`, `builtin:service.errors.server.rate`, `builtin:service.requestCount.server` (las de hoy)            |
| **Cliente**        | `WEB_REQUEST_SERVICE` sin `webServerName`; `DATABASE_SERVICE`; `RPC_SERVICE` con `remoteEndpoint` o `remoteServiceName`                                                                               | `builtin:service.response.client`, `builtin:service.errors.client.count`, `builtin:service.errors.client.rate`, `builtin:service.requestCount.client`                         |
| **Unificadas**     | `UNIFIED`                                                                                                                                                                                             | `builtin:service.request.response_time_service_aggregation`, `builtin:service.request.failure_count_service_aggregation`, `builtin:service.request.count_service_aggregation` |
| **Solo actividad** | `QUEUE_LISTENER_SERVICE`                                                                                                                                                                              | `builtin:service.response.server` (como recuento de peticiones); sin tiempos ni errores                                                                                       |

Un `serviceType` que no esté en la tabla (o que no llegue) usa **Servidor** y se anota como aviso
en la salida.

**Lo que no cambia:** los papeles de la página (tiempos con mediana, p90 y p99; peticiones; errores;
OK = total − KO; tasa de error), decididos por Dani en el lote «servicio». Cómo se pide cada papel
a cada métrica (agregación, `splitBy`, dimensiones como la de peticiones fallidas en las
unificadas) **lo decide la exploración en vivo**, no el ejercicio de Dani.

**Paso 0, en vivo y solo lectura:** para cada `serviceType` de la tabla que exista en el tenant, 2
servicios con `entitySelector=type("SERVICE"),serviceType("…")` (y, para los casos con propiedad,
uno con y otro sin ella si los hay). Para cada uno: el descriptor de las métricas de su conjunto
(unidad, agregaciones, si admite `percentile` y `median`, dimensiones), si tienen datos en
`now-24h`, y si las del conjunto Servidor tienen datos también (para ver que el reparto acierta).
En las unificadas, cómo se separan las fallidas (dimensión) y si la tasa se puede calcular en main
como fallidas / total × 100. El informe guarda solo tipos de Dynatrace, claves de métricas y
comportamientos, nunca ids ni nombres. Resultado en "Resultado" y en `docs/notas-api-v2.md`.

**Main (`entities:serviceMetrics`):**

- Antes de las métricas, main pide `GET /entities/{entityId}` con los `fields` de arriba (una
  petición; la clave de TanStack Query no cambia) y elige el conjunto con una función pura
  (`serviceMetricSet(serviceType, properties)`), con test.
- Construye las consultas con las métricas del conjunto. En **Solo actividad**, los papeles de
  tiempos y errores salen `null`. En **Unificadas**, la tasa se calcula en main si la exploración
  dice que no hay métrica directa.
- La salida gana `serviceType` (tal cual, o `null`), `metricSet` (`server` | `client` | `unified`
  | `activity`) y `metricKeys` (las claves usadas por papel, para «Abrir en Métricas» de la 0047).
- Sin `entities.read` (403) o si la entidad falla: conjunto **Servidor**, como hoy, y un aviso en
  `warnings`; la página no se rompe.
- El simulador de los e2e da servicios de cada conjunto.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice qué tipos existen, qué conjunto tiene datos para cada
  uno y la forma de las unificadas, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario): `serviceMetricSet` da el conjunto de la tabla para cada `serviceType`, con y sin
  `webServerName` (WEB_REQUEST_SERVICE) y con y sin `remoteEndpoint`/`remoteServiceName`
  (RPC_SERVICE); un tipo desconocido o `null` da Servidor.
- CA3 (unitario, main): con `fetch` simulado, primero se pide la entidad y después las consultas
  llevan las métricas del conjunto (una prueba por conjunto).
- CA4 (unitario, main): en Solo actividad, tiempos y errores son `null` y las peticiones salen del
  recuento; en Unificadas, la tasa se calcula bien (y `null` sin peticiones).
- CA5 (unitario, main): con 403 en la entidad, se usa Servidor y llega el aviso.
- CA6 (unitario, main): la salida trae `serviceType`, `metricSet` y `metricKeys`.
- CA7 (e2e): el simulador responde con servicios de los cuatro conjuntos y un test por IPC recibe
  el conjunto correcto de cada uno.

## Pruebas a mano para Dani

(en la 0047)

## Fuera de alcance

- La interfaz (0047). Otras métricas por tipo (por ejemplo, por cola en mensajería).

## Ideas surgidas (fuera de alcance)

- (developer) Que la 0047 detecte el «por defecto» por un campo estructurado (por ejemplo, `metricSetFallback: true`) en vez de por los textos de `warnings`, que son de diagnóstico y en español.

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `a66a0e9` (`test(servicio): criterios de la ficha 0046`). Fallan porque el
código no existe (`Cannot find module './service-metric-set'`, `metricSet`/`serviceType` sin
llegar en la salida, ninguna petición a la entidad), no por el test: 17 de
`service-metric-set.test.ts` (canal), el fichero de `serviceMetricSet` entero, los 2 de CA3
(0006), que ahora cuentan la petición de la entidad, y los 2 e2e nuevos. El resto de `views`
(220) y de los unitarios, en verde con el simulador nuevo.

| Criterio | Test                                                                                                                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/service-metric-set-explore.live.test.ts` › `CA1 (0046): el informe no contiene ningún id, nombre ni valor observado` (ya pasa: paso 0 hecho)                                                                                                                                                                |
| CA2      | `src/main/modules/service-metric-set.test.ts` › `CA2 (0046): serviceMetricSet da el conjunto de la tabla…` (con `EXTERNAL → Cliente`, ajustado en el commit de la decisión); en el canal, `src/main/ipc/handlers/service-metric-set.test.ts` › `CA2 (0046) en el canal: tipo desconocido o que no llega → Servidor con aviso` |
| CA3      | `src/main/ipc/handlers/service-metric-set.test.ts` › `CA3 (0046): primero la entidad y después las consultas con las métricas del conjunto` (una por conjunto)                                                                                                                                                                |
| CA4      | `src/main/ipc/handlers/service-metric-set.test.ts` › `CA4 (0046): Solo actividad y tasa de las Unificadas`                                                                                                                                                                                                                    |
| CA5      | `src/main/ipc/handlers/service-metric-set.test.ts` › `CA5 (0046): si la entidad falla, conjunto Servidor y un aviso` (403, 404 y 400)                                                                                                                                                                                         |
| CA6      | `src/main/ipc/handlers/service-metric-set.test.ts` › `CA6 (0046): la salida trae serviceType, metricSet y metricKeys`                                                                                                                                                                                                         |
| CA7      | `e2e/views.spec.ts` › `CA7 (0046): entities:serviceMetrics por IPC con un servicio de cada conjunto…` y `CA7 (0046): … sin entities.read: entidad con 403…`                                                                                                                                                                   |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-10:** censo de `type("SERVICE")` en
`now-24h` y 2 servicios por tipo con `serviceType("…")`, 89 peticiones GET (mediana 336 ms,
máximo 933 ms), token fuera del log. Informe en `live-reports/service-metric-set-explore.json`
(ignorado), sin ids ni nombres.

- **Tipos que existen:** `WEB_SERVICE`, `CUSTOM_SERVICE`, `SPAN`, `EXTERNAL`,
  `WEB_REQUEST_SERVICE` (con y sin `webServerName`), `RPC_SERVICE` (con y sin
  `remoteEndpoint`/`remoteServiceName`), `DATABASE_SERVICE`, `UNIFIED` y
  `QUEUE_LISTENER_SERVICE`. No hay `BACKGROUND_ACTIVITY` ni `MESSAGING_SERVICE`; ninguno fuera de
  la tabla. `serviceType("…")` en el selector funciona (todos los devueltos son de ese tipo).
- **`GET /entities/{id}` con los `fields` de la ficha:** 200, `properties.serviceType` siempre;
  una propiedad que el servicio no tiene **no llega** (la clave falta, no viene a `null`).
- **Descriptores:** las de Servidor y Cliente, iguales: tiempos en `MicroSecond` (con `median`,
  `percentile` y `count`), recuentos `Count` (`value`), tasa `Percent` (`avg`), todas con
  `resolution=Inf` y `fold`. Unificadas: `response_time_service_aggregation` en
  **`MilliSecond`** (no µs; `median`, `percentile`, `count`), `failure_count_service_aggregation`
  y `count_service_aggregation` en `Count`. `response_time_…` y `count_…` tienen la dimensión
  `failed` (`"true"`/`"false"`); `failure_count_…` solo la del servicio.
- **Reparto (qué conjunto tiene datos):** Servidor en WEB_SERVICE, CUSTOM_SERVICE, SPAN,
  WEB_REQUEST_SERVICE con `webServerName` y RPC_SERVICE sin `remote*`. Cliente en
  WEB_REQUEST_SERVICE sin `webServerName` y DATABASE_SERVICE (sin datos de Servidor); el
  RPC_SERVICE con `remote*` tiene datos en los dos. Unificadas: solo sus métricas. Solo
  actividad: `response.server` (tiempos y `:count`) sí; `requestCount.server` y los errores, no.
  **EXTERNAL: sin datos de Servidor en los 2 vistos, y sí de Cliente** (ver abajo).
- **Unificadas:** con `entitySelector` y sin `splitBy`, `response_time_…` y `count_…` llegan en
  dos series (por `failed`): hay que pedir `:splitBy("dt.entity.service")`. Con él, el total es la
  suma de `failed=true` y `failed=false`, y `failure_count_…` es igual a `count_…` con
  `failed=true`. No hay métrica de tasa: main la calcula como fallidas / total × 100 (fallidas ≤
  total siempre).
- **Expresiones probadas** (todas 200, una serie por expresión, en el orden pedido, sin
  `resolution` → `10m` en 24 h, y con `resolution=Inf`), con
  `:filter(eq("dt.entity.service","<id>")):splitBy("dt.entity.service")` tras la clave:
  Servidor y Cliente, `response.*:…:median`, `:percentile(90.0)`, `:percentile(99.0)`,
  `errors.*.count`, `errors.*.rate` y `requestCount.*`; Unificadas, `response_time_…` con
  `:median`/`:percentile(90.0)`/`:percentile(99.0)`, `failure_count_…` y `count_…`; Solo
  actividad, `builtin:service.response.server…:count`. Recuentos con `Inf` frente a la suma de
  la serie: iguales en errores y a menos del 1 % en peticiones (en Servidor, ≥ 1 % en uno: los
  totales siguen saliendo de sumar la serie, como en la 0006).

**Decisiones del test-writer (delegadas por el Orquestador, refinables):**

- `serviceMetricSet(serviceType: string | null, properties: Record<string, unknown>)` en
  `src/main/modules/service-metric-set.ts`, que devuelve `'server' | 'client' | 'unified' |
'activity'`. Una propiedad cuenta si es una cadena no vacía (o una lista no vacía); los valores
  distinguen mayúsculas (`unified` no es `UNIFIED`). `webServerName` solo cuenta en
  WEB_REQUEST_SERVICE y `remote*` solo en RPC_SERVICE.
- Solo actividad: `series.responseTime`, `series.errors`, `series.ok` y `series.errorRate` son
  `null`, y en `totals`, `responseTime`, `errors`, `ok` y `errorRate` también; las peticiones
  salen de `response.server:count` (serie y suma). Ninguna expresión pide mediana ni percentiles.
- Unificadas: tiempos en ms tal cual (sin ÷ 1000); `errors` = `failure_count_…`, `requests` =
  `count_…` (con `splitBy("dt.entity.service")`), OK = total − fallidas y tasa punto a punto y
  total = fallidas / total × 100 (`null` sin peticiones).
- `metricKeys`: `{ responseTime, requests, errors, errorRate }` con la clave sin
  transformaciones o `null`. Servidor y Cliente, sus cuatro; Unificadas, `errorRate: null` (se
  calcula); Solo actividad, solo `requests: 'builtin:service.response.server'`.
- `serviceType`: el de la entidad tal cual; `null` si la entidad falla o no lo trae. Avisos en
  `warnings`: entidad que falla (403, 404, 400…), entidad sin `serviceType` y tipo fuera de la
  tabla (el aviso lleva el tipo). Con un tipo de la tabla, `warnings` no gana nada.
- En el simulador e2e, la entidad que pide el canal (la de `+properties.serviceType`) va aparte
  de la de `entities:get` (`sim.serviceEntityQueries`), con 403 para el token sin
  `entities.read`; los servicios de fichas anteriores son WEB_SERVICE para el canal (aunque su
  tarjeta diga otro tipo), así que siguen con las métricas de Servidor.

**Para el Planificador o Dani (no reinterpretado):** en vivo, EXTERNAL tiene datos solo en
Cliente, pero la tabla de Dani lo pone en Servidor. Los tests siguen la tabla (CA2 lo exige); con
ella, un EXTERNAL saldrá sin datos. Cambiarlo a Cliente es tocar la tabla.

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-10:** `EXTERNAL` pasa a
**Cliente**. La tabla de Dani se hizo a partir de un ejercicio, y lo visto en vivo es que sus
servicios solo tienen datos de Cliente: con Servidor, la página saldría vacía para ellos, que es
justo lo que la ficha quiere evitar. Es un cambio de una fila, fácil de deshacer si Dani lo quiere
de otra forma; se lo cuento en el resumen. CA2 se lee con esta corrección.

## Resultado

**Developer (2026-10-10):** `serviceMetricSet` en `src/main/modules/service-metric-set.ts`
(con `SERVICE_TYPE_FIELDS` y la lista de tipos de la tabla, EXTERNAL en Cliente); el canal
(`src/main/ipc/handlers/modules.ts`) pide la entidad, elige el conjunto y construye las consultas
con `src/main/modules/service-metrics.ts` (claves por conjunto en `SERVICE_METRIC_KEYS`). Lo
observado en vivo, en `docs/notas-api-v2.md` («Métricas de un servicio según su serviceType»).

Decisiones del developer (refinables):

- **Consultas por conjunto:** Servidor y Cliente, 6 expresiones de series y 3 de marcadores
  (`Inf`), como en la 0006; Unificadas, 5 de series (sin tasa) y 3 de marcadores; Solo actividad,
  **una sola consulta** (`response.server…:count`) y ninguna de marcadores, porque no mide
  tiempos. Ninguna pasa de 10 expresiones.
- **La entidad va antes y en serie** (no en paralelo con las métricas): las consultas dependen
  del conjunto. Cualquier `DtError` al leerla (403, 404, 400, red…) da Servidor y un aviso; si el
  fallo es del token entero, las métricas fallan después con su error, como antes.
- **Textos de `warnings` propios en español** y solo con el estado HTTP (nunca el texto de
  Dynatrace ni el id): son diagnóstico, como los de Dynatrace, que ya llegan sin traducir. La
  nota visible de la 0047 debe salir de `serviceType`/`metricSet`, no de estos textos (ver
  «Ideas surgidas»).
- **Esquema compartido:** `series.responseTime`, `series.errors`, `series.ok`, `series.errorRate`,
  `totals.errors`, `totals.ok` y `totals.responseTime` pasan a admitir `null` (Solo actividad).
  En el renderer, solo lo mínimo para compilar: `service-charts.ts` pinta una serie `null` sin
  puntos y el fixture de `service-charts.test.ts` gana los tres campos nuevos (sin tocar sus
  aserciones). La vista por tipo es de la 0047.
