---
id: '0046'
titulo: 'SERVICE: las métricas dependen del serviceType (servidor, cliente, unificadas o solo actividad)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
