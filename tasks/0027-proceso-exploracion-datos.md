---
id: '0027'
titulo: 'PROCESS_GROUP_INSTANCE: análisis de métricas en vivo y canal de series y marcadores'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: proceso
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0027-proceso-exploracion-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:tech.generic.*` y `builtin:pgi.*`, `fields`), `GET /metrics/{metricId}` y `GET /metrics/query`; `GET /entities/{entityId}` (de la 0014) para PROCESS_GROUP_INSTANCE; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read` y `entities.read`.
migracion: no
rondas_revision: 1
---

## Petición original

Lote «proceso» (0027 a 0029). Dani pidió la página de PROCESS_INSTANCE (en Vigía,
`PROCESS_GROUP_INSTANCE`, «Proceso») con sus métricas clave, después de analizarlas. La petición
completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

**Análisis de métricas (paso 0, en vivo y solo lectura),** con la misma regla que la 0022:

1. **Catálogo:** `GET /metrics?metricSelector=builtin:tech.generic.*` y `builtin:pgi.*`, con unidad,
   dimensiones y agregaciones.
2. **Con datos:** para 3 procesos de los hosts de los problemas de los últimos 7 días (o
   `type("PROCESS_GROUP_INSTANCE")` con `pageSize` 3), qué métricas tienen datos en `now-24h` con
   `entitySelector=entityId("<id>")`.
3. **Elección por papel** (la primera del catálogo con datos):

| Papel          | Qué se busca                                             |
| -------------- | -------------------------------------------------------- |
| CPU            | uso de CPU del proceso (%)                               |
| Memoria        | memoria del proceso (working set o residente, bytes)     |
| Red            | bytes recibidos y enviados (o tráfico) del proceso       |
| Salud de red   | retransmisiones o tiempo de respuesta de red, si existen |
| Disponibilidad | estado o disponibilidad del proceso, si existe           |
| Recursos       | hilos, handles o descriptores de fichero, si existen     |

Lo que no tenga métrica no se pinta y se anota. Métricas de tecnologías concretas (JVM, .NET,
Node…) quedan fuera (ver "Fuera de alcance"). 4. **Entidad:** claves de `properties` y relaciones de los procesos de muestra (solo nombres). **Se
comprueba si alguna clave lleva la línea de comandos o argumentos** (por ejemplo, dentro de
`metadata`): pueden llevar contraseñas y no se enseñan (0029).

Informe solo de comportamientos; la tabla final va a "Resultado" y a `docs/notas-api-v2.md`.

**Canal `entities:processMetrics`** (Zod), con el patrón de `entities:hostMetrics`:

- Entrada: `environmentId`, `entityId` (`^PROCESS_GROUP_INSTANCE-[0-9A-F]{16}$`) y `timeRange`.
- Series y marcadores por papel (`cpu`, `memory`, `network` con `in`/`out`, `networkHealth`,
  `availability`, `resources`); los papeles sin métrica, `null`. Marcadores: CPU media y máxima,
  memoria media y máxima, red media de entrada y salida, y el del papel de disponibilidad o
  recursos si hay.
- Errores con `reason`; sin datos, series vacías. El simulador responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe trae el catálogo, qué métricas tienen datos, las claves de la
  entidad y si alguna lleva línea de comandos, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de PROCESS_GROUP_INSTANCE y rechaza otros.
- CA3 (unitario, main): con `fetch` simulado, las consultas llevan las métricas elegidas, el id y
  el rango.
- CA4 (unitario, main): transformación por papel, con papeles `null`.
- CA5 (unitario, main): 400 o 404 → error con `reason`.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0028)

## Fuera de alcance

- Métricas de tecnología (JVM: heap y GC; .NET; Node.js…): cada una, su ficha si Dani las quiere.
- Logs del proceso.

## Ideas surgidas (fuera de alcance)

(ninguna)

**Decisiones del developer (2026-10-08):** las series de los seis papeles no son nullables en el
esquema de salida (`processMetricsResultSchema`, en `src/shared/modules.ts`): con la decisión del
Orquestador todos tienen métrica, y un papel sin datos llega con series vacías. Los resultados se
casan por posición, como en el host y el monitor (`src/main/modules/process-metrics.ts`). 400 y 404
llevan el reason nuevo `processMetricsRejected` (es y en).

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA6 con su test y en rojo sin el canal; el developer no tocó tests. El ajuste de `bb10baf` lo hizo el test-writer tras la decisión del Orquestador: el «papeles null» de CA4 se prueba con marcadores a `null`. Canal con Zod de entrada (id estricto) y salida, selectores en main, `reason` nuevo `processMetricsRejected` en es y en (ADR-0005). Endpoints y parámetros en la OpenAPI v2; expresiones las confirmadas en vivo. Live de solo lectura sin ids, nombres ni valores; ids de test inventados.

Sugerencias, no bloquean:

- Tabla final en `docs/notas-api-v2.md` y en "Resultado" (doc-writer), con las lecciones: `network.packets.retransmissionIn/Out` y `sessions.connectivity` sin `resolution=Inf`; métricas sin dimensiones (`fileDescriptorsPercentUsed.new`) que con `entityId(...)` traen series de otros procesos; `COMMAND_LINE_ARGS` y `EXE_PATH` en `metadata`. Quizá también en `src/main/CLAUDE.md`.
- `fileDescriptorsPercentUsed` con valores en [0, 1] aunque diga Percent: lo mira la 0028.

## Verificación

Tests escritos en `859ea92` (`test(proceso): criterios de la ficha 0027`) y ajustados a la
decisión del Orquestador en `bb10baf` (`test(proceso): red y salud de red en los criterios de la
ficha 0027`). Los unitarios y el e2e
fallan porque el canal no existe (`canal entities:processMetrics: expected undefined`,
`implementación de entities:processMetrics: expected undefined`, `UNKNOWN_CHANNEL` en el e2e), no
por el test: 31 unitarios en rojo (18 de CA2, 11 de CA3 a CA5 y los registros de
`channel-coverage.test.ts` y `modules.test.ts`) y el e2e de CA6 en rojo.

| Criterio | Test                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/process-metrics-explore.live.test.ts` › `CA1 (0027): el informe no contiene ningún id ni nombre observado` (ya pasa: paso 0 hecho) |
| CA2      | `src/shared/ipc.test.ts` › `CA2 (0027): entrada de entities:processMetrics`                                                                          |
| CA3      | `src/main/ipc/handlers/process-metrics.test.ts` › `CA3 (0027): las consultas llevan las métricas elegidas, el id y el rango` (relativo y absoluto)   |
| CA4      | `src/main/ipc/handlers/process-metrics.test.ts` › `CA4 (0027): la respuesta se transforma por papel, con papeles null` (con el proceso sin red)      |
| CA5      | `src/main/ipc/handlers/process-metrics.test.ts` › `CA5 (0027): errores de Dynatrace y proceso sin datos`                                             |
| CA6      | `e2e/views.spec.ts` › `CA6 (0027): entities:processMetrics por IPC con un id inventado: dos consultas, series por papel y marcadores`                |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-08:** 3 procesos (2 de los hosts de los
problemas de los últimos 7 días y 1 de `type("PROCESS_GROUP_INSTANCE")`), `now-24h`, 142
peticiones GET, token fuera del log. Informe en `live-reports/process-metrics-explore.json`
(ignorado), sin ids ni nombres.

- Catálogo: `builtin:tech.generic.*` da 59 métricas y `builtin:pgi.*` 2, en una sola página.
  `network.packets.retransmissionIn`/`Out` y `network.sessions.connectivity` no admiten
  `resolution=Inf` (una tanda con ellas da 400). Varias métricas de red (`packets.reRx`,
  `sessions.new`…) van por `dt.entity.host` y `dt.entity.network_interface`, no por el proceso;
  sus variantes `…Aggr` sí van por el proceso. `handles.fileDescriptorsPercentUsed.new` y
  `mem.usage.new` no tienen dimensiones: con `entityId(...)` la primera devuelve más de 1000
  series de otros procesos (no se usa).
- Con datos en las 3 muestras: `cpu.usage`, `mem.usage`, `mem.workingSetSize`,
  `mem.pageFaults`, `handles.fileDescriptorsUsed`, `processCount` y `pgi.availability`; en 2 de
  3: `handles.fileDescriptorsPercentUsed`, `handles.fileDescriptorsMax`, `io.*` y
  `pgi.availability.state` (por `availability.state`, con varias series). **Ninguna métrica de red
  ni de salud de red tiene datos en las muestras.** En el entorno sí las hay en otras instancias
  (`network.bytesRx`/`Tx`, `traffic.*`, `packets.retransmission`, `roundTrip`, `latency`…):
  en una instancia con datos de red, `bytesRx`, `bytesTx`, `:avg`, `packets.retransmission` y
  `roundTrip` dan 200, una serie y `metricId` igual a la expresión (con muchos puntos a null).
- Elección por papel (regla de la ficha, la primera del catálogo con datos en las muestras):

| Papel          | Métrica                                                   | Unidad  | Series (sin resolution) | Marcador (Inf) |
| -------------- | --------------------------------------------------------- | ------- | ----------------------- | -------------- |
| CPU            | `builtin:tech.generic.cpu.usage`                          | Percent | tal cual (avg)          | `:avg`, `:max` |
| Memoria        | `builtin:tech.generic.mem.workingSetSize`                 | Byte    | tal cual (avg)          | `:avg`, `:max` |
| Red            | sin métrica (`null`): sin datos en las muestras           |         |                         |                |
| Salud de red   | sin métrica (`null`): sin datos en las muestras           |         |                         |                |
| Disponibilidad | `builtin:pgi.availability`                                | Percent | tal cual (avg)          | `:avg`         |
| Recursos       | `builtin:tech.generic.handles.fileDescriptorsPercentUsed` | Percent | tal cual (avg)          | `:max`         |

- Consultas exactas del canal, comprobadas en las 3 muestras y en la instancia con red, con
  `entitySelector=entityId("<id>")`: series `cpu.usage,mem.workingSetSize,pgi.availability,handles.fileDescriptorsPercentUsed`
  sin `resolution` (`10m` con `now-24h`) y marcadores
  `cpu.usage:avg,cpu.usage:max,mem.workingSetSize:avg,mem.workingSetSize:max,pgi.availability:avg,handles.fileDescriptorsPercentUsed:max`
  con `resolution=Inf`: todas 200, `metricId` igual a la expresión, una serie como mucho y ratios
  < 0,01. Un proceso sin descriptores de fichero (el que no trae `handles.*`) llega sin series en
  esa métrica.
- `fileDescriptorsPercentUsed` dice Percent pero sus valores observados están en [0, 1]: puede
  ser fracción o un uso bajo; lo mira la 0028 al pintar.
- Entidad (`GET /entities/{id}` con `+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms`):
  - `properties`: `awsNameTag`, `detectedName`, `ebpfHasPublicTraffic`, `hasPublicTraffic` y
    `metadata` en las 3; no siempre `bitness`, `processType`, `softwareTechnologies`,
    `logFileStatus`, `logPathLastUpdate` y `logSourceState`.
  - `metadata` es una lista de `{key, value}`; claves vistas: `COMMAND_LINE_ARGS`, `EXE_NAME`,
    `EXE_PATH`, `OSAGENT_GROUPID_NAME`, `OSAGENT_INSTANCEID_NAME` y `KUBERNETES_*`. **La línea
    de comandos llega en `metadata` con la clave `COMMAND_LINE_ARGS`** (en 2 de 3), y la ruta en
    `EXE_PATH`: no se enseñan (0029).
  - Relaciones: `fromRelationships.isInstanceOf` (PROCESS_GROUP), `fromRelationships.isProcessOf`
    (HOST), a veces `toRelationships.isHostGroupOf` (HOST_GROUP) y, en contenedores,
    `fromRelationships.isPgiOfCgi` e `isMainPgiOfCgi` (CONTAINER_GROUP_INSTANCE).
    `firstSeenTms` y `lastSeenTms`, números.

**Para el Orquestador (decisión de alcance):** con la regla de la ficha, red y salud de red se
quedan en `null` y los tests lo fijan así (CA4 pide papeles `null`). Las métricas de red existen y
tienen datos en otras instancias del entorno; si Dani quiere red en la página del proceso, las
expresiones ya están probadas en vivo (arriba) y es un cambio pequeño en el canal y en sus tests.

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-08:** red y salud de red
**entran** en el canal. La regla de "la primera con datos en las muestras" buscaba no pintar
métricas que no existen en el entorno; estas existen y tienen datos en otras instancias, y la
especificación del canal pide el marcador de red media de entrada y salida. Así:

- `network` con `in` = `builtin:tech.generic.network.bytesRx` y `out` = `…bytesTx`; `networkHealth`
  con `builtin:tech.generic.network.packets.retransmission` (si en vivo no admite `resolution=Inf`
  o no da una serie por proceso, `roundTrip`; si ninguna, `networkHealth` se queda en `null`).
- Antes de cambiar los tests, se confirman en vivo (solo lectura) las **consultas exactas** del
  canal con estas métricas añadidas, series sin `resolution` y marcadores con `resolution=Inf`
  (`:avg` de entrada y salida), en las 3 muestras y en la instancia con red, y se anota aquí.
- Un proceso sin datos de red recibe series vacías en ese papel (como el que no trae `handles.*`),
  no `null`: `null` queda para el papel sin métrica en el canal. CA4 sigue probando `null` con
  `networkHealth` si no hay métrica válida, o con un papel sin series en la respuesta simulada,
  según cómo trate el canal la ausencia; el test-writer lo deja escrito.

**Confirmación en vivo de la decisión (solo lectura, 2026-10-08):** misma pasada del paso 0 (3
muestras y la instancia con red, `now-24h`, 142 peticiones GET, token fuera del log), con
`entitySelector=entityId("<id>")`:

- `network.bytesRx` y `bytesTx`: BytePerSecond, agregación por defecto `avg`, admiten Inf, una
  dimensión (`dt.entity.process_group_instance`). `network.packets.retransmission`: Percent,
  `avg`, admite Inf y da una serie por proceso (también con Inf): **salud de red =
  `packets.retransmission`** (no hace falta `roundTrip`).
- Series, sin `resolution` (`10m` con `now-24h`):
  `cpu.usage,mem.workingSetSize,network.bytesRx,network.bytesTx,network.packets.retransmission,pgi.availability,handles.fileDescriptorsPercentUsed`
  (con su prefijo `builtin:tech.generic.` o `builtin:`).
- Marcadores, con `resolution=Inf`:
  `cpu.usage:avg,cpu.usage:max,mem.workingSetSize:avg,mem.workingSetSize:max,network.bytesRx:avg,network.bytesTx:avg,pgi.availability:avg,handles.fileDescriptorsPercentUsed:max`.
  Salud de red no lleva marcador (la especificación no lo pide).
- Las dos, 200 en los 4 procesos, `metricId` igual a la expresión y ratios < 0,01. En la instancia
  con red, una serie en cada expresión (también las de red). En las 3 muestras, las de red llegan
  **sin series** (`data` vacío), igual que `handles.*` en el proceso que no los trae.
- Cómo lo fijan los tests: los seis papeles tienen métrica, así que en `series` ninguno es `null`;
  un papel sin datos llega con series vacías (`network: { in, out }` vacías y `networkHealth`
  vacía). El `null` de CA4 es el de los marcadores sin dato: `totals.network` es
  `{ in, out }` con `null` en cada uno, y `availability`, `resources` y `cpu.max` a `null`
  cuando su marcador no trae valor. CA4 tiene un caso propio, "un proceso sin datos de red".

### Verifier, 2026-10-08, commit `d69ab36`, rango `main..feat/0027-proceso-exploracion-datos`: VERDE

- check: 2457 tests en 134 ficheros, cobertura ok.
- e2e completo (toca `src/shared/ipc.ts`): 261/261.

## Resultado

Commits: `859ea92` y `bb10baf` (tests), `aeb63fc` (canal). Rondas de revisión: 1 (aprobada). ADR nuevo: ninguno. Sin migraciones.

Ficheros principales: `src/main/modules/process-metrics.ts`, `src/main/ipc/handlers/modules.ts`, `src/shared/modules.ts`, `src/shared/ipc.ts` y `src/shared/error-reasons.ts` (reason `processMetricsRejected`, es y en).

Decisión del Orquestador (delegada por Dani, refinable): red y salud de red entran en el canal aunque las 3 muestras no tuvieran datos de red, porque existen en otras instancias y la especificación pide el marcador de red; un proceso sin datos llega con series vacías.

Tabla final de métricas por papel (prefijo `builtin:tech.generic.` salvo `pgi`; series sin `resolution`, marcadores con `resolution=Inf`):

| Papel          | Métrica                              | Unidad        | Marcador       |
| -------------- | ------------------------------------ | ------------- | -------------- |
| CPU            | `cpu.usage`                          | Percent       | `:avg`, `:max` |
| Memoria        | `mem.workingSetSize`                 | Byte          | `:avg`, `:max` |
| Red (entrada)  | `network.bytesRx`                    | BytePerSecond | `:avg`         |
| Red (salida)   | `network.bytesTx`                    | BytePerSecond | `:avg`         |
| Salud de red   | `network.packets.retransmission`     | Percent       | sin marcador   |
| Disponibilidad | `builtin:pgi.availability`           | Percent       | `:avg`         |
| Recursos       | `handles.fileDescriptorsPercentUsed` | Percent       | `:max`         |

Lecciones (también en `docs/notas-api-v2.md` y `src/main/CLAUDE.md`): `retransmissionIn/Out` y `sessions.connectivity` no admiten `resolution=Inf`; las métricas sin dimensión de proceso traen series de otros procesos; `COMMAND_LINE_ARGS` y `EXE_PATH` van en `metadata` y no se enseñan (0029). Para la 0028: `fileDescriptorsPercentUsed` dice Percent pero va en [0, 1].
