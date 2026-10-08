---
id: '0023'
titulo: 'Monitores: canal con el desglose por localización y por paso o petición'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0022']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0023-monitores-desglose-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/query` con las métricas por localización y por paso o petición que eligió la 0022; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read`.
migracion: no
rondas_revision: 1
---

## Petición original

Lote «monitores» (0022 a 0026). "SYNTHETIC_TEST tiene disponibilidad, rendimiento, localizaciones,
pasos…". La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

**Canal `entities:monitorBreakdown`** (Zod), con las métricas que la 0022 dejó en su tabla para
"Por localización" y "Por paso / petición":

- Entrada: `environmentId`, `entityId` (mismo patrón que la 0022) y `timeRange`.
- Salida:
  - `locations`: por localización, `id`, `name` (del `dimensionMap`; si no viene, el id),
    `availability` (% del rango), `duration` (media, ms) y `failed` (ejecuciones fallidas, si hay
    métrica). Ordenadas de peor a mejor disponibilidad.
  - `steps`: por paso (browser) o petición (HTTP), `id`, `name`, `duration` (media, ms) y su peso en
    la duración total (%), en el orden del monitor si la dimensión lo da (número de secuencia) o por
    duración. Si la 0022 no encontró métrica por paso, `null`.
- Main construye los selectores con el id validado. Errores con `reason`. El simulador responde.

**Decisión del Orquestador (2026-10-08, delegada por Dani; refinable):** la 0022 encontró métrica de pasos
o peticiones para los dos tipos de monitor, así que la rama «sin métrica de pasos, `steps` es `null`» de CA3
no aplica a ningún tipo actual. `steps` es siempre una lista (vacía si no hay series); CA3 se cumple en lo
que aplica (nombres de `dimensionMap` o el id). Si un tipo futuro no tiene métrica de pasos, se añade
entonces la rama `null` con su test.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, main): con `fetch` simulado, las consultas llevan las métricas de la 0022 con su
  `splitBy` por localización y por paso, el id y el rango.
- CA2 (unitario, main): de una respuesta con 4 localizaciones y 5 pasos salen ordenadas por
  disponibilidad y por secuencia (o duración), con el peso de cada paso.
- CA3 (unitario, main): nombres de `dimensionMap`; si faltan, el id. Sin métrica de pasos, `steps`
  es `null`.
- CA4 (unitario, main): 400 o 404 → error con `reason`.
- CA5 (e2e): el simulador responde y un test por IPC recibe lo esperado de los dos tipos.

## Pruebas a mano para Dani

(en la 0025)

## Fuera de alcance

- Mapas de localizaciones o gráficos por localización.

## Ideas surgidas (fuera de alcance)

- Ordenar los pasos en el orden del monitor con `sequenceNumber` de las entidades de paso
  (`GET /entities` con `type("SYNTHETIC_TEST_STEP")` o `type("HTTP_CHECK_STEP")`, `isStepOf` y
  `+properties`): una petición más; la dimensión de la métrica no lo trae.

## Notas del revisor

### Ronda 1: APROBADO

- Las 7 expresiones coinciden carácter por carácter con las confirmadas en vivo, con su ámbito (`entityId` o
  `isStepOf`); id validado (sin inyección); `Inf` sin `fold`/`:last`.
- CA1-CA5 con su test; orden, `share`, `failed` y `steps` como dice la ficha; tests sin tocar salvo el
  inventario de canales; `monitorBreakdownRejected` (ADR-0005); sin datos del tenant.
- Opcional: en browser, la de pasos va en la misma consulta que las de localización y en vivo se probó
  sola (mismo ámbito, riesgo bajo); añadirla a `CHANNEL_LOCATIONS.browser` en la próxima pasada en vivo.

## Verificación

Tests escritos en `8a225df` (`test(monitores): criterios de la ficha 0023`). Los unitarios y el e2e
fallan porque el canal no existe (`implementación de entities:monitorBreakdown: expected undefined`
en los 20 unitarios nuevos; `UNKNOWN_CHANNEL` en el e2e), no por el test.

| Criterio | Test                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA1      | `src/main/ipc/handlers/monitor-breakdown.test.ts` › `CA1 (0023): las consultas llevan las métricas confirmadas, con su splitBy, el id y el rango` (e id no válido) |
| CA2      | `src/main/ipc/handlers/monitor-breakdown.test.ts` › `CA2 (0023): 4 localizaciones y 5 pasos, ordenados y con el peso de cada paso`                                 |
| CA3      | `src/main/ipc/handlers/monitor-breakdown.test.ts` › `CA3 (0023): nombres de dimensionMap o, si faltan, el id; steps según la métrica de pasos` (ver la nota)       |
| CA4      | `src/main/ipc/handlers/monitor-breakdown.test.ts` › `CA4 (0023): errores de Dynatrace` (400 y 404, browser y http)                                                 |
| CA5      | `e2e/views.spec.ts` › `CA5 (0023): entities:monitorBreakdown por IPC con ids inventados de browser y HTTP monitor`                                                 |

**Lectura en vivo (solo lectura), 2026-10-08:** `src/main/modules/monitor-breakdown-explore.live.test.ts`,
3 browser monitors y 3 HTTP monitors (de los problemas de 7 días y de `type(...)`), `now-24h`, 118
GET, token fuera del log. Informe en `live-reports/monitor-breakdown-explore.json` (ignorado), sin
ids ni nombres. Cada expresión, sola y en el selector del canal, con y sin `resolution=Inf`: todas
200, ratios < 0,01 y como mucho 9 series (lejos del tope de 1000).

- **Ámbito:** `browser.duration` y `browser.step.duration` con `entitySelector=entityId("<id>")`
  (o con `type("SYNTHETIC_TEST_STEP"),fromRelationships.isStepOf(...)`) **no se acotan**: traen las
  series de todos los monitores del entorno (más series que localizaciones o pasos, y las mismas en
  los 3 monitores). Las acota `:filter(eq("dt.entity.synthetic_test","<id>"))`, con o sin
  `entitySelector`. `browser.availability` sí se acota con `entityId`. En HTTP,
  `request.duration.geo` con `entityId` del monitor sale vacía; la acota el selector de los pasos
  por la relación `isStepOf`.
- **Nombres:** con `:names`, `dimensionMap` trae `dt.entity.synthetic_location.name`,
  `dt.entity.synthetic_test_step.name` y `dt.entity.http_check_step.name` en todas las series.
- **Secuencia:** ninguna dimensión trae número de secuencia. Está en las `properties` de las
  entidades de paso (`sequenceNumber`, en SYNTHETIC_TEST_STEP y HTTP_CHECK_STEP).
- **Orden:** las series de cada métrica no llegan en el mismo orden de localizaciones: se casan por id.
- **metricId:** con `filter(eq(...))` la API devuelve la expresión sin las comillas del valor
  (`eq("dt.entity.synthetic_test",<id>)`, `eq("Result status",FAILURE)`): no es igual a la enviada;
  los resultados se casan por posición.
- **Fallidas por localización:** el browser monitor no tiene métrica (`browser.failure` solo tiene
  la dimensión del monitor y el catálogo no tiene otra con la de localización). En HTTP,
  `resultStatus` FAILURE por localización; sin fallos, la localización no trae serie.

**Expresiones confirmadas** (las únicas que aceptan los tests de CA1; `<id>` es el id validado):

| Tipo    | Papel                   | Expresión                                                                                                                                  | Ámbito (`entitySelector`)                                              |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| browser | Disponibilidad por loc. | `builtin:synthetic.browser.availability:splitBy("dt.entity.synthetic_location"):avg:names`                                                 | `entityId("<id>")`                                                     |
| browser | Duración por loc.       | `builtin:synthetic.browser.duration:filter(eq("dt.entity.synthetic_test","<id>")):splitBy("dt.entity.synthetic_location"):avg:names`       | `entityId("<id>")` o ninguno                                           |
| browser | Duración por paso       | `builtin:synthetic.browser.step.duration:filter(eq("dt.entity.synthetic_test","<id>")):splitBy("dt.entity.synthetic_test_step"):avg:names` | `entityId("<id>")` o ninguno                                           |
| http    | Disponibilidad por loc. | `builtin:synthetic.http.availability:splitBy("dt.entity.synthetic_location"):avg:names`                                                    | `entityId("<id>")`                                                     |
| http    | Duración por loc.       | `builtin:synthetic.http.duration.geo:splitBy("dt.entity.synthetic_location"):avg:names`                                                    | `entityId("<id>")`                                                     |
| http    | Fallidas por loc.       | `builtin:synthetic.http.resultStatus:filter(eq("Result status","FAILURE")):splitBy("dt.entity.synthetic_location"):sum:names`              | `entityId("<id>")`                                                     |
| http    | Duración por petición   | `builtin:synthetic.http.request.duration.geo:splitBy("dt.entity.http_check_step"):avg:names`                                               | `type("HTTP_CHECK_STEP"),fromRelationships.isStepOf(entityId("<id>"))` |

Las de localización de cada tipo se probaron también juntas en una consulta con `entityId`.
`http.availability.location.total` con el mismo `splitBy` también responde bien, pero no se usa (la
tabla de la 0022 eligió `http.availability` para «por localización»).

**Decisiones del test-writer (delegadas por Dani, a refinar si hace falta):**

- Todas las consultas con `resolution=Inf` (valor del rango, sin `fold`) y el rango del usuario;
  cada expresión una vez y ≤ 10 por consulta. Cuántas consultas haga main es libre.
- Salida: `{ locations: [{ id, name, availability, duration, failed }], steps: [{ id, name, duration, share }] | null }`
  (puede llevar más campos, como `warnings` y `partial`). `share` es el peso en % (0–100) sobre la
  **suma de las duraciones de los pasos**: suman 100.
- Localizaciones de peor a mejor disponibilidad; sin disponibilidad (null), al final. Fallidas:
  `null` en browser (no hay métrica); en HTTP, `0` si la localización no trae serie de FAILURE.
- Pasos **por duración, de mayor a menor**: la dimensión no da número de secuencia (la ficha pide
  el orden del monitor solo si lo da la dimensión).
- Solo entran las localizaciones y los pasos que llegan en las series confirmadas.
- Un id que no cumple el patrón de la 0022 se rechaza sin llamar a Dynatrace.

**Nota sobre CA3 («sin métrica de pasos, `steps` es `null`»):** tal como está escrito no se puede
probar: la 0022 encontró métrica de pasos para los dos tipos, así que con el catálogo actual
`steps` nunca es `null`. El test de CA3 comprueba que es una lista (vacía si no hay series) en los
dos tipos; la rama `null` queda sin test hasta que haya un tipo sin métrica de pasos.

### Verifier, 2026-10-08, commit `dda2c91`, rango `main..dda2c91`: VERDE

- check: 2389 tests en 126 ficheros, cobertura ok.
- e2e completo (ventana del CI): 244/244.

## Resultado

**Desarrollo (developer, 2026-10-08):** canal en `fe270c6`. En `d8f0e1b`, el canal se registra en
los tests de cobertura de canales (`channel-coverage.test.ts` y `modules.test.ts`); no son de la
ficha: cada canal nuevo se añade ahí, como en la 0022.

- Lógica en `src/main/modules/monitor-breakdown.ts` (`monitorBreakdownQueries` y
  `toMonitorBreakdown`); canal en `createModuleHandlers`; esquemas en `src/shared/modules.ts`
  (`monitorBreakdownResultSchema`, con `warnings` y `partial` por `truncatedResults`).
- **Decisión (developer):** en browser, una consulta con `entityId` y sus 3 expresiones (las de
  duración admiten ese ámbito); en HTTP, dos: las 3 de localización con `entityId` y la de
  peticiones con el selector `isStepOf`. Todas con `resolution=Inf`; los resultados se casan por
  posición y las series por id.
- **Decisión (developer):** `share` es `null` si el paso no tiene duración o la suma es 0; los pasos
  sin duración van al final.
- Error 400 o 404 con `reason` `monitorBreakdownRejected` (es y en).

**Cierre (doc-writer, 2026-10-08):** rama `feat/0023-monitores-desglose-datos` (`8a225df`..`859cbf3`: tests, canal `fe270c6`, registro en cobertura `d8f0e1b`). Ficheros principales: `src/main/modules/monitor-breakdown.ts`, `src/main/ipc/handlers/modules.ts`, `src/shared/modules.ts`, `e2e/views.spec.ts`. 1 ronda de revisión (aprobada), sin ADR nuevo, sin migración. Sin cambios visibles (CHANGELOG: lo pinta la 0025). Notas en vivo en `docs/notas-api-v2.md`.
