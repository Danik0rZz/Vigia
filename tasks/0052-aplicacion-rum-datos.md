---
id: '0052'
titulo: 'APPLICATION (RUM): datos de actividad por tipo de acción, errores por tipo, usuarios, sesiones y experiencia'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
