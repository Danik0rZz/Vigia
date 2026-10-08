---
id: '0018'
titulo: 'HOST: marcadores y cuatro gráficos (CPU, memoria, red y disco) con la franja de problemas'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0016']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0018-host-marcadores-graficos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:hostMetrics` de la 0016, y `entities:problemCounts` y `entities:problems` de las fichas 0007 y 0010, que ya aceptan cualquier tipo estándar)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host» (0016 a 0020). "Poner las cajitas igual que tenemos en la vista de SERVICE" y graficar
CPU, memoria, red y disco. La petición completa está en la ficha 0016.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

En `HostEntityPage.tsx` se quita «Página en construcción». La página sigue el modelo del servicio
y **reutiliza sus piezas**: las tarjetas de marcadores, el panel de gráfico con «Abrir en Métricas» y
exportar, el eje de tiempo, la franja de problemas y el formato de números (con separador de miles
siempre, ficha 0012). Si hace falta, el developer saca de los componentes del servicio una pieza
común; el servicio no cambia de aspecto.

**Marcadores** (cinco, como en el servicio, centrados):

| Marcador  | Valor principal                    | Debajo                                |
| --------- | ---------------------------------- | ------------------------------------- |
| CPU       | media del rango (%)                | máxima                                |
| Memoria   | media del rango (%)                | usada / total (GB)                    |
| Red       | entrada media (Mbit/s o similar)   | salida media                          |
| Disco     | el más lleno (máximo del rango, %) | cuál es (nombre, si llega en la 0016) |
| Problemas | abiertos                           | cerrados                              |

- CPU, memoria y disco en color de aviso por encima del 80 % y de error por encima del 90 %, siempre
  con texto (los umbrales, fijos y anotados en código).

**Gráficos** (rejilla 2×2, una columna si es estrecha):

1. **CPU:** uso total (línea) y, debajo, `user`, `system` e `iowait` apilados en área (los que haya
   confirmado la 0016). Eje 0–100 %. **Con la franja de problemas del host encima** (la de la 0010).
2. **Memoria:** uso en % (línea). Eje 0–100 %.
3. **Red:** entrada y salida (dos líneas), con unidad de bits/s adaptada (kbit/s, Mbit/s, Gbit/s).
4. **Disco:** % del disco más lleno (línea). Eje 0–100 %.

Sin líneas de rejilla horizontales (como el servicio tras la 0012). Tooltip con fecha y hora y cada
serie con su unidad; `null` como hueco. Estados de carga y error por panel. Textos en es y en.

**Decisión del Orquestador (2026-10-08, delegada por Dani; refinable):** la 0016 confirmó en vivo que
`user + system + iowait` no suma el uso total de CPU. Apiladas en área parecerían un reparto del total que
no cuadra, así que el desglose va en **líneas separadas, sin apilar**, junto al total. CA2 no cambia (las
series siguen siendo las mismas).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): la página de un HOST del simulador enseña los cinco marcadores con los valores del
  simulador formateados y no enseña «Página en construcción».
- CA2 (e2e): salen los cuatro gráficos en su orden con sus series (`data-series`): CPU con total y
  desglose, memoria, red con entrada y salida, y disco.
- CA3 (e2e): la franja de problemas sale sobre el gráfico de CPU con los problemas del host del
  simulador, y al pulsar un tramo se abre el problema.
- CA4 (unitario): unidades de red (bits/s a kbit/s, Mbit/s y Gbit/s, en es y en) y de memoria
  (bytes a GB).
- CA5 (unitario): los umbrales de color (80 y 90 %) en CPU, memoria y disco, con texto además del
  color.
- CA6 (e2e): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la
  página sin cambios, no.
- CA7 (e2e): si falla el canal de métricas, marcadores y gráficos enseñan el aviso con Reintentar y
  el marcador de problemas sigue.
- CA8 (e2e): la página del servicio sigue igual (sus e2e pasan).
- CA9 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con hosts reales, que los marcadores y los gráficos cuadran con Dynatrace en el mismo rango y se
  leen bien en claro y en oscuro.

## Fuera de alcance

- Discos y procesos uno a uno (0019) y la información del host (0020).
- Umbrales configurables.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en el commit `3a74b10` (`test(host): criterios de la ficha 0018 (#0018)`). Al
escribirlos, fallan los cinco e2e nuevos (no hay `host-markers` ni `host-charts`) y los unitarios
(no existe `lib/host-format.ts` ni `entities.host` en los locales).

| Criterio | Test                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0018): la página de un HOST enseña los cinco marcadores con los valores del simulador formateados, sin «Página en construcción»`                                                                                                                                      |
| CA2      | `e2e/views.spec.ts` › `CA2 (0018): salen los cuatro gráficos en su orden (CPU, memoria, red y disco), con su título y sus series`                                                                                                                                                                 |
| CA3      | `e2e/views.spec.ts` › `CA3 (0018): la franja de problemas sale sobre el gráfico de CPU con los problemas del host, y pulsar un tramo abre el problema`                                                                                                                                            |
| CA4      | `src/renderer/src/lib/host-format.test.ts` › `CA4 (0018): unidades de red (bits/s)` y `CA4 (0018): unidades de memoria (bytes a GB)`                                                                                                                                                              |
| CA5      | `src/renderer/src/lib/host-format.test.ts` › `CA5 (0018): umbrales de color de CPU, memoria y disco`; `src/renderer/src/locales/host-page.test.ts` › `CA5 (0018): los niveles de aviso y de error llevan texto además del color`; y en el e2e de CA1, `data-level` y el texto del nivel del disco |
| CA6      | `e2e/views.spec.ts` › `CA6 (0018): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no`                                                                                                                                                    |
| CA7      | `e2e/views.spec.ts` › `CA7 (0018): si falla el canal de métricas, marcadores y gráficos enseñan el aviso con Reintentar y el marcador de problemas sigue`                                                                                                                                         |
| CA8      | los e2e de la 0008, 0009, 0010, 0012, 0013 y 0015 sin cambios (salvo lo de abajo)                                                                                                                                                                                                                 |
| CA9      | `src/renderer/src/locales/host-page.test.ts` › `CA9 (0018): textos de la página del HOST en es y en`                                                                                                                                                                                              |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Nombres que fijan los tests.** Marcadores: fila `host-markers`; cada uno `host-marker-<id>`
  (`cpu`, `memory`, `network`, `disk`, `problems`); valor principal en `host-marker-value`, lo de
  debajo en `host-marker-secondary` y los recuentos en `host-marker-open` y `host-marker-closed`.
  Gráficos: sección `host-charts`; cada uno en un `host-chart-panel` con `data-kind` (`cpu`,
  `memory`, `network`, `disk`, en ese orden) y su título en un encabezado; dentro, el `Chart` con
  testid `host-chart-<kind>` y `data-series`. Franja: `host-problem-band`, solo en el panel de la
  CPU y encima del canvas; tramos `host-problem-segment` con `data-problem-id`. Si la franja y los
  marcadores se sacan del servicio a una pieza común, el servicio conserva sus `service-*`.
- **Series (`data-series`, en es):** CPU `[total, user, system, iowait]` (el primero con «total»;
  los otros con su nombre de Dynatrace), memoria y disco una cada uno, red `[entrada, salida]`.
  Que el desglose vaya sin apilar (decisión del Orquestador) no se ve en `data-series`; lo mira el
  reviewer.
- **Umbrales:** `usageLevel(pct)` en `lib/host-format.ts`, con `USAGE_WARNING_PCT = 80` y
  `USAGE_ERROR_PCT = 90`; «por encima» es estricto (80 es `normal`, 90 es `warning`); sin dato,
  `normal`. El nivel va en `data-level` (`normal`, `warning`, `error`) del valor principal y,
  además del color, con un texto visible en `host-marker-level` (`entities.host.markers.levels.warning`
  y `.error`, distintos entre sí); con `normal`, sin texto. «Siempre con texto» se lee así: el
  número solo no dice que esté en aviso.
- **Unidades:** `formatBitRate(bits, lang)`: bit/s sin decimales por debajo de 1000; kbit/s,
  Mbit/s y Gbit/s (de 1000 en 1000) con un decimal; `formatGigabytes(bytes, lang)`: GB de 10^9
  bytes con un decimal. Separador de miles siempre y «—» sin dato. En los marcadores (es): CPU
  «33,5 %» y máxima 95 %; memoria 57 % y «10,0 GB» / «16,0 GB»; red «3,6 kbit/s» y «650 bit/s»;
  disco 92 % (nivel `error`). El nombre del disco más lleno no se prueba: la 0016 no lo trae.
- **Textos:** `entities.host.markers.{cpu,memory,network,disk,problems}` = CPU, Memoria, Red,
  Disco, Problemas y `entities.host.charts.{cpu,memory,network,disk}` = CPU, Memoria, Red, Disco.
- **Simulador:** `hostBandProblems()` da a `HOST_METRICS_ID` un problema abierto (P-E2E51) y dos
  cerrados (P-E2E52 y P-E2E53) en las últimas 2 h (recuentos 1 y 2, y tres tramos), también en el
  detalle; `sim.hostMetricsFail` hace fallar con un 400 las consultas del canal `entities:hostMetrics`.
  En CA7, «Reintentar» de un marcador vuelve a pedir el canal (uno para marcadores y gráficos).
- **Tests anteriores ajustados (CA8):** tres e2e daban por hecho que el HOST seguía en
  construcción: `CA2 (0003)` ya no mira el bloque «Página en construcción» del HOST;
  `CA8 (0003)` admite en la página del host solo `GET /api/v2/metrics/query` y
  `GET /api/v2/problems`; y `CA7 (0008)` saca el HOST de la lista de tipos en construcción (sigue
  comprobando que no lleva los marcadores del servicio). Los del servicio no cambian.

## Resultado

(pendiente)
