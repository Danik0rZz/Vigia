---
id: '0031'
titulo: 'PROCESS_GROUP: análisis de métricas en vivo y canal de series, marcadores e instancias'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0031-grupo-procesos-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:tech.generic.*`), `GET /metrics/{metricId}`, `GET /metrics/query` (`entitySelector` con `fromRelationships`/`toRelationships`) y `GET /entities`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read` (ya en uso).
migracion: no
rondas_revision: 1
---

## Petición original

Lotes «grupo-procesos» (0031 y 0032) y «aplicacion» (0033 y 0034). Dani (2026-10-09): "Haz lo
mismo para process_group, Application", como con SERVICE, HOST, los monitores y el proceso.

## Especificación

**Qué es:** un process group agrupa las instancias de un mismo proceso (`PROCESS_GROUP_INSTANCE`)
en uno o varios hosts. Su página enseña el conjunto y deja ir a cada instancia.

**Paso 0, en vivo y solo lectura** (patrón de `process-metrics-explore.live.test.ts`, 3 grupos de
los procesos de los hosts de los problemas de los últimos 7 días; informe sin ids ni nombres):

- qué métricas que ya usa la página del proceso (0027) se pueden pedir para el grupo: con
  `entitySelector=type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<id>"))`
  (o la relación que confirme la exploración) y `splitBy()` para el total del grupo, y con
  `splitBy("dt.entity.process_group_instance")` por instancia;
- si `dimensionMap` trae el nombre de la instancia y cómo saber su host (relación de la entidad o
  dimensión `dt.entity.host`);
- tramos de número de instancias por grupo.

**Canal `entities:processGroupMetrics`** (Zod), con el patrón de `entities:processMetrics`:

- Entrada: `environmentId`, `entityId` (`^PROCESS_GROUP-[0-9A-F]{16}$`) y `timeRange`.
- Salida: `series` del grupo (CPU total de las instancias en %, memoria total en bytes, red de
  entrada y salida) y `totals` (CPU media y máxima, memoria media, red media); más `instances`:
  por instancia, `id`, `name`, `hostId`/`hostName` si los da la exploración, CPU media y memoria
  media, ordenadas por CPU, con `total`.
- Los papeles sin métrica, `null`. Errores con `reason`. El simulador de los e2e responde.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice qué selector funciona para el grupo y por instancia y si
  llegan nombres y hosts, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de PROCESS_GROUP y rechaza otros.
- CA3 (unitario, main): con `fetch` simulado, las consultas llevan las métricas, el selector
  confirmado, el id y el rango.
- CA4 (unitario, main): transformación de series, totales e instancias (ordenadas por CPU, `total`,
  papeles `null`).
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin datos → series e instancias vacías.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0032)

## Fuera de alcance

- La vista (0032). Métricas de tecnología (JVM, .NET…).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA6 con su test y sin tocar tests tras `05c1854`. Canal Zod de entrada y salida
(`processGroupEntityIdSchema` impide inyección en el `entitySelector`), red en main, `reason`
`processGroupMetricsRejected` en es y en (ADR-0005). Expresiones de `/metrics/query` las del paso 0
en vivo; `isInstanceOf`, `:names` y `:parents` en la OpenAPI. Ids de test inventados; el live no
escribe el token.

Tope de 1000 series: la consulta de marcadores da 4 + 2·N series, así que desde unas 498 instancias
en el rango llega recortada. El canal lo avisa en `partial` (como `entities:hostBreakdown`), pero
`instances.total` cuenta solo las recibidas, el subconjunto no es el de más CPU y ningún test
comprueba `partial` con ratio > 1. No bloquea: en vivo los grupos tenían de 2 a 4 instancias.

Sugerencias, no bloquean:

- Escribir el límite efectivo (unas 498 instancias) en la cabecera de `process-group-metrics.ts`.
- Un test con `dimensionCountRatio` > 1 en las expresiones por instancia que compruebe `partial`.
- Para la 0032: con `partial` no vacío, aviso de recorte y no presentar `instances.total` como el
  total real (anotado en la 0032 por el Orquestador). Quedarse con las de más CPU (`:sort`/`:limit`)
  cambiaría el comportamiento: queda como idea para Dani.

## Verificación

Tests escritos en `05c1854` (`test(grupo-procesos): criterios de la ficha 0031`). Los unitarios
y el e2e fallan porque el canal no existe (`canal entities:processGroupMetrics: expected
undefined`, `implementación de entities:processGroupMetrics: expected undefined`,
`UNKNOWN_CHANNEL` en el e2e), no por el test: 34 unitarios en rojo (19 de CA2, 13 de CA3 a CA5 y
los registros de `channel-coverage.test.ts` y `modules.test.ts`) y el e2e de CA6 en rojo.

| Criterio | Test                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/process-group-metrics-explore.live.test.ts` › `CA1 (0031): el informe no contiene ningún id ni nombre observado` (ya pasa: paso 0 hecho) |
| CA2      | `src/shared/ipc.test.ts` › `CA2 (0031): entrada de entities:processGroupMetrics`                                                                           |
| CA3      | `src/main/ipc/handlers/process-group-metrics.test.ts` › `CA3 (0031): las consultas llevan las métricas, el selector confirmado, el id y el rango`          |
| CA4      | `src/main/ipc/handlers/process-group-metrics.test.ts` › `CA4 (0031): series, totales e instancias del grupo`                                               |
| CA5      | `src/main/ipc/handlers/process-group-metrics.test.ts` › `CA5 (0031): errores de Dynatrace y grupo sin datos`                                               |
| CA6      | `e2e/views.spec.ts` › `CA6 (0031): entities:processGroupMetrics por IPC con ids inventados: dos consultas, total del grupo e instancias`                   |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-09:** 3 grupos de los procesos del host de
los problemas de los últimos 7 días (10 candidatos, todos con 2 a 4 instancias), `now-24h`, unas
150 peticiones GET, token fuera del log. Informe en
`live-reports/process-group-metrics-explore.json` (ignorado), sin ids ni nombres.

- `cpu.usage`, `mem.workingSetSize`, `network.bytesRx` y `network.bytesTx` solo tienen la
  dimensión `dt.entity.process_group_instance` (ninguna de grupo): con `entityId("<grupo>")` no
  llega ninguna serie.
- **Selector que funciona:**
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<id>"))`. En
  `/entities` da las mismas instancias que `toRelationships.isInstanceOf` de la entidad del
  grupo; en `/metrics/query`, tantas series por instancia como instancias.
- **Total del grupo:** `:splitBy():sum` es, punto a punto, igual a la suma de las series por
  instancia (`:splitBy()` y `:splitBy():avg` dan la media de las instancias, no el total). Con
  `resolution=Inf`, `:splitBy():sum` queda a menos del 1 % de la media de esa suma (en un grupo
  con CPU casi a cero, más: valores en [0, 1]). Ninguna expresión con `Inf` da el máximo de la
  suma (`:max` y la suma de máximos por instancia no coinciden).
- **Por instancia:** `:splitBy("dt.entity.process_group_instance"):names` trae
  `dt.entity.process_group_instance.name`; con `:parents` delante y
  `splitBy("dt.entity.process_group_instance","dt.entity.host")`, además `dt.entity.host` (un
  `HOST-…`) y `dt.entity.host.name`. Cada instancia tiene un host (`isProcessOf`).
- Consultas exactas del canal, comprobadas en los 3 grupos con el selector de arriba (todas 200,
  `metricId` igual a la expresión, una serie por expresión del total y una por instancia en las
  medias; las instancias de CPU y de memoria, las mismas y tantas como entidades; todas con
  nombre, host y nombre del host):
  - series, sin `resolution` (`10m` con `now-24h`): `cpu.usage:splitBy():sum`,
    `mem.workingSetSize:splitBy():sum`, `network.bytesRx:splitBy():sum` y
    `network.bytesTx:splitBy():sum`;
  - marcadores, con `resolution=Inf`: las cuatro de arriba (media del total) y
    `cpu.usage:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names` y
    lo mismo con `mem.workingSetSize` (medias por instancia, a menos del 1 % de la media de su
    serie).
- Dos de los tres grupos no traen red: sin series en esas métricas.

**Decisiones del test-writer (delegadas por el Orquestador, refinables):**

- Forma de la salida: `series` con `cpu`, `memory` y `network` (`in`/`out`); `totals` con
  `cpu: { avg, max }`, `memory: { avg }` y `network: { in, out }`; `instances: { items, total }`
  (como `processes` de `entities:hostBreakdown`), cada una con `id`, `name`, `hostId`, `hostName`,
  `cpu` (media) y `memory` (media). Más `resolution`, `warnings` y `partial`, como en la 0027.
- Los cuatro papeles tienen métrica: un papel sin datos llega con series vacías (no `null`); los
  `null` de CA4 son los de los totales sin dato y los de cada instancia (CPU o memoria sin dato,
  host que no llega en `dimensionMap`). Sin nombre en `dimensionMap`, `name` es el id.
- La CPU máxima del grupo es el máximo de la serie del total (ninguna expresión con `Inf` lo da).
- Instancias de CPU y memoria casadas por id; ordenadas por CPU media de más a menos, las de CPU
  `null` al final. Sin tope: `total` es el número de instancias.
- Dos peticiones, las dos a `/metrics/query`: nombres y hosts llegan en `dimensionMap`, no hace
  falta `/entities`.

### Verifier, 2026-10-09, commit `9910bd6`, rango `main..feat/0031-grupo-procesos-datos`: VERDE

- check: 2540 tests en 142 ficheros, cobertura ok.
- e2e completo (toca `src/shared/ipc.ts`): 280/280.

## Resultado

Commits: `05c1854` (tests), `14b4efe` (canal), más los de ficha. Ficheros principales:
`src/shared/ipc.ts`, `src/shared/modules.ts`, `src/shared/error-reasons.ts`,
`src/main/modules/process-group-metrics.ts`, `src/main/ipc/handlers/modules.ts`, tests unitarios,
`process-group-metrics-explore.live.test.ts` y `e2e/views.spec.ts`. Una ronda de revisión
(APROBADO), verifier en verde. Sin ADR nuevo ni migraciones. Lo observado en vivo, en
`docs/notas-api-v2.md`. Sugerencias del revisor e idea de las instancias de más CPU, en
«Mejoras anotadas» del BACKLOG.

**Developer (`14b4efe`):** canal `entities:processGroupMetrics` en `src/shared/ipc.ts` (esquemas
`processGroupEntityIdSchema` y `processGroupMetricsResultSchema` en `src/shared/modules.ts`),
lógica pura en `src/main/modules/process-group-metrics.ts` y handler en
`src/main/ipc/handlers/modules.ts` con el patrón de `entities:processMetrics` (dos consultas a
`/metrics/query` en paralelo). Un 400 o 404 lleva `reason` `processGroupMetricsRejected` (es y en).

Decisiones del developer (refinables):

- Las expresiones se casan por posición, como en el proceso (cada una vuelve en el orden pedido).
- Instancias: primero las de la consulta de CPU, después las que solo traen memoria; nombre y host,
  del primer `dimensionMap` que los traiga. Empates de CPU, en el orden de la API.
