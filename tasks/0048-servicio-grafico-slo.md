---
id: '0048'
titulo: 'SERVICE: gráfico de disponibilidad (SLO calculado) con umbral crítico del 90 %'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-tipos
depende_de: ['0047']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0048-servicio-grafico-slo
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa las series de peticiones y errores que ya trae `entities:serviceMetrics`)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «servicio-tipos» (0046 a 0048). Dani (2026-10-10): "Otra de las cosas que podemos pintar en la
página de servicios es un SLO que hice en la otra prueba de aplicación, que quedó bastante chulo":
una disponibilidad en % calculada a partir de las peticiones y los errores,

SLO = (Peticiones − Errores) / Peticiones × 100,

con un umbral crítico del 90 %.

## Especificación

- **Cálculo** (función pura, en la interfaz): para cada punto,
  `(peticiones − errores) / peticiones × 100`; `null` si no hay peticiones o falta alguno de los
  dos (hueco, no 0). Con las series que ya trae `entities:serviceMetrics`, del conjunto de métricas
  que elija la 0046. El valor del rango completo sale de los totales igual.
- **Nombre:** «Disponibilidad (SLO calculado)», con un tooltip que da la fórmula y aclara que lo
  calcula Vigía (no es un SLO configurado en Dynatrace, que son los de Inicio).
- **Gráfico**, una fila a todo el ancho **encima de la rejilla de 2×2** (es el dato que se lee
  primero): línea de la disponibilidad (eje 0–100 %, con el mínimo del eje ajustado para que se vea
  la variación, nunca por encima de 90), una **línea horizontal discontinua en el 90 %** con su
  etiqueta («Crítico 90 %») y los tramos por debajo del 90 % sombreados en el color de error del
  tema. Sin líneas de rejilla, tooltip con fecha y hora, exportar, como el resto. Sin «Abrir en
  Métricas» (es un cálculo de Vigía; se puede exportar).
- **Marcador:** en el marcador «Tasa de error», debajo, «Disponibilidad 99,5 %» (el valor del rango),
  en color de error si baja del 90 %, con texto.
- **Solo actividad** (`QUEUE_LISTENER_SERVICE`, 0047): no hay errores, así que no sale ni el gráfico
  ni la línea del marcador.
- Textos en es y en.

## Criterios de aceptación

- CA1 (unitario): el cálculo punto a punto, con peticiones 0 o `null` (sale `null`) y errores mayores
  que peticiones (nunca menos de 0).
- CA2 (unitario): la opción de ECharts lleva la línea del 90 % (`markLine`) y el sombreado de los
  tramos por debajo (`markArea` o `visualMap`); el mínimo del eje no pasa de 90.
- CA3 (e2e): en un servicio del simulador con una caída por debajo del 90 %, el gráfico sale encima
  de la rejilla con su serie (`data-series`) y la línea del umbral, y el marcador enseña la
  disponibilidad del rango en color de error.
- CA4 (e2e): en un servicio de solo actividad no sale el gráfico ni la línea del marcador.
- CA5 (e2e): el tooltip del nombre explica la fórmula (con ratón y con foco).
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un servicio real que haya tenido errores, que la disponibilidad y el umbral se ven como en su
  prueba anterior.

## Fuera de alcance

- Umbral configurable o de aviso (solo el crítico del 90 %).
- Crear o leer SLOs de Dynatrace desde esta página.

## Decisiones del developer (Dani delegó; refinables)

- Testids: panel `service-slo-panel` (dentro de `service-charts`, encima de la rejilla; aparte de `service-chart-panel` para no cambiar los recuentos de la 0009 y la 0047), `service-slo-chart` y `service-slo-title`; línea del marcador `service-marker-availability` con `data-critical`.
- El umbral se ve en e2e por `data-thresholds` del `Chart` (valores `yAxis` de los `markLine` de la opción, JSON), como ya hacía `data-mark-lines` con las verticales.
- Mínimo del eje Y: 5 puntos por debajo del valor más bajo, a múltiplos de 5, entre 0 y 85 (así la línea del 90 % siempre queda dentro); máximo 100.
- Tramos sombreados con `markArea` (ya registrado), medio paso antes y después de cada tramo seguido bajo el 90 % para que un punto suelto se vea; color `danger` al 15 %.
- Formato con un decimal, como la tasa de error («85,3 %»). Por debajo del 90 %, la línea del marcador va en `text-danger` y añade «· por debajo del 90 %» (el color no es la única señal).
- El panel sale solo con datos cargados y serie de errores (mientras carga o en Solo actividad, no); la exportación va sin consulta (no hay selector de Dynatrace).
- `EntityChartPanel` admite `selector` opcional (sin él, sin «Abrir en Métricas»), `titleHint` (tooltip del título con ratón y foco) y `testIds` propios.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

Ficha ligera: los tests del developer cubren cada CA tal como está escrito. CA1 y CA2 (cálculo con
`null` y con más errores que peticiones, línea del 90 % discontinua con su texto en es y en,
`markArea` solo bajo el 90 %, eje) fallarían sin el código; CA3 cuadra con las cifras del
simulador (85,3 %) y tiene su control al 100 %. CA4 ya pasaba sin código, pero espera a la serie de
actividad y fallaría si el gráfico saliera sin serie de errores: suficiente. Sin tocar tests tras
`51962dc`. Sin IPC, API, dependencias, esquema ni consultas nuevas (ADR-0004). `Chart.tsx`
(`data-thresholds` solo con `markLine` numérico) y `EntityChartPanel.tsx` (`selector`, `titleHint` y
`testIds` opcionales) no cambian nada para los demás gráficos.

Opcional: tests unitarios de `rangeAvailability` y `formatAvailability` (peticiones todas a `null` y
`series.errors === null`).

## Verificación

Tests en 51962dc (ficha ligera, escritos por el developer antes del código):

- CA1 y CA2: `src/renderer/src/pages/entities/service-availability.test.ts`.
- CA3, CA4 y CA5: `e2e/views.spec.ts` (`CA3 (0048)` x2, `CA4 (0048)`, `CA5 (0048)`), con el servicio `SVC_SLO_ID` del simulador.
- CA6: `src/renderer/src/locales/service-availability-view.test.ts`.

Código en 515dfac.

### Verifier, 2026-10-10, commit `74ec130`, rango `main..feat/0048-servicio-grafico-slo`: VERDE

- check: 3113 tests en 174 ficheros, cobertura ok.
- e2e completo (toca `Chart.tsx`): 326/326, sin intermitentes.
- Los 4 e2e de la 0048 ×3 con `--workers=1`: 12/12.

## Resultado

- Commits: `51962dc` (tests), `515dfac` (código); revisión y verificación en los commits de la ficha.
- Ficheros principales: `src/renderer/src/pages/entities/service-availability.ts`, `ServiceCharts.tsx`, `ServiceMarkers.tsx`, `EntityChartPanel.tsx` (opcionales `selector`, `titleHint`, `testIds`), `src/renderer/src/components/Chart.tsx` (`data-thresholds`) y los textos en es y en.
- Rondas de revisión: 1 (aprobado). ADR nuevo: ninguno. Sin migraciones.
- Sugerencia del revisor (tests unitarios de `rangeAvailability` y `formatAvailability` con datos a `null`) anotada en `BACKLOG.md`, "Mejoras anotadas".
