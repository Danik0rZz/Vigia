---
id: '0040'
titulo: 'DISK: página del disco, a la que se llega pulsando un disco del host'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host-2
depende_de: ['0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0040-pagina-disco
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:host.disk.*`), `GET /metrics/{metricId}`, `GET /metrics/query` y `GET /entities/{entityId}` (0014); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read`.
migracion: no
rondas_revision: 1
---

## Petición original

Lote «host-2» (0039 a 0042). Dani (2026-10-09): "Cuando se haga clic sobre un disco, nos debería
llevar a una página como la de HOST. Las métricas son las de `builtin:host.disk.*`."

## Especificación

**Tipo nuevo.** `DISK` entra en el registro de páginas de entidad (`registry.ts`), con su nombre
(«Disco» / «Disk») y su página. En la tabla de discos del host (0019), cada fila enlaza a
`#/entities/DISK/<id>` con el nombre; «Volver» regresa al host.

**Análisis de métricas (paso 0, en vivo y solo lectura),** con la regla de la 0022: catálogo de
`builtin:host.disk.*`, cuáles tienen datos para 3 discos de los hosts de muestra
(`entitySelector=entityId("<disco>")` o filtro por `dt.entity.disk`), y elección por papel:

| Papel       | Qué se busca                                              |
| ----------- | --------------------------------------------------------- |
| Uso         | % usado (`usedPct`, ya confirmada)                        |
| Espacio     | usado y libre en bytes (`used` y `avail`, ya confirmadas) |
| Rendimiento | bytes leídos y escritos por segundo (ya confirmadas)      |
| Latencia    | tiempo de lectura y escritura, si existen                 |
| Cola        | longitud de la cola, si existe                            |
| Inodos      | inodos libres, si existen                                 |

**Canal `entities:diskMetrics`** (Zod): entrada `environmentId`, `entityId`
(`^DISK-[0-9A-F]{16}$`) y `timeRange`; series y totales por papel (`null` si no hay métrica);
errores con `reason`; simulador.

**Página** (orden de las fichas 0036 y 0037):

- **Marcadores:** Uso (% máximo del rango; aviso 80 %, error 90 %, con texto), Libre (último dato),
  Lectura y Escritura (medias), Latencia o Cola (el que haya) y Problemas.
- **Gráficos** (2×2, sin rejilla): Uso % (con la franja de problemas), Espacio (usado y libre
  apilados), Lectura y escritura, y Latencia o Cola.
- **Tarjeta «Información»** al final: lo que traiga la entidad `DISK` (claves vistas en el paso 0),
  con su relación con el host («Disco de»).

## Criterios de aceptación

- CA1 (live, solo lectura): el informe trae el catálogo, qué métricas tienen datos y las claves de
  la entidad, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario): el registro tiene `DISK` con su página y su nombre en es y en.
- CA3 (unitario, main): consultas con las métricas elegidas, el id y el rango; transformación por
  papel con papeles `null`; 400/404 → error con `reason`.
- CA4 (e2e): pulsar un disco en la tabla del host abre su página con su nombre; «Volver» regresa
  al host sin volver a pedir sus datos.
- CA5 (e2e): la página del disco del simulador enseña marcadores, gráficos e información con sus
  valores.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un host real, pulsar un disco y comprobar que su página cuadra con Dynatrace.

## Fuera de alcance

- Interfaces de red como página propia.

## Ideas surgidas (fuera de alcance)

- (developer) En «Disco de», el nombre del host (hoy, tipo e id): con `entities:names` a demanda o
  pasándolo en el estado al llegar desde el host.
- (developer) Los inodos libres ya llegan en el canal (`series.inodes`) y la página no los pinta:
  podrían ir como serie o marcador si Dani lo quiere.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA6 con su test; tras `85d132f` solo se añaden `disk-charts.test.ts` y `disk-info.test.ts`.
CA3 fija el filtro en cada expresión, ≤ 10 por consulta (el simulador da 400 si se pasa), sin
`entitySelector`, el rango, los papeles `null` y el `reason`. Series (9, sin `resolution`) y
marcadores (6, `Inf`) son las del paso 0 en vivo con `:filter(eq("dt.entity.disk",…))`; «Abrir en
Métricas» usa el mismo filtro. Id validado con `^DISK-[0-9A-F]{16}$` en Zod y en el renderer: no se
puede cerrar la comilla ni el paréntesis. Navegación con `fromProblem` como la tabla de procesos;
«Volver» con `navigate(-1)` sin pedir nada; consulta `MANUAL` (ADR-0004). Sin dependencias, esquema
ni CSP; ids sintéticos.

Opcional: el casado por posición se desplazaría si Dynatrace devolviera menos `result` que
expresiones; un comentario o una comprobación de la longitud.

## Verificación

**Paso 0 (en vivo, solo lectura, 2026-10-09; `src/main/modules/disk-metrics-explore.live.test.ts`):**
3 discos (uno por host de `type("HOST")`, el que más papeles con datos tiene en su host),
`now-2h`, unas 25 peticiones GET, token fuera del log. Informe en
`live-reports/disk-metrics-explore.json` (ignorado), sin ids ni nombres.

- Catálogo: `builtin:host.disk.*` da 16 métricas en una página, todas con `entityType` HOST, las
  dimensiones `dt.entity.host` y `dt.entity.disk`, agregaciones auto, avg, max y min (los tiempos,
  también count y sum; por defecto avg) y `resolutionInfSupported`: `avail`, `used` (Byte),
  `usedPct`, `free`, `inodesAvail`, `utilTime` (Percent), `bytesRead`, `bytesWritten`
  (BytePerSecond), `throughput.read`/`.write` (BitPerSecond), `readOps`, `writeOps` (PerSecond),
  `readTime`, `writeTime` (MilliSecond), `queueLength` e `inodesTotal` (Count).
- **Con `entitySelector=entityId("<disco>")` no llega ninguna serie** (0 de 3 en las 16): la
  entidad de las métricas es el HOST. **Con `:filter(eq("dt.entity.disk","<disco>"))`, las 16
  tienen datos en los 3 discos**, una serie cada una y ninguna de otro disco. No todos los discos
  de un host traen las de E/S: en 4 de 5 hosts, `readTime`/`writeTime` solo los trae un disco.
- El `metricId` de la respuesta **no** es la expresión enviada: Dynatrace quita las comillas del
  valor (`…:filter(eq("dt.entity.disk",DISK-…))`). Los resultados se casan por posición.
- Elección por papel: Uso `usedPct`; Espacio `used` y `avail`; Rendimiento `bytesRead` y
  `bytesWritten`; Latencia `readTime` y `writeTime`; Cola `queueLength`; Inodos `inodesAvail`
  (% de inodos libres).
- Consultas exactas del canal, confirmadas en los 3 discos (200, una serie por expresión, ratios
  < 0,01, último punto de las series a null): series sin `resolution` (`1m` con `now-2h`) con las
  9 expresiones `builtin:host.disk.{usedPct,used,avail,bytesRead,bytesWritten,readTime,writeTime,queueLength,inodesAvail}:filter(eq("dt.entity.disk","<disco>"))`,
  y marcadores con `resolution=Inf`: `usedPct…:max`, `bytesRead…:avg`, `bytesWritten…:avg`,
  `readTime…:avg`, `writeTime…:avg` y `queueLength…:avg` (la agregación, detrás del filtro). Ninguna
  pasa de 10 expresiones (decisión de la 0039).
- Entidad (`GET /entities/{id}`): `type` DISK, `firstSeenTms` y `lastSeenTms` (números), `tags`
  vacías, `properties` con `detectedName` y `filesystemType`, y una relación,
  `fromRelationships.isDiskOf` (1 HOST). `type("DISK")` también se lista en `/entities`.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- Salida del canal (`entities:diskMetrics`): `resolution`; `series` con `usage` (%),
  `space: { used, free }` (bytes; `free` es `avail`), `throughput: { read, write }` (bytes/s),
  `latency: { read, write }` (ms), `queue` e `inodes` (% libre); `totals` con `usage` (% máximo,
  `usedPct:max`), `free` (último punto con dato de `avail`; `:last` con Inf da 400),
  `throughput: { read, write }` (medias), `latency: { read, write }` (medias) y `queue` (media);
  `warnings` y `partial`. Los inodos no tienen marcador (la página no los pinta).
- «Papeles `null`»: latencia, cola e inodos son `null` (en `series` y en `totals`) si Dynatrace no
  devuelve ninguna serie para sus métricas en ese disco (no todos los discos las traen). Uso,
  espacio y rendimiento nunca son `null`: sin series, llegan vacías y su marcador a null.
- Las consultas no llevan `entitySelector` con el id del disco (los simuladores, como en vivo, no
  devuelven nada con él); el número de consultas no se fija, solo que ninguna pasa de 10.
- Página: con latencia y cola, sale **Latencia** (marcador: media de lectura y, debajo, la de
  escritura; gráfico: lectura y escritura); sin latencia, Cola. Rendimiento en bytes por segundo
  (kB/s, MB/s), como la tabla de discos del host (0019); espacio en GB; latencia en ms. Umbrales de
  uso del 80 y el 90 % con el texto de nivel del host (`entities.host.markers.levels`).
- Testids (los del proceso con el prefijo `disk`): `entity-page-disk`, `disk-markers`,
  `disk-marker-{usage,free,read,write,latency|queue,problems}` con `disk-marker-value`
  (`data-level` en el uso), `disk-marker-secondary`, `disk-marker-level`, `disk-marker-open` y
  `disk-marker-closed`; `disk-charts`, `disk-chart-panel` con `data-kind`
  (`usage`, `space`, `throughput`, `latency` o `queue`) y `disk-chart-<kind>` con `data-series`;
  `disk-info`. Textos en `entities.disk.{markers,charts,info}`; el nombre del tipo, por
  `ENTITY_PAGES.DISK.labelKey`.
- La «Información» se comprueba con lo visto en vivo (sistema de ficheros y «Disco de» con enlace
  al host). La franja de problemas sobre el uso y la rejilla 2×2 no tienen criterio propio: no las
  cubre ningún test (el disco del simulador no tiene problemas).

**Tests (commit `85d132f`):**

| Criterio | Test                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/disk-metrics-explore.live.test.ts` › `CA1 (0040): el informe trae el catálogo, qué métricas tienen datos y las claves de la entidad, sin ids ni nombres` (pasa)                                    |
| CA2      | `src/renderer/src/pages/entities/registry.test.ts` › describe `CA2 (0040)` (2 tests)                                                                                                                                 |
| CA3      | `src/main/ipc/handlers/disk-metrics.test.ts` › tres describe `CA3 (0040)` (consultas, transformación con papeles null, errores; 12 tests) y `src/shared/ipc.test.ts` › `CA3 (0040): entrada de entities:diskMetrics` |
| CA4      | `e2e/views.spec.ts` › `CA4 (0040): pulsar un disco en la tabla del host abre su página con su nombre, y «Volver» regresa al host sin volver a pedir sus datos`                                                       |
| CA5      | `e2e/views.spec.ts` › `CA5 (0040): la página del disco enseña sus marcadores, sus cuatro gráficos y su «Información»…` y `CA5 (0040): sin latencia, el marcador y el gráfico de cola…`                               |
| CA6      | `src/renderer/src/locales/disk-page.test.ts` › describe `CA6 (0040)` (4 tests)                                                                                                                                       |

También: `entities:diskMetrics` en `channel-coverage.test.ts` y en «todos los canales de módulos»
(`modules.test.ts`). Simulador del e2e: `isDiskMetricsQuery`/`diskMetricResponse` (datos de
/datos, `DISK_PAGE_ID`), `sim.diskMetricQueries`, `sim.diskEmpty` y la entidad `diskInfoBody`.

Ejecución sin el código: 36 unitarios en rojo (`canal entities:diskMetrics: expected undefined`,
`implementación de entities:diskMetrics: expected undefined`, `DISK en ENTITY_PAGES: expected
undefined`, textos de `entities.disk` sin definir, y los dos registros de canales) y los 3 e2e de
la 0040 en rojo (no existe el enlace del disco en la tabla ni `entity-page-disk`). Los e2e vecinos
del host (0014 a 0019 y 0039) siguen en verde con el simulador ampliado.

**Decisiones del developer (delegadas por Dani, refinables):**

- Canal (`src/main/modules/disk-metrics.ts`): dos consultas en paralelo, series (9 expresiones,
  sin `resolution`) y marcadores (6, con `Inf`), sin `entitySelector`; el disco va en el filtro.
  Un papel opcional (latencia, cola, inodos) es `null` si no llega ninguna serie de sus métricas
  ni en series ni en marcadores. Error nuevo `diskMetricsRejected` (400/404), como el del proceso.
- Página (`DiskEntityPage.tsx`, `DiskMarkers.tsx`, `DiskCharts.tsx`, `disk-charts.ts`): sin
  latencia ni cola no sale el quinto marcador ni el cuarto gráfico. Libre en GB
  (`formatGigabytes`), latencia con `formatDurationMs` (de 1 s en adelante, en s), cola con dos
  decimales como mucho. La franja de problemas va sobre el gráfico de uso (`ProblemBand` con
  prefijo `disk`). «Abrir en Métricas» usa las mismas expresiones con el filtro del disco.
- «Información» (`disk-info.ts`, `DiskInfo.tsx`): filas Nombre detectado, Sistema de ficheros,
  «Disco de» (enlace directo al host con su tipo y su id, sin pedir el nombre: la ficha no lo pide
  y gastaría una petición), fechas y management zones; otras relaciones, si las hubiera, en «Otras
  relaciones». Sin otras, una sola columna.
- Tabla de discos del host: el nombre es un enlace y la fila también abre el disco, con
  `fromProblem` y el nombre en el estado (como los procesos): «Volver» hace `back()`. Un id que no
  sea de DISK se queda sin enlace (`diskLinkId`).
- Tests propios: `disk-charts.test.ts` y `disk-info.test.ts` (renderer).

### Verifier, 2026-10-09, commit `8946c79`, rango `main..feat/0040-pagina-disco`: VERDE

- check: 2974 tests en 162 ficheros, cobertura ok.
- e2e completo (toca `src/shared/ipc.ts`): 309/309, sin intermitentes.

## Resultado

(pendiente)
