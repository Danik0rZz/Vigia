---
id: '0017'
titulo: 'HOST: canal con el detalle por disco y los procesos que más consumen'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0016']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0017-host-discos-procesos-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/{metricId}`, `GET /metrics` (`text`) y `GET /metrics/query` (`metricSelector`, `entitySelector` con criterios de relación, `resolution`, `from`, `to`); `..\API\Dynatrace Environment APIv2\APIv2.json` y "Entity selector" / "Metrics selector transformations" de la documentación oficial. Scope `metrics.read` (ya en uso).
migracion: no
rondas_revision: 1
---

## Petición original

Lote «host» (0016 a 0020). La petición completa está en la ficha 0016: el host tiene "disco, red,
memoria, CPU, procesos…".

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

**Métricas candidatas** (a confirmar en el paso 0, con la misma regla que la 0016: ninguna sin
confirmar; si no existe, la integrada equivalente con `GET /metrics?text=` o se quita y se anota):

| Para                          | Candidata                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Uso de cada disco             | `builtin:host.disk.usedPct`, `builtin:host.disk.avail`, `builtin:host.disk.used` (dimensión `dt.entity.disk`) |
| Lectura y escritura por disco | `builtin:host.disk.bytesRead` y `builtin:host.disk.bytesWritten`                                              |
| CPU por proceso               | `builtin:tech.generic.cpu.usage` (dimensión `dt.entity.process_group_instance`)                               |
| Memoria por proceso           | `builtin:tech.generic.mem.workingSetSize`                                                                     |

**Paso 0 (solo lectura),** en la prueba en vivo de la 0016 o en una propia, con los mismos 3 hosts:
descriptores de las candidatas; cómo limitar los procesos a los del host (con `entitySelector` por
relación, por ejemplo `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<id>"))`,
o con un filtro por la dimensión del host si la métrica la trae: se prueban las dos y se elige la
que funcione); si la respuesta trae el nombre de cada disco y proceso (`dimensionMap` con
`dt.entity.disk.name` o equivalente) o hace falta resolverlo; y tramos de número de discos y
procesos por host. Solo comportamientos en el informe.

**Canal `entities:hostBreakdown`** (Zod):

- Entrada: `environmentId`, `entityId` (`^HOST-…`, como la 0016) y `timeRange`.
- Salida:
  - `disks`: por disco, `id`, `name`, `usedPct` (último dato y máximo del rango), `used` y `avail`
    (bytes, último dato), `read` y `write` (bytes/s medios del rango). Ordenados del más lleno al
    menos; todos (se espera pocos por host).
  - `processes`: los **10** procesos del host con más CPU media del rango: `id`, `name`, `cpu`
    (media y máxima, %) y `memory` (media, bytes). `total` con cuántos procesos había.
- Main construye los selectores con el id validado. Errores con `reason`. Sin datos: listas vacías.
- El simulador de los e2e responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe sale sin ids ni nombres y dice qué forma de limitar los
  procesos al host funciona. Se salta sin `.env.live.local`.
- CA2 (unitario, main): con `fetch` simulado, las consultas llevan las métricas confirmadas, el id
  del host (en el selector elegido) y el rango.
- CA3 (unitario, main): de una respuesta simulada con 3 discos y 15 procesos salen los discos
  ordenados por uso y los 10 procesos con más CPU, con `total` 15.
- CA4 (unitario, main): nombres sacados de `dimensionMap`; si falta, el id.
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin datos → listas vacías.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0019)

## Fuera de alcance

- Interfaces de red una a una (la red va sumada en la 0016).
- Procesos más allá de los 10 primeros o su detalle (su página de entidad, de momento en
  construcción).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- CA1-CA6 con su test; prueban de verdad (400 con `:last`/`fold`+`Inf`; órdenes distintos según el criterio).
  Tests sin tocar tras `da5b49d`.
- Métricas exactamente las confirmadas; `isProcessOf` confirmado en vivo; ninguna consulta mezcla `:last` ni
  `fold` con `Inf`; todas con `:names`. Id validado antes de los selectores (sin inyección).
  `hostBreakdownRejected` (ADR-0005).
- Opcional 1: la API limita a 1.000 series por respuesta; con 3 expresiones por proceso la cuenta es exacta
  hasta unos 333 procesos por host (en vivo, 51-150). Por encima, top 10 y `total` saldrían incompletos, pero
  `partial` lo diría.
- Opcional 2: el `detail` de `hostBreakdownRejected` puede llevar el selector con el id del host.

**Decisión del Orquestador (2026-10-08, delegada por Dani):** se queda pidiendo todos los procesos. La
0019 avisa de que la lista y el total pueden estar incompletos cuando `partial` traiga la métrica de
procesos. Si aparecen hosts más grandes, `:sort(value(avg,descending)):limit(10)` y un recuento aparte
(cambio de ficha, para Dani). Pendiente: anotar el límite en el comentario de `host-breakdown.ts`
(BACKLOG).

## Verificación

Tests escritos en `da5b49d` (`test(host): criterios de la ficha 0017`). Los unitarios y el e2e
fallan porque el canal no existe (`implementación de entities:hostBreakdown: expected undefined`,
`UNKNOWN_CHANNEL` en el e2e), no por el test. También se añadió el canal a la lista de
`createModuleHandlers` en `src/main/ipc/channel-coverage.test.ts` y a "todos los canales de
módulos" en `src/main/ipc/handlers/modules.test.ts` (fallan hasta que exista).

| Criterio | Test                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/host-breakdown-explore.live.test.ts` › `CA1 (0017): el informe no contiene ningún id ni nombre observado y dice qué forma limita los procesos al host` (ya pasa: el paso 0 está hecho)                               |
| CA2      | `src/main/ipc/handlers/host-breakdown.test.ts` › `CA2 (0017): las consultas llevan las métricas confirmadas, el id del host en su selector y el rango` (relativo y absoluto, otro host, ids rechazados, sin selectores de la interfaz) |
| CA3      | `src/main/ipc/handlers/host-breakdown.test.ts` › `CA3 (0017): 3 discos ordenados por uso y los 10 procesos con más CPU de 15`                                                                                                          |
| CA4      | `src/main/ipc/handlers/host-breakdown.test.ts` › `CA4 (0017): nombres de dimensionMap y, si falta, el id`                                                                                                                              |
| CA5      | `src/main/ipc/handlers/host-breakdown.test.ts` › `CA5 (0017): errores de Dynatrace y host sin datos`                                                                                                                                   |
| CA6      | `e2e/views.spec.ts` › `CA6 (0017): entities:hostBreakdown por IPC con un id inventado: discos por uso y los 10 procesos con más CPU`                                                                                                   |

**Paso 0 (CA1), en vivo y de solo lectura, el 2026-10-08:** prueba propia
(`host-breakdown-explore.live.test.ts`), los mismos 3 hosts que la 0016 (1 de los problemas de 7
días y 2 de `type("HOST")`), `now-2h` (y `now-7d` para ver que caben), 51 peticiones GET, token
fuera del log. Informe en `live-reports/host-breakdown-explore.json` (ignorado), sin ids ni
nombres. Las 7 candidatas existen; no hizo falta buscar alternativas.

| Métrica                                   | Existe | Unidad        | Agregación por defecto | Agregaciones        | Dimensiones                        | `Inf` |
| ----------------------------------------- | ------ | ------------- | ---------------------- | ------------------- | ---------------------------------- | ----- |
| `builtin:host.disk.usedPct`               | sí     | Percent       | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.disk` | sí    |
| `builtin:host.disk.used`                  | sí     | Byte          | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.disk` | sí    |
| `builtin:host.disk.avail`                 | sí     | Byte          | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.disk` | sí    |
| `builtin:host.disk.bytesRead`             | sí     | BytePerSecond | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.disk` | sí    |
| `builtin:host.disk.bytesWritten`          | sí     | BytePerSecond | avg                    | auto, avg, max, min | `dt.entity.host`, `dt.entity.disk` | sí    |
| `builtin:tech.generic.cpu.usage`          | sí     | Percent       | avg                    | auto, avg, max, min | `dt.entity.process_group_instance` | sí    |
| `builtin:tech.generic.mem.workingSetSize` | sí     | Byte          | avg                    | auto, avg, max, min | `dt.entity.process_group_instance` | sí    |

Todas admiten las transformaciones `fold`, `last`, `limit`, `sort`, `filter` y `splitBy`.

Comportamientos observados:

- **Limitar los procesos al host:** funciona el `entitySelector` por relación
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<id>"))`: da los mismos
  procesos que `/entities` con ese selector, y los mismos en CPU y en memoria. El filtro por la
  dimensión del host (`:filter(eq("dt.entity.host","<id>"))`) da 200 **sin series**: las métricas
  de proceso no tienen esa dimensión. `entitySelector=entityId("<host>")` a secas, también 200 sin
  series. `:filter(in("dt.entity.process_group_instance",entitySelector("…isProcessOf…")))` en la
  expresión da lo mismo que la relación. **Se elige la relación en `entitySelector`**: es la que
  propone la ficha, coincide con `/entities` y deja las expresiones sin filtros.
- **Nombres:** sin más, `dimensionMap` solo trae ids (`dt.entity.disk` y `dt.entity.host`;
  `dt.entity.process_group_instance`). **Con la transformación `:names`** llegan
  `dt.entity.disk.name` (y `dt.entity.host.name`) y `dt.entity.process_group_instance.name` en el
  100 % de las series, con `resolution=Inf` y sin ella, con los mismos discos, procesos y valores
  que sin `:names`. No hace falta resolverlos aparte.
- Discos: de 2 a 9 por host; una serie por disco y métrica, en el orden pedido. En 2 de los 3 hosts
  `bytesRead` y `bytesWritten` traen más discos que `usedPct`, `used` y `avail` (los contienen).
  `used / (used + avail) × 100` coincide con `usedPct` (o < 1 %). Con `now-2h`, el último punto de
  todas las series de disco llega a `null`.
- `:last` con `resolution=Inf` da **400**: el último dato sale del último punto con dato de la
  serie. `usedPct:max` con Inf coincide (o < 1 %) con el máximo de la serie.
- Procesos por host: 10–15, 16–50 y 51–150 con `now-2h`; con `now-7d`, hasta 51–150. Todos con CPU
  media con Inf. `:sort(value(avg,descending)):limit(10)` da el mismo top 10 que ordenarlos todos.
- Ratios siempre entre 0 y 0,01 (nada recortado), también con `now-7d`.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- Todas las consultas a `/metrics/query`, con el rango global (`from` y `to`) y como mucho 10
  expresiones. Discos con `entitySelector=entityId("<id>")` (o el id en la expresión); procesos con
  el `entitySelector` por relación (o el mismo selector en un `filter(in(...))`). Las 7 métricas
  confirmadas, y solo ellas, entre todas las consultas. Los nombres, de `dimensionMap` con `:names`
  (el simulador solo los da con `:names`, como en vivo); cualquier otra ruta da 404, así que no se
  piden a `/entities`.
- Valores coherentes en los simuladores (la media de la serie es la de Inf y su máximo, el de
  Inf): el test no obliga a elegir entre Inf y la serie salvo donde Inf no sirve (`:last` + Inf =
  400). Lo esperable: serie para `usedPct`, `used` y `avail` (último punto con dato) y Inf para
  `usedPct:max`, `bytesRead`, `bytesWritten` y los procesos.
- Salida: `{ disks, processes: { items, total } }` (más lo que añada el developer, como `warnings`
  o `partial`: los tests usan `toMatchObject`). Cada disco
  `{ id, name, usedPct: { last, max }, used, avail, read, write }`; cada proceso
  `{ id, name, cpu: { avg, max }, memory }`, con `memory` la media en bytes (número, no objeto).
  Todo `number | null`, sin convertir unidades (% en 0–100, bytes y bytes/s).
- Orden de los discos: por el **último dato** de `usedPct` (lo lleno que está ahora), de más a
  menos; el test lo distingue del orden por máximo. "Todos" los discos: uno que solo trae lectura y
  escritura (lo visto en vivo) va al final, con `usedPct`, `used` y `avail` a `null`.
- Procesos: los 10 con más CPU media, de más a menos (el test lo distingue del orden por la
  máxima); `total` es cuántos procesos trajo la consulta (15 en CA3, 12 en el e2e).
- Sin nombre en `dimensionMap`, el nombre es el id (disco y proceso).
- Errores 400 y 404 con `reason` (cualquier clave). Sin datos (`result` o `data` vacíos):
  `disks: []` y `processes: { items: [], total: 0 }`. Otro host (sin series) también da listas
  vacías.
- Un id que no casa con `^HOST-[0-9A-F]{16}$` se rechaza sin llamar a Dynatrace (como en la 0016).
- La implementación va en `createModuleHandlers`, como `entities:hostMetrics`.
- e2e: el simulador de `views.spec.ts` atiende las consultas de `builtin:host.disk.` con
  `entityId("HOST-00000000000E2E31")` y las de `builtin:tech.generic.` con la relación a ese id
  (antes que las de la 0016 y la vista Métricas) y las guarda en `sim.hostBreakdownQueries`. El
  módulo de producción nuevo necesitará su área en `e2e/areas.json`.

**Decisiones del developer (delegadas por Dani, refinables):**

- Tres consultas a `/metrics/query` en paralelo, todas con `:names` en cada expresión
  (`src/main/modules/host-breakdown.ts`): series de disco sin Inf (`usedPct`, `used` y `avail`:
  último punto con dato), disco con Inf (`usedPct:max`, `bytesRead:avg` y `bytesWritten:avg`) y
  procesos con Inf (`cpu.usage:avg`, `cpu.usage:max` y `workingSetSize:avg`). Discos con
  `entitySelector=entityId("<id>")`; procesos con la relación `isProcessOf` en `entitySelector`.
  Resultados casados por posición y series por el id de la dimensión (una serie sin id se
  descarta).
- Los procesos se piden todos (sin `:sort` ni `:limit`): así sale `total` sin otra consulta (en
  vivo, como mucho 51–150 por host) y el top 10 se ordena en main por CPU media, con los null al
  final. Los discos son la unión de las 6 series (el que solo trae lectura y escritura, al final).
- Salida con `warnings` y `partial` (`truncatedResults`), como la 0016. Motivo nuevo
  `hostBreakdownRejected` (400 y 404), con texto en es y en.

### Verifier, 2026-10-08, commit `0308316`, rango `main..0308316`: VERDE

- check: 2261 tests en 117 ficheros, cobertura ok.
- e2e completo (ventana del CI): 225/225.

## Resultado

- Commits: `da5b49d` (tests), `921cab3` (canal), más los de ficha. Una ronda de revisión: APROBADO. Verifier en verde (2261 unitarios, e2e 225/225).
- Ficheros principales: `src/main/modules/host-breakdown.ts`, `src/main/ipc/handlers/modules.ts`, `src/shared/modules.ts`, `src/shared/ipc.ts`, `e2e/views.spec.ts`.
- ADR nuevo: ninguno. Migración: no. CHANGELOG: sin entrada (nada visible hasta la 0019).
- Documentado en `docs/notas-api-v2.md` y `src/main/CLAUDE.md`; ideas al BACKLOG.
