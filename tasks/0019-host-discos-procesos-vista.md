---
id: '0019'
titulo: 'HOST: tablas de discos y de los procesos que más consumen'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0017', '0018']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0019-host-discos-procesos-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:hostBreakdown` de la 0017)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «host» (0016 a 0020). El host tiene "disco, red, memoria, CPU, procesos…". La petición
completa está en la ficha 0016.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

Debajo de los gráficos (0018), dos tarjetas lado a lado (una columna si es estrecha), con el grid
de tablas de la app (`DataGrid`):

- **Discos:** una fila por disco: nombre, barra de uso con su % (aviso > 80 %, error > 90 %, con
  texto), usado / total, libre, lectura y escritura (bytes/s adaptados). Ordenada del más lleno al
  menos; orden por columna.
- **Procesos (top 10 por CPU):** nombre, CPU media (con una barra pequeña) y máxima, memoria media.
  Ordenada por CPU; orden por columna. Debajo, «10 de N procesos». Cada proceso enlaza a su página
  de entidad (`#/entities/PROCESS_GROUP_INSTANCE/<id>`, con el nombre); «Volver» regresa al host.
- Estados de carga y error por tarjeta (aviso con Reintentar); sin datos, «Sin discos» o «Sin
  procesos». Mismo rango global y «Actualizar» que el resto. Textos en es y en.

**Nota del Orquestador (2026-10-08, desde la revisión de la 0017):** la consulta de procesos de
`entities:hostBreakdown` puede venir recortada en hosts de más de unos 333 procesos (tope de 1.000 series
de la API). Cuando `partial` traiga la métrica de procesos, la tabla dice que la lista y el total pueden
estar incompletos.

**Decisiones del developer (2026-10-08, delegadas por Dani; refinables):**

- **Piezas:** `HostTables.tsx` (las dos tarjetas sobre `DataGrid`, con `MarkerError` y
  `MarkerSkeleton` de `EntityMarkers.tsx`) y `host-tables.ts` (comparadores puros para `sortRows`,
  desempate por id, total del disco, recorte y id del enlace). `useHostBreakdown` en
  `data/modules.ts`, con la clave de `entities`: el «Actualizar» de la página y el rango global la
  recargan. Solo con acceso a Métricas, como los gráficos.
- **Lado a lado desde `xl` (1280 px)**, no desde `lg` como los gráficos: con seis columnas, la de
  discos no cabe en media página de 1024 px. Cada grid tiene ancho mínimo y scroll horizontal
  propio.
- **Formatos:** usado / total y libre con `formatBytes` (se adapta a TB en discos grandes); el % y
  el orden por defecto, del último dato (`usedPct.last`, como ordena main). Sin dato, «—»; al
  ordenar, sin dato va el último en descendente. Dirección con la que empieza cada columna: nombre
  y libre ascendente, el resto descendente.
- **Barra de CPU** del proceso en el color de acento y sin niveles (la ficha los pide en los
  discos).
- **Enlace al proceso:** solo si el id pasa `entityIdSchema` y empieza por
  `PROCESS_GROUP_INSTANCE-`; si no, el nombre sin enlace. Lleva `fromProblem` y el nombre en el
  estado (como `ServiceInfo`), así «Volver» hace `back()`. La fila entera también abre el proceso
  (clic o Enter, con el roving tabindex del grid); el enlace corta la propagación para no navegar
  dos veces y queda fuera del orden de Tab (la fila ya está). Las filas de discos no abren nada.
- **Recuento** con plurales (`count_one` y `count_other`) y aviso de recorte
  (`host-processes-partial`, `role="status"`, color de aviso) si algún `partial` es de
  `builtin:tech.generic.*`. Los `warnings` de la API, con `ApiWarnings` en cada tarjeta.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con 3 discos del simulador, la tabla los enseña ordenados del más lleno, con su %,
  usado/total, libre, lectura y escritura formateados.
- CA2 (e2e): con 15 procesos en el simulador, la tabla enseña 10, ordenados por CPU, y «10 de 15
  procesos».
- CA3 (e2e): pulsar un proceso abre su página de entidad con su nombre, y «Volver» regresa al host
  sin volver a pedir sus datos.
- CA4 (e2e): ordenar por otra columna (memoria, libre) reordena las filas.
- CA5 (unitario): color y texto de la barra de uso según el % (umbrales 80 y 90).
- CA6 (e2e): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos
  siguen; sin datos, los textos de vacío.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con hosts reales, que los discos y los procesos cuadran con Dynatrace y que la tabla se lee de un
  vistazo.

## Fuera de alcance

- Más de 10 procesos, filtros o búsqueda en las tablas.
- Gráfico por disco o por proceso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- CA1-CA7 y el aviso de recorte con su test; fallarían sin el código; tests sin tocar tras `7ac565f`.
- `DataGrid` con orden y teclado; `usageBar` con umbrales estrictos y texto; «10 de N» con plurales; aviso de
  recorte solo con `partial` de `builtin:tech.generic.`; enlace solo con id válido de
  `PROCESS_GROUP_INSTANCE`; «Volver» sin pedir otra vez; formatos con `formatNumber`; estados de carga,
  error y vacío. Sin canal nuevo; ADR-0004; sin datos del tenant.
- Opcionales: filas de discos con `cursor-pointer` sin acción (prop en `DataGrid` para filas no
  activables); unitarios de `processLinkId`, `processesTruncated` y `diskTotal`; los `warnings` se ven en
  las dos tarjetas.

## Verificación

Tests escritos en el commit `7ac565f` (`test(host): criterios de la ficha 0019 (#0019)`). Al
escribirlos fallan los siete e2e nuevos (no existen `host-disks` ni `host-processes`) y los
unitarios (no existen `formatBytes`, `formatByteRate` ni `usageBar` en `lib/host-format.ts`, ni
`entities.host.disks` ni `entities.host.processes` en los locales). Los e2e de la 0017 y la 0018
siguen en verde con el simulador ampliado.

| Criterio             | Test                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA1                  | `e2e/views.spec.ts` › `CA1 (0019): con 3 discos, la tabla los enseña del más lleno al menos, con su %, usado/total, libre, lectura y escritura formateados`; apoyo unitario en `src/renderer/src/lib/host-format.test.ts` › `CA1 (0019): lectura y escritura en bytes/s adaptados, y tamaños en bytes` |
| CA2                  | `e2e/views.spec.ts` › `CA2 (0019): con 15 procesos, la tabla enseña los 10 con más CPU, ordenados, y «10 de 15 procesos»`                                                                                                                                                                              |
| CA3                  | `e2e/views.spec.ts` › `CA3 (0019): pulsar un proceso abre su página de entidad con su nombre, y «Volver» regresa al host sin volver a pedir sus datos`                                                                                                                                                 |
| CA4                  | `e2e/views.spec.ts` › `CA4 (0019): ordenar por otra columna (libre en discos, memoria en procesos) reordena las filas`                                                                                                                                                                                 |
| CA5                  | `src/renderer/src/lib/host-format.test.ts` › `CA5 (0019): color y texto de la barra de uso según el % (umbrales 80 y 90)`; y en el e2e de CA1, `data-level` y el texto del nivel de cada disco                                                                                                         |
| CA6                  | `e2e/views.spec.ts` › `CA6 (0019): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos siguen` y `CA6 (0019): sin datos, «Sin discos» y «Sin procesos»`                                                                                                                 |
| CA7                  | `src/renderer/src/locales/host-page.test.ts` › `CA7 (0019): textos de las tablas de discos y procesos en es y en` (la paridad general la sigue mirando `CA9 (0018)` y `locales.test.ts`)                                                                                                               |
| Nota del Orquestador | `e2e/views.spec.ts` › `Aviso de recorte de procesos (0019): con la métrica de procesos en partial, la tabla avisa de que la lista y el total pueden estar incompletos`                                                                                                                                 |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Nombres que fijan los tests.** Tarjetas `host-disks` y `host-processes`, debajo de
  `host-charts` (se mide que empiezan tras su borde inferior; el lado a lado no se prueba).
  Dentro, `DataGrid` con `gridTestId` `host-disks-grid` y `host-processes-grid`; filas
  `host-disk-row` con `data-disk-id` y `host-process-row` con `data-process-id` (con `rowData`).
  Columnas, en este orden: discos `name`, `usage`, `used` (usado / total), `free`, `read`, `write`;
  procesos `name`, `cpu`, `cpuMax`, `memory`. Orden por defecto: `usage` y `cpu` descendentes. En
  la celda de uso, la barra `host-disk-usage` con `data-level` (`normal`, `warning`, `error`) y,
  si no es normal, el texto del nivel de la 0018 (`entities.host.markers.levels.*`) en la celda.
  En la de CPU, la barra `host-process-cpu-bar`. El nombre del proceso es un enlace (role link
  con el nombre) a `#/entities/PROCESS_GROUP_INSTANCE/<id>`; la página de destino es
  `entity-page-process_group_instance` con el nombre en el h1. Recuento en `host-processes-count`
  («10 de 15 procesos», texto exacto); aviso de recorte en `host-processes-partial` (con
  «incomplet…»), solo si `partial` trae una métrica de procesos (`builtin:tech.generic.*`): una
  de discos recortada no lo enseña.
- **Orden por columna (CA4):** no se fija con qué dirección empieza una columna; sí que la misma
  columna otra vez invierte y que la anterior queda en `aria-sort="none"`. Se ordenan las filas
  que se ven (los 10 procesos), sin pedir datos.
- **Formatos:** `% de uso` con `formatUsagePct` (último dato, «91 %»). Usado / total y libre en GB
  (los datos del e2e están entre 1 y 999 GB, así que vale `formatGigabytes` o `formatBytes`);
  total = usado + libre. Lectura y escritura con `formatByteRate(bytesPerSecond, lang)`: B/s sin
  decimales por debajo de 1000 y kB/s, MB/s, GB/s y TB/s (de 1000 en 1000) con un decimal; la
  memoria de los procesos con `formatBytes(bytes, lang)` (B, kB, MB, GB, TB, mismas reglas:
  «300,0 MB»). CPU media y máxima con su %.
- **Barra de uso (CA5):** `usageBar(pct, lang)` en `lib/host-format.ts` →
  `{ level, width, text, levelKey }`: `level` de `usageLevel` (los umbrales estrictos de la 0018),
  `width` en 0–100 (recortado; 0 sin dato), `text` = `formatUsagePct` y `levelKey` la clave del
  texto del nivel o null. Sin dato: `{ normal, 0, '—', null }`.
- **Textos (CA7):** `entities.host.disks.{title,empty,columns.<id>}` y
  `entities.host.processes.{title,empty,partial,count,columns.<id>}` (con `count` o sus plurales
  `count_*`, con dos valores interpolados). En es: «Discos», «Sin discos», título que empieza por
  «Procesos», «Sin procesos».
- **Error (CA6):** cada tarjeta enseña un `role="alert"` con «Reintentar» y ninguna fila;
  marcadores y gráficos con sus datos. «Reintentar» de la tarjeta de discos recarga las dos (un
  solo canal).
- **Simulador:** `entities:hostBreakdown` responde también para `HOST_METRICS_ID` (el host de la
  página de la 0018) con `HOST_PAGE_DISKS` (3: `/datos` 91 %, `/var` 85 %, `/` 40 %, dados en
  otro orden) y `HOST_PAGE_PROCESSES` (15, ids `PROCESS_GROUP_INSTANCE-00000000000E2E29` a `…37`,
  memoria en otro orden que la CPU). Para ese host, una consulta de discos es del canal nuevo si
  solo lleva métricas `builtin:host.disk.*` y ningún `splitBy()` (las de `entities:hostMetrics`
  juntan con `splitBy()`). Interruptores: `sim.hostBreakdownFail` (400), `sim.hostBreakdownEmpty`
  (sin series) y `sim.hostBreakdownTruncated` (`'processes'` o `'disks'`: `dimensionCountRatio`
  1,5). El host de la 0017 (`BREAKDOWN_HOST_ID`) no cambia.

### Verifier, 2026-10-08, commit `197b4d6`, rango `main..197b4d6`: VERDE

- check: 2298 tests en 120 ficheros, cobertura ok.
- e2e completo (ventana del CI): 237/237.
- `-g "(0019)" --repeat-each 3 --workers=1`: 21/21.

## Resultado

- **Commits:** `7ac565f` (tests), `d8b8edf` (formatos, barra de uso y textos), `152c2fc` (tablas de
  discos y procesos), más los de ficha.
- **Ficheros principales:** `HostTables.tsx`, `host-tables.ts`, `lib/host-format.ts`,
  `useHostBreakdown` en `data/modules.ts`, locales es y en, simulador y `e2e/views.spec.ts`.
- **Rondas de revisión:** 1 (aprobada). Verifier en verde (check y e2e 237/237).
- **ADR nuevo:** ninguno. Sin migraciones.
- Los tres opcionales del revisor pasaron a «Mejoras anotadas» del BACKLOG. Pendiente de Dani: la
  prueba a mano con hosts reales.
