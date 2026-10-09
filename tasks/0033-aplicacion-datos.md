---
id: '0033'
titulo: 'APPLICATION: análisis de métricas en vivo y canal de series y marcadores'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0033-aplicacion-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:apps.web.*`), `GET /metrics/{metricId}` y `GET /metrics/query`; `GET /entities/{entityId}` (0014); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion» (0033 a 0035). Dani (2026-10-09): "Haz lo mismo para … Application". La
petición completa está en la ficha 0031.

## Especificación

**Qué es:** `APPLICATION` es una aplicación web con monitorización de usuario real (RUM). Sus
métricas clave son las de experiencia: Apdex, acciones de usuario y su duración, errores y
sesiones.

**Análisis de métricas (paso 0, en vivo y solo lectura),** con la regla de la 0022: catálogo
`GET /metrics?metricSelector=builtin:apps.web.*` (unidad, dimensiones y agregaciones), cuáles tienen
datos en `now-24h` para 3 aplicaciones (de los problemas de 7 días o `type("APPLICATION")` con
`pageSize` 3) y elección por papel, la primera con datos:

| Papel               | Qué se busca                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| Apdex               | Apdex de la aplicación                                                  |
| Acciones            | número de acciones de usuario                                           |
| Duración            | duración de las acciones (mediana o media; visually complete si existe) |
| Errores             | errores de JavaScript y de peticiones (recuento o tasa)                 |
| Sesiones o usuarios | sesiones o usuarios activos, si existen                                 |
| Por acción          | duración y recuento con la dimensión de acción de usuario               |

Lo que no tenga métrica no se pinta y se anota. Tabla final en "Resultado" y en
`docs/notas-api-v2.md`; claves de `properties` y relaciones de la entidad (solo nombres) para la
tarjeta.

**Canal `entities:applicationMetrics`** (Zod):

- Entrada: `environmentId`, `entityId` (`^APPLICATION-[0-9A-F]{16}$`) y `timeRange`.
- Salida: `series` por papel (`apdex`, `actions`, `duration`, `errors`, `sessions`), `totals` del
  rango y `topActions`: las 10 acciones con más volumen, con `id`, `name`, recuento y duración
  media (los papeles sin métrica, `null`).
- Errores con `reason`. El simulador de los e2e responde.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe trae el catálogo, qué métricas tienen datos y con qué
  dimensiones, y las claves de la entidad, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de APPLICATION y rechaza otros.
- CA3 (unitario, main): con `fetch` simulado, las consultas llevan las métricas elegidas, el id y
  el rango.
- CA4 (unitario, main): transformación por papel y de las 10 acciones, con papeles `null`.
- CA5 (unitario, main): 400 o 404 → error con `reason`.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0035)

## Fuera de alcance

- Aplicaciones móviles y personalizadas, y sesiones de usuario una a una (session replay).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `bb79a6a` (`test(aplicacion): criterios de la ficha 0033`). Los unitarios y el
e2e fallan porque el canal no existe (`canal entities:applicationMetrics: expected undefined`,
`implementación de entities:applicationMetrics: expected undefined`, `UNKNOWN_CHANNEL` en el
e2e), no por el test: 38 unitarios en rojo (22 de CA2, 14 de CA3 a CA5 y los registros de
`channel-coverage.test.ts` y `modules.test.ts`) y el e2e de CA6 en rojo.

| Criterio | Test                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/application-metrics-explore.live.test.ts` › `CA1 (0033): el informe no contiene ningún id ni nombre observado` (ya pasa: paso 0 hecho) |
| CA2      | `src/shared/ipc.test.ts` › `CA2 (0033): entrada de entities:applicationMetrics`                                                                          |
| CA3      | `src/main/ipc/handlers/application-metrics.test.ts` › `CA3 (0033): las consultas llevan las métricas elegidas, el id y el rango`                         |
| CA4      | `src/main/ipc/handlers/application-metrics.test.ts` › `CA4 (0033): transformación por papel y de las 10 acciones`                                        |
| CA5      | `src/main/ipc/handlers/application-metrics.test.ts` › `CA5 (0033): errores de Dynatrace y aplicación sin datos`                                          |
| CA6      | `e2e/views.spec.ts` › `CA6 (0033): entities:applicationMetrics por IPC con ids inventados: tres consultas, series, totales y las 10 acciones`            |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-09:** 3 aplicaciones (2 de los problemas
de 7 días y 1 de `type("APPLICATION")`), `now-24h`, unas 90 peticiones GET, token fuera del log.
Informe en `live-reports/application-metrics-explore.json` (ignorado), sin ids ni nombres.

- **Catálogo:** 89 métricas en `builtin:apps.web.*`, una página. Las de la aplicación tienen la
  dimensión `dt.entity.application`; las `builtin:apps.web.action.*`, solo
  `dt.entity.application_method` (más `dt.entity.browser`, `User type` o geolocalización). Todas
  admiten `filter`, `fold`, `limit`, `names`, `sort` y `splitBy`, entre otras.
- **Elección por papel** (la primera con datos, en el orden de preferencia):

| Papel      | Métrica                                                      | Unidad      | Agregaciones              | Dimensiones                                                                  |
| ---------- | ------------------------------------------------------------ | ----------- | ------------------------- | ---------------------------------------------------------------------------- |
| Apdex      | `builtin:apps.web.apdex.userType`                            | Unspecified | auto, avg                 | `dt.entity.application`, `User type`                                         |
| Acciones   | `builtin:apps.web.actionCount.summary`                       | Count       | auto, value               | `dt.entity.application`, `dt.entity.geolocation`, `User type`, `Action type` |
| Duración   | `builtin:apps.web.visuallyComplete.load.browser`             | MilliSecond | auto, avg, median y otras | `dt.entity.application`, `dt.entity.browser`                                 |
| Errores    | `builtin:apps.web.countOfErrors`                             | Count       | auto, value               | `dt.entity.application`, `User type`, `Error type`, `Error origin`           |
| Sesiones   | `builtin:apps.web.startedSessions`                           | Count       | auto, value               | `dt.entity.application`, `Users`, `User type`                                |
| Por acción | `builtin:apps.web.action.duration.{load,xhr,custom}.browser` | MilliSecond | avg, count y otras        | `dt.entity.application_method`, `dt.entity.browser`                          |

- Ningún papel se queda sin métrica. También con datos: `actionDuration.*`, `activeSessions`,
  `activeUsersEst`, `jsErrorsDuringUa` y `jsErrorsWithoutUa` (en 1 de 3), las Core Web Vitals y
  otras. `Error type` trae `JavaScript` y `Request`.
- **Consultas exactas del canal**, probadas en las 3 aplicaciones (todas 200, `metricId` igual a
  la expresión, una serie sin dimensiones por expresión de la aplicación):
  - series, con `entitySelector=entityId("<id>")` y sin `resolution` (`10m` con `now-24h`):
    `apdex.userType:splitBy():avg`, `actionCount.summary:splitBy():sum`,
    `visuallyComplete.load.browser:splitBy():avg`, `countOfErrors:splitBy():sum` y
    `startedSessions:splitBy():sum` (prefijo `builtin:apps.web.`);
  - totales: las mismas con `resolution=Inf`. En los recuentos, a menos del 1 % de la suma de la
    serie (o igual); en Apdex y duración, la media ponderada (en Apdex, a menos del 1 % de la
    media de la serie; en la duración puede diferir más, porque los intervalos pesan distinto);
  - acciones, con
    `entitySelector=type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("<id>"))`
    y `resolution=Inf`: por tipo (`load`, `xhr`, `custom`),
    `action.duration.<tipo>.browser:splitBy("dt.entity.application_method"):sort(value(count,descending)):limit(10):count:names`
    y lo mismo con `:avg:names`. Las dos del mismo tipo traen las mismas acciones en el mismo
    orden, con `dt.entity.application_method.name`; ninguna acción sale en dos tipos; el `:count`
    de la duración es igual al recuento de `action.count.<tipo>.browser`. Con `entityId` de la
    aplicación, las métricas por acción no traen nada.
- **Por acción hay pocos datos:** 2 de las 3 aplicaciones no traen ninguna acción en 24 h (una
  trae 1 en 7 días), aunque tienen de 2 a 9 entidades `APPLICATION_METHOD`. Las métricas
  `action.*` parecen ser solo de las acciones clave (key user actions): la 0034 tiene que
  contemplar la lista vacía. Con tan pocas acciones, el orden de `:sort` no se ha podido ver con
  más de una acción por tipo.
- **Entidad** (`GET /entities/{entityId}`): `properties` con `applicationInjectionType`,
  `applicationLikeDeleted`, `applicationType`, `customizedName`, `detectedName` y, a veces,
  `applicationMatchTarget`, `ruleAppliedMatchType` y `ruleAppliedPattern`. Relaciones:
  `fromRelationships.calls` (SERVICE), `fromRelationships.isApplicationOfSyntheticTest`
  (HTTP_CHECK), `toRelationships.isApplicationMethodOf` (APPLICATION_METHOD),
  `toRelationships.isGroupOf` (APPLICATION_METHOD_GROUP) y `toRelationships.monitors`
  (SYNTHETIC_TEST, HTTP_CHECK).

**Decisiones del test-writer (delegadas por el Orquestador, refinables):**

- Forma de la salida: `series` con `apdex`, `actions`, `duration`, `errors` y `sessions` (cada una
  `{ timestamps, values }`); `totals` con los mismos cinco papeles (número o `null`); `topActions`
  con como mucho 10 `{ id, name, count, duration }`. Más `resolution`, `warnings` y `partial`,
  como en la 0031.
- Los cinco papeles tienen métrica: un papel sin datos llega con series vacías (no `null`); los
  `null` de CA4 son los de los totales sin dato y los de cada acción (recuento o duración sin
  dato). Sin nombre en `dimensionMap`, `name` es el id.
- Apdex de todos los tipos de usuario (`splitBy()`), no solo `Real users` (con el filtro sale lo
  mismo en el tenant; una aplicación solo con tráfico sintético se quedaría sin Apdex).
- Duración: visually complete de las acciones de carga (media). Errores: un solo papel con
  `countOfErrors` (JavaScript, peticiones y personalizados juntos). Sesiones: las empezadas (su
  suma en el rango es el número de sesiones; las activas no se pueden sumar).
- Totales con `resolution=Inf` para los cinco papeles (no la suma de la serie).
- Las 10 acciones: las de más recuento entre los tres tipos (la API da como mucho 10 por tipo),
  con la duración media de su tipo; las de recuento `null`, al final. Tres peticiones, todas a
  `/metrics/query`: los nombres llegan en `dimensionMap` y no hace falta `/entities`.
- Un ratio > 1 en la consulta de las acciones llega en `partial` (sugerencia del revisor de la
  0031).

## Resultado

(pendiente)
