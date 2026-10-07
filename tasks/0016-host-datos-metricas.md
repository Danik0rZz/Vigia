---
id: '0016'
titulo: 'HOST: exploración en vivo de las métricas y canal de series y marcadores (CPU, memoria, red y disco)'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0016-host-datos-metricas
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/{metricId}` (descriptor), `GET /metrics` (`text`, para buscar una alternativa si una candidata no existe) y `GET /metrics/query` (`metricSelector`, `entitySelector`, `resolution`, `from`, `to`); `..\API\Dynatrace Environment APIv2\APIv2.json`. Transformaciones en "Metrics selector transformations" (documentación oficial). Scope `metrics.read` (ya en uso).
migracion: no
rondas_revision: 1
---

## Petición original

Lote «host» (0016 a 0020). Dani:

"Ahora que tenemos montada parcialmente la página de SERVICE, vamos a ir a por la de HOST. Ten en
cuenta que HOST es un elemento de infraestructura con muchos elementos: disco, red, memoria, CPU,
procesos… Ve planteando la vista y a ver si eres capaz de localizar por ti mismo las métricas
necesarias para poder graficarlo y poner las cajitas igual que tenemos en la vista de SERVICE.
También sería interesante hacer lo mismo que con services: consultar la entidad y sacar la
información relevante."

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

**Vista del lote** (cada parte en su ficha): marcadores arriba y cuatro gráficos (0018), discos y
procesos en tablas (0017 los datos, 0019 la vista) y tarjeta «Información» del host (0020). Todo
ligado al rango global, sin refresco solo (ADR-0004), como el servicio.

**Métricas candidatas** (métricas integradas que documenta Dynatrace; el Planificador no ha podido
comprobarlas en vivo: **el paso 0 las confirma una a una**, y ninguna se usa sin confirmar):

| Para            | Candidata                                                                           | Unidad esperada |
| --------------- | ----------------------------------------------------------------------------------- | --------------- |
| CPU total       | `builtin:host.cpu.usage`                                                            | %               |
| Desglose de CPU | `builtin:host.cpu.user`, `builtin:host.cpu.system`, `builtin:host.cpu.iowait`       | %               |
| Carga           | `builtin:host.cpu.load`                                                             | sin unidad      |
| Memoria         | `builtin:host.mem.usage` (%) y `builtin:host.mem.used`, `builtin:host.mem.total`    | %, bytes        |
| Red             | `builtin:host.net.nic.trafficIn` y `builtin:host.net.nic.trafficOut` (por interfaz) | bits/s          |
| Disco (uso)     | `builtin:host.disk.usedPct` (por disco)                                             | %               |

**Paso 0, exploración en vivo (solo lectura),** con el patrón de
`service-metrics-explore.live.test.ts`: 3 hosts sacados de los problemas de los últimos 7 días
(nunca se guarda un id ni un nombre), con `now-2h` y `now-7d`:

- el descriptor de cada candidata: si existe, `unit`, `defaultAggregation`, `aggregationTypes`,
  `resolutionInfSupported`, dimensiones y si admite `fold`;
- si una candidata no existe (404), se busca con `GET /metrics?text=` la integrada equivalente y se
  anota; si no hay, se quita de la vista y se dice en "Resultado";
- que una consulta con todas las series (≤ 10 expresiones) con `entitySelector=entityId("<id>")`
  da 200, en qué orden vuelven y si red y disco llegan con una serie por interfaz o disco;
- para los marcadores, `resolution=Inf` frente a `:fold(avg)` y `:fold(max)`;
- nulos, `resolution` devuelta y ratios recortados.

El informe guarda solo comportamientos. Lo que salga va a "Resultado" y a
`docs/notas-api-v2.md` (doc-writer).

**Canal `entities:hostMetrics`** (Zod en `src/shared/ipc.ts`), como `entities:serviceMetrics`:

- Entrada: `environmentId`, `entityId` (`^HOST-[0-9A-F]{16}$`) y `timeRange`. Main construye los
  selectores; la interfaz no manda ninguno.
- Dos consultas: **series** (una para todo, con la resolución de la API) y **marcadores** (rango
  completo).
- Series: `cpu` (total) y `cpuBreakdown` (`user`, `system`, `iowait`), `memory` (%), `network`
  (`in` y `out`, sumadas todas las interfaces con `splitBy()`/`fold` según el paso 0) y `disk`
  (el % del disco más lleno en cada punto, `:splitBy():max` o equivalente).
- Marcadores (`totals`): CPU media y máxima del rango; memoria media en % y usada/total en bytes
  (del último punto con dato); red media de entrada y de salida; disco más lleno (máximo del rango,
  en %); carga media si existe.
- Unidades: % en 0–100, bytes y bits/s tal cual (la interfaz los formatea). Fijadas en código y con
  test.
- Errores con `reason` (ADR-0005). Un host sin datos: series vacías y `null`, no error.
- El simulador de los e2e responde con datos inventados.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe del paso 0 sale con los descriptores y comportamientos y sin
  ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta `HOST-` + 16 hexadecimales en mayúsculas y rechaza
  otros tipos, minúsculas y caracteres como `"`, `)` o `,`.
- CA3 (unitario, main): con `fetch` simulado, dos peticiones a `/metrics/query` con las
  expresiones confirmadas, el id del host y el `from`/`to` del rango (relativo y absoluto).
- CA4 (unitario, main): la respuesta simulada se transforma en `series` y `totals` (red sumada,
  disco más lleno, `null` conservados, unidades).
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin resultados → series vacías y `null`.
- CA6 (unitario, main): `warnings` y resultados recortados llegan en `warnings` y `partial`.
- CA7 (e2e): el simulador responde y un test por IPC recibe lo esperado de un id inventado.

## Pruebas a mano para Dani

(en la 0018)

## Fuera de alcance

- Discos y procesos uno a uno (0017 y 0019), la vista (0018) y la información (0020).
- Métricas de tecnologías concretas (JVM, contenedores, Kubernetes) y logs del host.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- CA1-CA7 con su test; tras `d35e1f7` solo cambian los tests de inventario de canales.
- Expresiones idénticas a las confirmadas en vivo; red `:splitBy():sum`, disco `:splitBy():max`; marcadores
  con `Inf` y sin `fold`; id validado antes del selector (CA2 cubre inyección); `truncatedResults`
  compartido; `hostMetricsRejected` (ADR-0005). Parámetros contrastados con `APIv2.json`. Sin datos del
  tenant.
- Opcionales: `:avg` explícito en los marcadores (equivalente al `defaultAggregation`); citar la 0006 en el
  comentario de `fold` + `Inf`; CA5 podría comprobar la clave `hostMetricsRejected`.

## Verificación

Tests escritos en `d35e1f7` (`test(host): criterios de la ficha 0016`). Los unitarios y el e2e
fallan porque el canal no existe (`canal entities:hostMetrics: expected undefined`, `implementación
de entities:hostMetrics: expected undefined`, `UNKNOWN_CHANNEL` en el e2e), no por el test.

| Criterio | Test                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/host-metrics-explore.live.test.ts` › `CA1 (0016): el informe no contiene ningún id ni nombre observado` (ya pasa: el paso 0 está hecho)           |
| CA2      | `src/shared/ipc.test.ts` › `CA2 (0016): entrada de entities:hostMetrics`                                                                                            |
| CA3      | `src/main/ipc/handlers/host-metrics.test.ts` › `CA3 (0016): dos consultas a /metrics/query con las expresiones confirmadas, el id y el rango` (relativo y absoluto) |
| CA4      | `src/main/ipc/handlers/host-metrics.test.ts` › `CA4 (0016): la respuesta se transforma en series y totales`                                                         |
| CA5      | `src/main/ipc/handlers/host-metrics.test.ts` › `CA5 (0016): errores de Dynatrace y host sin datos`                                                                  |
| CA6      | `src/main/ipc/handlers/host-metrics.test.ts` › `CA6 (0016): warnings y resultados recortados`                                                                       |
| CA7      | `e2e/views.spec.ts` › `CA7 (0016): entities:hostMetrics por IPC con un id inventado: dos consultas, series y totales`                                               |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-08:** 3 hosts (1 de los problemas de los
últimos 7 días; los otros 2, los primeros de `type("HOST")`, porque los problemas no daban más),
`now-2h` y `now-7d`, 37 peticiones GET. Informe en `live-reports/host-metrics-explore.json`
(ignorado), sin ids ni nombres. Las 11 candidatas existen; no hizo falta buscar alternativas.

| Métrica                           | Existe | Unidad       | Agregación por defecto | Agregaciones        | Dimensiones                                     | `Inf` | `fold` |
| --------------------------------- | ------ | ------------ | ---------------------- | ------------------- | ----------------------------------------------- | ----- | ------ |
| `builtin:host.cpu.usage`          | sí     | Percent      | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.cpu.user`           | sí     | Percent      | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.cpu.system`         | sí     | Percent      | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.cpu.iowait`         | sí     | Percent      | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.cpu.load`           | sí     | Ratio        | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.mem.usage`          | sí     | Percent      | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.mem.used`           | sí     | Byte         | avg                    | auto, avg, max, min | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.mem.total`          | sí     | Byte         | **value**              | auto, value         | `dt.entity.host`                                | sí    | sí     |
| `builtin:host.net.nic.trafficIn`  | sí     | BitPerSecond | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.network_interface` | sí    | sí     |
| `builtin:host.net.nic.trafficOut` | sí     | BitPerSecond | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.network_interface` | sí    | sí     |
| `builtin:host.disk.usedPct`       | sí     | Percent      | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.disk`              | sí    | sí     |

Comportamientos observados (todo con `entitySelector=entityId("<id>")`, sin filtro en la
expresión):

- Las 10 expresiones de series en una consulta dan 200, vuelven en el orden pedido y su `metricId`
  es la expresión enviada tal cual. Resolución devuelta: `1m` con `now-2h`, `1h` con `now-7d`.
  Todas las series con los mismos timestamps.
- Red y disco sin juntar llegan con una serie por interfaz o por disco (1 o de 2 a 9 según el host).
  `:splitBy():sum` en la red da una sola serie igual, punto a punto, a la suma de las interfaces; y
  `:splitBy():max` en el disco, al máximo de los discos (igual, o < 1 % en un host).
- Marcadores: `resolution=Inf` y `:fold(...)` sin Inf dan 200 los dos. Con `now-2h` coinciden; con
  `now-7d` las medias difieren < 1 % (fold promedia los puntos de 1 h; Inf, el rango real). Los
  máximos coinciden. Con Inf, `:splitBy():sum` de la red es igual a la suma de las medias por
  interfaz y `:splitBy():max` del disco, al máximo por disco. `cpu.load` con Inf tiene dato en los
  3 hosts.
- `cpu.usage:max` con Inf difiere (≥ 1 %) del máximo de la serie de medias: el máximo real del
  rango sale de la consulta con Inf, no de la serie.
- Nulos: 0 % casi siempre; un host con 60 % de nulos en `now-7d` (sin datos en parte del rango).
  Con `now-2h`, el último punto llega a `null` en 2 de los 3 hosts: usada y total salen del último
  punto con dato.
- `mem.used / mem.total × 100` coincide con `mem.usage` en el último punto. `user + system +
iowait` no suma el total en 2 de los 3 hosts (hay más componentes de CPU): el desglose no es un
  reparto del total.
- Ratios siempre entre 0 y 0,01 (nada recortado). Ninguna respuesta trae `warnings`.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- Consulta de series (sin `resolution`), 10 expresiones acotadas al host con
  `entitySelector=entityId("<id>")` o con un filtro por `dt.entity.host` en la expresión (los
  tests aceptan las dos): `builtin:host.cpu.usage`, `.cpu.user`, `.cpu.system`, `.cpu.iowait`,
  `.mem.usage`, `.mem.used` y `.mem.total` (sin agregación o con `:avg`; `mem.total` solo admite
  `value`, así que sin agregación), `builtin:host.net.nic.trafficIn:splitBy():sum`,
  `builtin:host.net.nic.trafficOut:splitBy():sum` y `builtin:host.disk.usedPct:splitBy():max`.
  Usada y total van en esta consulta porque salen del último punto con dato (Inf solo da la media).
- Consulta de marcadores con `resolution=Inf` y sin `fold`, 7 expresiones: `cpu.usage` (media),
  `cpu.usage:max`, `mem.usage` (media), las dos de red con `:splitBy():sum`, el disco con
  `:splitBy():max` y `cpu.load` (media). Inf mejor que fold: da la media del rango real y el máximo
  real.
- Salida de `entities:hostMetrics`, como la de `entities:serviceMetrics`:
  `{ resolution, series, totals, warnings, partial }`, con
  `series: { cpu, cpuBreakdown: { user, system, iowait }, memory, network: { in, out }, disk }`
  (cada una `{ timestamps, values }`, con los `null` conservados) y
  `totals: { cpu: { avg, max }, memory: { avg, used, total }, network: { in, out }, disk: { max }, load: { avg } }`
  (todo `number | null`). `resolution` es la de la consulta de series.
- Unidades sin convertir: % en 0–100, bytes y bits/s tal cual.
- Host sin datos (`result` o `data` vacíos): series `{ timestamps: [], values: [] }` y todos los
  totales a `null`.
- La implementación va en `createModuleHandlers` (`src/main/ipc/handlers/modules.ts`), como la de
  `entities:serviceMetrics`. Un `metricSelector` en la entrada nunca llega a Dynatrace.
- e2e: el simulador de `views.spec.ts` atiende las consultas con `builtin:host.` y el id inventado
  `HOST-00000000000E2E30` (en `entitySelector` o en la expresión) antes que las de la vista
  Métricas, y las guarda en `sim.hostMetricQueries`.

**Decisiones del developer (delegadas por Dani, refinables):**

- Las dos consultas van acotadas con `entitySelector=entityId("<id>")` (como el paso 0), no con un
  filtro en la expresión; las expresiones son la clave sin agregación (avg por defecto) salvo
  `cpu.usage:max` y los `:splitBy():sum` y `:splitBy():max` de red y disco. Fijadas en
  `src/main/modules/host-metrics.ts` y casadas por posición, como en el servicio.
- Motivo de error nuevo `hostMetricsRejected` (400 y 404), con texto en es y en, al estilo de
  `serviceMetricsRejected`.
- `hostEntityIdSchema` y `hostMetricsResultSchema` en `src/shared/modules.ts`; las series reutilizan
  el esquema de serie del servicio (tipo `HostSeries`).
- El canal se añade a los registros de cobertura `channel-coverage.test.ts` y `modules.test.ts`
  («todos los canales»), como se hizo con `entities:serviceMetrics` en la 0006.

### Verifier, 2026-10-08, commit `168b429`, rango `main..168b429`: VERDE

- check: 2244 tests en 116 ficheros, cobertura ok.
- e2e completo (ventana del CI): 224/224.

## Resultado

(pendiente)
