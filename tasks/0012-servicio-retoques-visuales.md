---
id: '0012'
titulo: 'SERVICE: gráficos sin líneas de rejilla, marcadores centrados y miles siempre con separador'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0012-servicio-retoques-visuales
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 2
---

## Petición original

Lote «servicio-2» (0011 a 0015). Dani, sobre la página del servicio (lote «servicio», 0006 a 0010):

1. "Gráficos: quitar las líneas horizontales de la rejilla para que queden limpios."
2. "Marcadores (las cinco tarjetas de arriba): el texto no está centrado; centrarlo, o al menos más
   centrado que ahora" (hoy título y valor van a la izquierda, con mucho hueco a la derecha).

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «servicio-2»:** separador de miles siempre que
el número tenga 4 cifras o más, con punto en español («9.907», no «9907»; Dani: "más elegante y
cuidado"); la información de la entidad, breve, bonita y ágil, pero con el detalle a mano.

- **Gráficos** (`src/renderer/src/pages/entities/service-charts.ts`): el eje Y de los cuatro
  gráficos sin líneas de rejilla (`splitLine.show: false`). Se quedan las etiquetas del eje Y y el
  eje X. Solo en la página del servicio: el gráfico de Métricas y el mini gráfico de las evidencias
  no cambian.
- **Marcadores** (`ServiceMarkers.tsx`): en las cinco tarjetas, título y contenido centrados en
  horizontal (`text-center` y los grupos internos con `justify-center`), también las filas
  secundarias (p90/p99, abiertos/cerrados). El tamaño y los colores no cambian. Con la ventana
  estrecha (2 columnas o 1) siguen centrados.
- **Separador de miles en toda la interfaz:** los números de 4 cifras o más llevan siempre
  separador (en español «9.907» y «2.128.749»; en inglés «9,907»). Hoy cada sitio usa
  `new Intl.NumberFormat` por su cuenta y en español no agrupa los de 4 cifras. Se crea una función
  común (por ejemplo `formatNumber(language, options)` en `src/shared/`) con
  `useGrouping: 'always'` y todos los usos de la interfaz pasan por ella (marcadores, gráficos,
  ejes, tooltips, Inicio, Problemas, Métricas, evidencias y avisos). Las exportaciones XLSX no
  cambian: llevan números, no texto.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario): la opción de ECharts de los cuatro gráficos del servicio lleva
  `yAxis.splitLine.show === false`, y la del gráfico de Métricas sigue como estaba.
- CA2 (e2e): en las cinco tarjetas, el centro horizontal del título y del valor principal está a
  como mucho 4 px del centro de la tarjeta (con la ventana de los e2e y con la estrecha).
- CA3 (e2e): las filas secundarias (p90/p99 y abiertos/cerrados) también quedan centradas (mismo
  margen de 4 px).
- CA4 (unitario): `formatNumber` da «9.907», «2.128.749», «999» y «1.234,5» en español y «9,907» en
  inglés.
- CA5 (unitario): un test recorre `src/renderer/src` y `src/shared` y falla si aparece
  `new Intl.NumberFormat` fuera de `formatNumber` (o de su test).
- CA6 (e2e): el marcador «Peticiones KO» del simulador con 9907 enseña «9.907».

## Pruebas a mano para Dani

- Que los gráficos y los marcadores se ven como quería, en claro y en oscuro.

## Fuera de alcance

- Otros cambios de estilo en la página o en otros gráficos.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: CAMBIOS (ficha ligera)

1. [Especificación] Los ejes Y del gráfico de Métricas (`metric-chart-option.ts:39-43`) y del histograma de
   Problemas (`ProblemsPage.tsx:158-163`) no pasan por `formatNumber`: ECharts pone comas (`addCommas`),
   y en español sale «2,128,749». La especificación incluye ejes, Problemas y Métricas. Acción:
   `formatter: (value: number) => formatNumber(value, language)` en el `axisLabel` del eje Y de los dos,
   como `EvidenceMetricChart.tsx:144`, y un unitario del `formatter` de Métricas («1.234» en es), sin
   tocar CA1.

Bien: tests sin tocar tras sus commits; los cambios de `problem-evidence.test.ts` solo añaden el
separador; CA2 y CA3 miden el texto con un `Range`; `grid-cols-1` correcto; el formateador de i18next
solo toca cantidades (revisadas todas las variables de los locales); hoja Info aceptable.

Opcionales: los tests del formateador se llaman «CA5 (0012)» y CA5 es otra cosa; orden de imports
`@shared` antes que los relativos; un caso de plural en inglés.

### Ronda 2: APROBADO

- Ejes Y de Métricas y del histograma de Problemas con `formatNumber`; CA1 sin cambios; test nuevo del eje
  de Métricas (es y en). Tests sin tocar tras `3bd7071`; el renombrado no cambia aserciones.
- Ningún eje ni tooltip de ECharts queda sin `formatNumber`. Nada más roto.

## Verificación

Ficha ligera: tests del developer en `7d37030` (`test(servicio): criterios de la ficha 0012`).

- CA1: `src/renderer/src/pages/entities/service-charts.test.ts` (los cuatro gráficos) y
  `src/renderer/src/pages/metrics/metric-chart-option.test.ts` (Métricas conserva la rejilla).
- CA2 y CA3: `e2e/views.spec.ts`, con FIXED_WINDOW (1024×720, 5 columnas) y SMALL_WINDOW
  (960×600, 2 columnas), sobre el servicio SVC_ID.
- CA4 y CA5: `src/shared/format-number.test.ts`.
- CA6: `e2e/views.spec.ts`, servicio nuevo del simulador con 9907 KO.
- Textos de i18next (a petición del Orquestador, commit de tests `c3fcb17`): `src/renderer/src/app/i18n-numbers.test.ts`
  y el e2e «Separador en textos (0012): los números de los avisos…» (P-792, con 1234 comentarios →
  «1.234»). En la ronda 1 (`3bd7071`) se renombran de «CA5 (0012)» a «Separador en textos (0012)»
  (CA5 es la búsqueda de `Intl.NumberFormat`) y se añade un plural en inglés.
- Ronda 1, ejes Y: «Separador de miles en el eje Y de Métricas (0012)», en
  `metric-chart-option.test.ts` (`3bd7071`).

Al escribirlos fallaban por falta de código (módulos inexistentes, `splitLine.show` undefined,
desvíos de 12 a 98 px y «9907»).

### Verifier, 2026-10-08, commit `1273438`, rango `main..1273438`: VERDE

- check: 2156 tests en 110 ficheros, cobertura ok.
- e2e completo (ventana del CI): 215/215.
- `-g "(0012)" --repeat-each 3 --workers=1`: 18/18.

## Resultado

Commits (rama `feat/0012-servicio-retoques-visuales`): tests `7d37030`, `c3fcb17` y `3bd7071`; código `864c193`, `030ecb9`, `63bb039`, `72339a0` y `b65a72f`. Ficheros principales: `src/shared/format-number.ts`, `src/renderer/src/app/i18n-numbers.ts`, `src/renderer/src/pages/entities/service-charts.ts`, `ServiceMarkers.tsx` y `pages/metrics/metric-chart-option.ts`. Rondas de revisión: 2. ADR nuevo: ninguno. Sin migraciones.

Decisiones del developer (refinables, delegadas por el Orquestador):

- `formatNumber(value, language, options?)` en `src/shared/format-number.ts`, con
  `useGrouping: 'always'` encima de las opciones. Sustituye los 17 `new Intl.NumberFormat` de la
  interfaz y de `problem-evidence.ts` (en `service-charts.ts`, el ayudante local pasa a
  `formatDigits`).
- Para probar CA1 en Métricas, su opción de ECharts sale de `MetricChartPanel.tsx` a
  `pages/metrics/metric-chart-option.ts`, sin cambios.
- CA2 y CA3 miden el contenido con un Range (no la caja del elemento, que ocupa todo el ancho). El
  «valor principal» de Tiempo de respuesta es la línea de la mediana y el de Problemas, el grupo de
  los dos recuentos; en CA3, además, número y nombre de cada recuento quedan centrados entre sí.
- Con 5 columnas, la línea «105 ms Mediana» no cabía y ensanchaba la columna de la tarjeta (título
  y filas desbordaban y se descentraban 28 px). La tarjeta lleva `grid-cols-1` y la mediana
  `flex-wrap`: «Mediana» baja a la línea siguiente si no cabe. Tamaños y colores sin cambios.
- Dentro de un marcador, el esqueleto de carga y el aviso de error (`MarkerError` con la prop
  nueva `centered`) también van centrados; en la franja y los gráficos, el aviso sigue igual.
- Tests viejos al formato nuevo: tres expectativas unitarias de `src/shared/problem-evidence.test.ts`
  (`formatUnit`: «1234,5» → «1.234,5», «1023,99 B» → «1.023,99 B», «2048 GB» → «2.048 GB»).
  Ningún e2e esperaba números de 4 cifras sin punto.
- El cambio de `formatNumber` y el de la rejilla van en un solo commit (`864c193`): el pre-commit
  corre los tests relacionados de `service-charts.ts`, que tiene las dos cosas.

- Números interpolados en los textos de i18next (avisos, «Ver todos (N)», recuentos con plural):
  un formateador de i18next (`app/i18n-numbers.ts`, con `alwaysFormat`) pasa cada número por
  `formatNumber`, sin tocar los textos de los locales ni cada llamada a `t()`. Lo que ya llega
  como texto (formateado o de Dynatrace) queda igual y `count` sigue eligiendo el plural. Con
  esto, `ModuleState` ya no formatea por su cuenta. También afecta a los avisos de la hoja Info
  de la exportación de un problema (son texto); las celdas con números no cambian.

- Ronda 1 (`b65a72f`): el eje Y de Métricas y el del histograma de Problemas llevan
  `formatter` con `formatNumber` (ECharts ponía comas). Revisados los demás gráficos: los
  tooltips ya pasan por `axisTooltip` con `formatNumber`, y los ejes Y del servicio y de las
  evidencias ya tenían su `formatter`. El import de `@shared/format-number` va con los de
  `@shared`, antes de los relativos.

`npm run check`: 2156 tests en verde. `npm run test:e2e` completo (toca `e2e/areas.json`,
transversal): 215 en verde.
