---
id: '0012'
titulo: 'SERVICE: gráficos sin líneas de rejilla, marcadores centrados y miles siempre con separador'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
