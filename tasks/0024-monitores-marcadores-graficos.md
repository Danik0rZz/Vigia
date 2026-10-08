---
id: '0024'
titulo: 'Monitores: marcadores y cuatro gráficos en las páginas de browser monitor y HTTP monitor'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0022', '0018']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0024-monitores-marcadores-graficos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:monitorMetrics` de la 0022 y los canales de problemas de las fichas 0007 y 0010)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «monitores» (0022 a 0026). "Haz lo mismo" que con SERVICE y HOST, con las métricas clave de
cada entidad. La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

En `BrowserMonitorEntityPage.tsx` y `HttpMonitorEntityPage.tsx` se quita «Página en construcción».
Las dos usan los mismos componentes (los comunes que sacó el lote «host», 0018), con los textos de
su tipo. Lo que no tenga métrica según la 0022 no se pinta.

**Marcadores** (cinco, centrados, con separador de miles):

| Marcador       | Valor principal             | Debajo                                                             |
| -------------- | --------------------------- | ------------------------------------------------------------------ |
| Disponibilidad | % del rango, con un decimal | color: error < 95 %, aviso < 99 %, con texto                       |
| Duración       | media (ms o s)              | mediana                                                            |
| Ejecuciones    | correctas                   | fallidas (en color de error si > 0)                                |
| Localizaciones | cuántas                     | cuántas por debajo del 100 % (de la 0023, cuando esté; antes, «—») |
| Problemas      | abiertos                    | cerrados                                                           |

**Gráficos** (rejilla 2×2, una columna si es estrecha, sin líneas de rejilla):

1. **Disponibilidad** (%), línea, con la **franja de problemas** encima (la de la 0010).
2. **Duración** (ms o s), línea.
3. **Ejecuciones:** correctas (verde) y fallidas (rojo) apiladas en barras.
4. **Rendimiento:** en browser, las métricas de experiencia que eligió la 0022 (LCP, visually
   complete…); en HTTP, los tiempos de DNS/TCP/TLS o los códigos de respuesta si los hay. Si no hay
   ninguna, la rejilla queda en tres.

Tooltip, «Abrir en Métricas», exportar, estados de carga y error por panel, rango global y
«Actualizar», como en el servicio. Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): la página de un browser monitor del simulador enseña los cinco marcadores con sus
  valores y los cuatro gráficos con sus series; no enseña «Página en construcción».
- CA2 (e2e): lo mismo para un HTTP monitor, con su cuarto gráfico de HTTP.
- CA3 (e2e): con un papel sin métrica (`null` en el simulador), su marcador o gráfico no sale y el
  resto sí.
- CA4 (unitario): colores de disponibilidad (95 y 99 %) con texto además del color.
- CA5 (e2e): la franja de problemas sale sobre la disponibilidad y abre el problema al pulsarla.
- CA6 (e2e): rango global, «Actualizar» y errores por panel como en el servicio.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con monitores reales de los dos tipos, que marcadores y gráficos cuadran con Dynatrace en el mismo
  rango.

## Fuera de alcance

- Localizaciones y pasos uno a uno (0025) y la información (0026).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `4b08411` (`test(monitores): criterios de la ficha 0024 (#0024)`). Al escribirlos
fallan los 7 e2e nuevos (la página del monitor ya no está en construcción en el test, pero no hay
`monitor-markers` ni `monitor-charts`) y los unitarios (no existe `lib/monitor-format.ts` ni
`entities.monitor` en los locales). Los e2e de la 0022, la 0023, `CA7 (0008)` y `CA3 (0018)` pasan
con el simulador ampliado.

| Criterio | Test                                                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0024): la página de un browser monitor enseña los cinco marcadores con sus valores y los cuatro gráficos con sus series, sin «Página en construcción»`                                                                                                     |
| CA2      | `e2e/views.spec.ts` › `CA2 (0024): la página de un HTTP monitor enseña los cinco marcadores con sus valores y los cuatro gráficos, el cuarto con los tiempos HTTP`                                                                                                                     |
| CA3      | `e2e/views.spec.ts` › `CA3 (0024): con el rendimiento sin métrica, su gráfico no sale, la rejilla queda en tres y el resto de marcadores y gráficos sí` (ver la nota)                                                                                                                  |
| CA4      | `src/renderer/src/lib/monitor-format.test.ts` › `CA4 (0024): colores de disponibilidad (95 y 99 %)`; `src/renderer/src/locales/monitor-page.test.ts` › `CA4 (0024): los niveles de la disponibilidad llevan texto además del color`; y en CA1 y CA2, `data-level` y el texto del nivel |
| CA5      | `e2e/views.spec.ts` › `CA5 (0024): la franja de problemas sale sobre el gráfico de disponibilidad con los problemas del monitor, y pulsar un tramo abre el problema`                                                                                                                   |
| CA6      | `e2e/views.spec.ts` › `CA6 (0024): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no`, `CA6 (0024): si falla el canal de métricas, …` y `CA6 (0024): si falla el desglose, …`                                                 |
| CA7      | `src/renderer/src/locales/monitor-page.test.ts` › `CA7 (0024): textos de las páginas de monitor en es y en`                                                                                                                                                                            |

**Nota sobre CA3 («`null` en el simulador»):** el simulador es HTTP y `null` lo pone main por tipo
(`performance` en HTTP, `httpTimings` en browser), nunca en el cuarto gráfico del propio tipo: tal
como está escrito, un papel `null` visible no se puede provocar desde el simulador. El test usa lo
más cercano que dice la especificación («si no hay ninguna, la rejilla queda en tres»): el browser
monitor con las cuatro métricas de rendimiento sin series (`sim.monitorPerformanceEmpty`). Que el
HTTP monitor no pinte la mediana (`null` por tipo) lo mira CA2. A confirmar por el Orquestador.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Nombres que fijan los tests** (los dos tipos comparten componentes y testids): páginas
  `entity-page-synthetic_test` y `entity-page-http_check` (las que ya había); fila
  `monitor-markers`; cada marcador `monitor-marker-<id>` (`availability`, `duration`,
  `executions`, `locations`, `problems`); valor principal en `monitor-marker-value`, lo de debajo
  en `monitor-marker-secondary`, el texto del nivel en `monitor-marker-level` y los recuentos en
  `monitor-marker-open` y `monitor-marker-closed`. Gráficos: sección `monitor-charts`; cada uno en
  un `monitor-chart-panel` con `data-kind` (`availability`, `duration`, `executions`,
  `performance`, en ese orden; el cuarto es el de rendimiento en browser y el de tiempos en HTTP)
  y su título en un encabezado; dentro, el `Chart` `monitor-chart-<kind>` con `data-series`.
  Franja: `monitor-problem-band`, solo en el panel de la disponibilidad y encima del canvas; tramos
  `monitor-problem-segment` con `data-problem-id`.
- **Niveles:** `availabilityLevel(pct)` en `lib/monitor-format.ts`, con `AVAILABILITY_ERROR_PCT = 95`
  y `AVAILABILITY_WARNING_PCT = 99`; los dos «por debajo» estrictos (95 es `warning`, 99 es
  `normal`); sin dato, `normal`. En `data-level` del valor de la disponibilidad y, si no es
  `normal`, con texto en `monitor-marker-level` (`entities.monitor.markers.levels.warning` y
  `.error`, distintos). Las fallidas, con `data-level` (`error` si > 0, `normal` si no) en
  `monitor-marker-secondary` de «Ejecuciones».
- **Valores (es):** browser, disponibilidad «87,5 %» (`error`), duración media 4550 ms en s con un
  decimal («4,5 s» o «4,6 s»: el redondeo de 4,55 no se fija) y debajo «Mediana» con «4,4 s»,
  ejecuciones 4 y 1 fallida, localizaciones 3 y 2 por debajo del 100 %, problemas 1 y 1. HTTP,
  «92,5 %» (`error`), «310 ms» sin «Mediana» (no hay métrica), 10 y 2, 4 localizaciones y 1 por
  debajo, problemas 0 y 1.
- **Series (`data-series`, es):** disponibilidad y duración, una; ejecuciones `[correctas,
fallidas]`; rendimiento en browser, LCP, visually complete y speed index (el CLS puede ir o no:
  no es un tiempo); en HTTP, DNS, TCP y TLS (el primer byte puede ir o no), 3 o 4 series. Que las
  ejecuciones vayan apiladas en barras y sin líneas de rejilla no se ve en `data-series`; lo mira el
  reviewer.
- **Textos:** `entities.monitor.markers.{availability,duration,executions,locations,problems}` =
  Disponibilidad, Duración, Ejecuciones, Localizaciones, Problemas y
  `entities.monitor.charts.{availability,duration,executions,performance}` = Disponibilidad,
  Duración, Ejecuciones, Rendimiento.
- **Simulador:** las páginas usan `MONITOR_BROWSER_ID` y `MONITOR_HTTP_ID` (los de la 0022), que
  ahora también responden al desglose de la 0023 (solo con sus expresiones confirmadas): el browser
  con las 3 localizaciones de la 0023 y el HTTP con 4 (una por debajo del 100 %).
  `monitorBandProblems()`: el browser con P-E2E71 (abierto) y P-E2E72 (cerrado), el HTTP con
  P-E2E73 (cerrado), en recuentos, franja y detalle. `sim.monitorMetricsFail` y
  `sim.monitorBreakdownFail` hacen fallar con un 400 cada canal; `sim.monitorPerformanceEmpty`
  deja sin series las cuatro de rendimiento del browser.
- **Test anterior ajustado:** `CA7 (0008)` saca SYNTHETIC_TEST y HTTP_CHECK de la lista de tipos en
  construcción.

## Resultado

(pendiente)
