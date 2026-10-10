---
id: '0052'
titulo: 'APPLICATION (RUM): datos de actividad por tipo de acción, errores por tipo, usuarios, sesiones y experiencia'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion-rum
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0052-aplicacion-rum-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/{metricId}` y `GET /metrics/query` con métricas `builtin:apps.web.*` del catálogo observado en la 0033 (`docs/notas-api-v2.md`, "Métricas de una aplicación web"); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read`.
migracion: no
rondas_revision: 1
---

## Petición original

Lote «aplicacion-rum» (0052 a 0054). Dani (2026-10-10): "También hay que preparar la página de
APPLICATION, real user monitoring, con su página como las demás. Aquí ojo, que hay que hablar de
actividad de acciones (loads y XHR), errores HTTP y JavaScript, sesiones de usuario, usuarios
activos, etc."

(Dani escribió "java": en una aplicación web, los errores del navegador son de JavaScript; se
entiende así.)

## Especificación

**Fuente de los datos (Dani, 2026-10-10):** Dynatrace tiene dos fuentes para RUM y Core Web Vitals:
Grail (DQL, plataforma) y la API clásica con métricas. Vigía y sus pruebas en vivo están limitadas a
la **API clásica**, así que solo se pintan **métricas de RUM** (`builtin:apps.web.*` por
`GET /api/v2/metrics/query`). Nada de Grail ni DQL en este lote.

**Hoy** (fichas 0033 y 0034): la página usa cinco métricas (Apdex, acciones totales, duración de
carga, errores totales y sesiones iniciadas) y la tabla de acciones clave. El catálogo observado
tiene 89 métricas `builtin:apps.web.*`.

**Métricas por papel** (todas del catálogo de la 0033; el paso 0 confirma unidad, agregación y que
tienen datos):

| Papel                          | Métricas candidatas                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Acciones por tipo              | `actionCount.load.browser`, `actionCount.xhr.browser`, `actionCount.custom.browser`                                 |
| Duración por tipo              | `actionDuration.load.browser`, `actionDuration.xhr.browser`, `actionDuration.custom.browser`                        |
| Errores por tipo               | `countOfErrors` (con su dimensión de tipo u origen de error, si la tiene), `jsErrorsDuringUa`, `jsErrorsWithoutUa`  |
| Acciones afectadas por errores | `percentageOfUserActionsAffectedByErrors`, `countOfUserActionsWithErrors`                                           |
| Usuarios activos               | `activeUsersEst`                                                                                                    |
| Sesiones                       | `startedSessions`, `activeSessions`, `endedSessions`, `sessionDuration`, `actionsPerSession`, `bouncedSessionRatio` |
| Experiencia                    | `largestContentfulPaint.load.browser`, `cumulativeLayoutShift.load.browser`, `interactionToNextPaint`               |
| Frustración (si hay datos)     | `event.count.rageClick`                                                                                             |

(Todas con el prefijo `builtin:apps.web.`.)

**Paso 0, en vivo y solo lectura** (3 aplicaciones, `now-24h`, como la 0033):

- descriptores (unidad, agregaciones, dimensiones) y datos de cada candidata;
- **errores HTTP:** el catálogo no tiene una métrica con "http" en el nombre; se mira si
  `countOfErrors` (o `errorCountForDavis`, `countOfStandaloneErrors`) tiene una dimensión de tipo u
  origen (petición/HTTP, JavaScript, personalizado) con la que separar los HTTP. Si no la hay, los
  errores HTTP salen como «errores − errores de JavaScript» **solo si** el paso 0 confirma que los
  tipos suman el total; si no, no se separan y se anota;
- `activeUsersEst`: qué agregación da el número de usuarios del rango con `resolution=Inf` (es una
  estimación: la vista lo dice);
- en qué unidades llegan duración de sesión, tasa de rebote, LCP, CLS e INP.

Informe solo de comportamientos; tabla final en "Resultado" y en `docs/notas-api-v2.md`.

**Canal `entities:applicationRum`** (nuevo, Zod; el de la 0033 no cambia):

- Entrada: `environmentId`, `entityId` (el esquema de la 0033) y `timeRange`.
- Salida: `series` por papel (`actionsByType` con `load`, `xhr`, `custom`; `durationByType`;
  `errorsByType` con `javascript`, `http`, `other` o `null` si no se pueden separar;
  `affectedActionsPct`; `activeUsers`; `sessions` con `started`, `ended`; `sessionDuration`;
  `actionsPerSession`; `bounceRate`; `vitals` con `lcp`, `cls`, `inp`; `rageClicks`) y `totals` del
  rango para cada uno. Papeles sin métrica, `null`.
- Varias consultas en paralelo (como mucho 10 expresiones por consulta, la OpenAPI), con el selector
  de la 0033 (`entitySelector=entityId("<id>")`) y casadas por posición.
- Errores con `reason`. El simulador de los e2e responde.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe trae lo del paso 0 (incluido si los errores HTTP se pueden
  separar y cómo), sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, main): con `fetch` simulado, ninguna consulta pasa de 10 expresiones y todas llevan
  el id y el rango.
- CA3 (unitario, main): transformación por papel, con papeles `null` y `null` conservados en las
  series; `errorsByType` según la regla del paso 0.
- CA4 (unitario, main): 400 o 404 → error con `reason`.
- CA5 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en las fichas 0053 y 0054)

## Fuera de alcance

- Grail y DQL (RUM y Web Vitals de la plataforma): solo API clásica, decisión de Dani.
- La vista (0053 y 0054). Aplicaciones móviles y personalizadas.
- Sesiones de usuario una a una (session replay) y desglose por navegador o país.

## Ideas surgidas (fuera de alcance)

- (developer) `countOfErrors` también tiene `Error origin` (`First party`, `Third party`): un
  desglose de errores propios frente a terceros podría servir en la vista; no se pide aquí.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA5 con su test y sin tocarlos tras `63a79d3`: CA2 fija `/api/v2/metrics/query`, el
`entitySelector`, el rango, ≤ 10 expresiones y sin `:fold`; CA3, `null`, totales de la consulta con
`Inf`, tipos de error con el resto en `other` y casado por posición; CA4, 400 y 404 con `reason`; CA5,
los dos e2e con el simulador que da 400 con más de 10. Las 18 expresiones son, carácter a carácter,
las del paso 0 (p75 en los Core Web Vitals, `:splitBy()` en porcentajes y usuarios, `"Error type"`);
solo API clásica, nada de Platform, Grail ni DQL. 2 bloques (10 y 8) × 2 resoluciones en paralelo.
Zod de entrada y salida, con tests de id de otro tipo e inyección; `reason` de la 0033 reutilizado;
sin CSP, permisos, dependencias ni esquema; nada del tenant.

Sugerencias, no bloquean:

- `seriesOf` y `totalOf` se quedan con la primera serie sin avisar: un aviso en `warnings` si llega
  más de una (como pasó con `browser.duration` en la 0023).
- `other` toma los timestamps del primer tipo: casarlos por timestamp si algún día difieren.

## Verificación

Tests escritos en `63a79d3` (`test(aplicacion): criterios de la ficha 0052 (#0052)`). Los
unitarios y el e2e fallan porque el canal no existe (`implementación de entities:applicationRum:
expected undefined`, `UNKNOWN_CHANNEL` en el e2e), no por el test: 17 de
`application-rum.test.ts`, más los registros de `channel-coverage.test.ts` y `modules.test.ts`, y
los 2 e2e de CA5.

| Criterio | Test                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/application-rum-explore.live.test.ts` › `CA1 (0052): el informe no contiene ningún id ni nombre observado` (ya pasa: paso 0 hecho)                  |
| CA2      | `src/main/ipc/handlers/application-rum.test.ts` › `CA2 (0052): ninguna consulta pasa de 10 expresiones y todas llevan el id y el rango`                               |
| CA3      | `src/main/ipc/handlers/application-rum.test.ts` › `CA3 (0052): transformación por papel, con papeles sin datos y null conservados`                                    |
| CA4      | `src/main/ipc/handlers/application-rum.test.ts` › `CA4 (0052): un 400 o un 404 de Dynatrace acaba en error con reason`                                                |
| CA5      | `e2e/views.spec.ts` › `CA5 (0052): entities:applicationRum por IPC con ids inventados: …` y `CA5 (0052): entities:applicationRum con un 400 del simulador acaba en …` |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-10:** 3 aplicaciones (2 de los problemas
de 7 días y 1 de `type("APPLICATION")`), `now-24h`, 96 peticiones GET, token fuera del log. Solo
API clásica (`GET /metrics/{metricId}` y `GET /metrics/query`). Informe en
`live-reports/application-rum-explore.json` (ignorado), sin ids ni nombres.

- **Todas las candidatas existen** (200 en `GET /metrics/{metricId}`, `resolutionInfSupported`),
  con la dimensión `dt.entity.application`. Con datos en las 3: `actionCount` y `actionDuration`
  de `load` y `xhr`, las de errores, sesiones, usuarios y Core Web Vitals. **Sin datos en
  ninguna:** `actionCount.custom.browser`, `actionDuration.custom.browser` y
  `event.count.rageClick`. `jsErrorsDuringUa` y `jsErrorsWithoutUa`, en 2 de 3.
- **Errores HTTP: se pueden separar.** `countOfErrors` tiene `Error type` (valores vistos:
  `JavaScript` y `Request`) y `Error origin` (`First party`, `Third party`). Con
  `countOfErrors:splitBy("Error type"):sum`, los tipos suman el total en el rango (Inf) y en cada
  intervalo en las 3, con los mismos timestamps. `jsErrorsDuringUa` + `jsErrorsWithoutUa` es igual
  al tipo `JavaScript`. Los HTTP son el tipo `Request`. (`errorCountForDavis` solo trae `Request`
  y añade `Error context`: no sirve para separar los de JavaScript.)
- **`activeUsersEst`:** con `resolution=Inf`, `:splitBy()` (igual que `:value`) da un valor
  distinto de la suma y del máximo de la serie y menor o igual que las sesiones: es la estimación
  de usuarios distintos del rango. `:sum` difiere menos del 1 % o es igual; `:avg`, no.
- **Porcentajes:** en `percentageOfUserActionsAffectedByErrors` y `bouncedSessionRatio`,
  `:splitBy()` es `:value`; `:avg` difiere con varios tipos de usuario (media sin ponderar de los
  tipos) y coincide con uno solo. Ninguno coincide con 100 × `countOfUserActionsWithErrors` /
  `actionCount.summary`. `sessionDuration` y `actionsPerSession`: `:splitBy()` es `:avg`.
- **Unidades** (descriptor y tramos): `sessionDuration` en **MicroSecond** (> 1e6);
  `bouncedSessionRatio` y `percentageOfUserActionsAffectedByErrors` en Percent (0 a 100); LCP e
  INP en MilliSecond (100 a 1e4); CLS Unspecified (0 a 1); `actionsPerSession` Count. INP no
  admite `avg` (sí `percentile`).

| Papel                | Expresión exacta del canal (prefijo `builtin:apps.web.`)                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `actionsByType`      | `actionCount.{load,xhr,custom}.browser:splitBy():sum`                                                                      |
| `durationByType`     | `actionDuration.{load,xhr,custom}.browser:splitBy():avg` (ms)                                                              |
| `errorsByType`       | `countOfErrors:splitBy("Error type"):sum` (`JavaScript` → `javascript`, `Request` → `http`, resto → `other`)               |
| `affectedActionsPct` | `percentageOfUserActionsAffectedByErrors:splitBy()` (%)                                                                    |
| `activeUsers`        | `activeUsersEst:splitBy()` (estimación)                                                                                    |
| `sessions`           | `startedSessions:splitBy():sum` y `endedSessions:splitBy():sum`                                                            |
| `sessionDuration`    | `sessionDuration:splitBy():avg` (µs)                                                                                       |
| `actionsPerSession`  | `actionsPerSession:splitBy():avg`                                                                                          |
| `bounceRate`         | `bouncedSessionRatio:splitBy()` (%)                                                                                        |
| `vitals`             | `{largestContentfulPaint.load.browser,cumulativeLayoutShift.load.browser,interactionToNextPaint}:splitBy():percentile(75)` |
| `rageClicks`         | `event.count.rageClick:splitBy():sum`                                                                                      |

Las 18, con `entitySelector=entityId("<id>")`, de 10 en 10: series sin `resolution` (`10m` con
`now-24h`) y totales con `resolution=Inf`, todas 200 en las 3 aplicaciones, `metricId` igual a la
expresión (también con las comillas de `"Error type"`), ratios ≤ 1 y una serie sin dimensiones
por expresión (salvo la de errores, una por tipo). En los recuentos, el total con Inf queda a
menos del 1 % de la suma de la serie.

**Decisiones del test-writer (delegadas por el Orquestador, refinables):**

- Forma de la salida: `resolution` (la de las series), `series` y `totals` con los once papeles
  de la especificación; cada serie `{ timestamps, values }` y cada total número o `null`.
- Todos los papeles tienen métrica en el catálogo: **ninguno es `null`**. Un papel sin datos
  (como `custom` y `rageClicks` en vivo) llega con serie vacía y total `null`, como en la 0033.
  `errorsByType` nunca es `null`: el paso 0 confirma que los tipos suman el total.
- `errorsByType`: un tipo sin series, vacío y total `null` (no `0`); los tipos que no son
  `JavaScript` ni `Request` (ninguno visto en vivo) se suman en `other`, intervalo a intervalo.
- Core Web Vitals con el percentil 75 (el criterio de Google; INP no admite media). Porcentajes y
  usuarios sin agregación (`:splitBy()`), porque `:avg` es la media sin ponderar de los tipos de
  usuario.
- Unidades sin convertir: la duración de sesión llega en µs (la vista la formatea).
- Totales de todos los papeles con `resolution=Inf` (no la suma de la serie).
- Casado por posición: el test cambia el `metricId` de la respuesta y el resultado no cambia.
- Un 400 o 404 lleva el `reason` de la 0033, `applicationMetricsRejected` (su texto, «la
  consulta de métricas de la aplicación», vale aquí; no hace falta clave nueva).
- El simulador de los e2e da 400 con más de 10 expresiones por consulta, como la API.

### Verifier, 2026-10-10, commit `857a4e2`, rango `main..feat/0052-aplicacion-rum-datos`: VERDE

- check: 3196 tests en 175 ficheros, cobertura ok.
- e2e completo (toca `src/shared/ipc.ts`): 341/341, sin intermitentes.

## Resultado

Canal `entities:applicationRum` (`src/shared/ipc.ts`, esquema `applicationRumResultSchema` en
`src/shared/modules.ts`), lógica en `src/main/modules/application-rum.ts` y handler en
`src/main/ipc/handlers/modules.ts`. Lo observado en vivo, en `docs/notas-api-v2.md` («RUM de una
aplicación web»).

**Decisiones del developer (delegadas, refinables):**

- Las 18 expresiones van en dos bloques fijos (10 y 8) y cada bloque se pide dos veces (series y
  `Inf`): 4 consultas en paralelo. El reparto sale de `METRIC_SELECTOR_MAX`, así que sumar una
  expresión no rompe el límite.
- La salida lleva también `warnings` y `partial` (recortes, `truncatedResults`), como el canal de
  la 0033, para que la vista pueda avisar igual.
- `other`, intervalo a intervalo, toma los timestamps del primer tipo «otro» (en vivo todos los
  tipos traen los mismos); null solo si todos los sumandos de ese intervalo lo son.
- `resolution` es la de la primera consulta de series (las dos usan el mismo rango).

`npm run check` en verde (175 ficheros, 3196 tests) y `npm run test:e2e:affected -- main..HEAD`
completo (toca `src/shared/ipc.ts`, transversal): 341 pasados.

**Cierre:** commits `63a79d3` (tests), `ac35870` (ficha y paso 0), `7db3ea3` (canal), `9990225` (notas de la API); ficheros principales `src/main/modules/application-rum.ts`, `src/main/ipc/handlers/modules.ts`, `src/shared/ipc.ts` y `src/shared/modules.ts`. Una ronda de revisión (aprobada a la primera). Sin ADR nuevo ni migraciones. Las sugerencias del revisor y la idea de `Error origin` pasaron a «Mejoras anotadas» del `BACKLOG.md`.
