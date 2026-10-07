---
id: '0006'
titulo: 'SERVICE: exploración en vivo y canal de métricas del servicio (series y marcadores)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(pendiente)

## Resultado

(pendiente)
