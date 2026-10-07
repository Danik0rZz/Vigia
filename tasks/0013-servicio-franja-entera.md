---
id: '0013'
titulo: 'SERVICE: la franja de problemas se ve entera y clara'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0013-servicio-franja-entera
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio-2» (0011 a 0015). Dani, sobre la franja de problemas encima de «Tasa de error»
(ficha 0010): le encanta que salgan por posición, pero la ve cortada: los tramos se ven como iconos
pequeños recortados (cajitas con el icono partido en la parte de arriba del gráfico), "como si el
tamaño lo cortara". Pide refinarla para que se vea entera y clara.

En la captura de Dani (rango de 24 h, cuatro problemas cerrados de pocos minutos) cada tramo es una
cajita del ancho mínimo con el icono partido por arriba: se ve la mitad del icono y nada del id.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «servicio-2»:** separador de miles siempre que
el número tenga 4 cifras o más, con punto en español («9.907», no «9907»; Dani: "más elegante y
cuidado"); la información de la entidad, breve, bonita y ágil, pero con el detalle a mano.

**Primero, la causa.** El developer reproduce el recorte con la ventana de los e2e y con zoom 150 %
(`webContents.setZoomFactor(1.5)` desde Playwright, que imita el escalado de la VPS de Dani) y anota
en "Resultado" qué lo corta (alto de fila de 20 px fijo frente al alto real del texto, el
`overflow-hidden` del tramo, el contenedor del gráfico o el ancho mínimo de los tramos cortos).

**Cómo tiene que verse** (`ProblemBand.tsx` y `problem-band.ts`):

- Cada tramo se ve entero: su caja, el icono y el texto, sin recortes, con cualquier zoom. El alto
  de la fila sale del contenido (no un número fijo de px que no cuente con el escalado).
- Un tramo con sitio enseña icono + id (P-…); uno estrecho, solo el icono, entero y centrado (el id
  sigue en el tooltip y en el nombre accesible). Nunca medio icono.
- La franja no tapa ni se mete en el área del gráfico, y el gráfico no la tapa a ella.
- Lo demás se queda como en la 0010: posición por tiempo, filas para los solapados (3 y «+N»),
  colores por estado con icono, tooltip, clic y Enter abren el problema.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con zoom 1 y con zoom 1,5, la caja del icono y la del texto de cada tramo quedan dentro
  de la caja de su tramo, y cada tramo dentro de la franja (sin recorte por arriba ni por abajo).
- CA2 (e2e): con zoom 1 y 1,5, la franja no se solapa con el `canvas` del gráfico de tasa de error.
- CA3 (e2e): un tramo muy corto (un problema de pocos minutos en un rango de 7 días, en el
  simulador) enseña su icono entero, sin texto, y su nombre accesible lleva el id.
- CA4 (e2e): los e2e de la 0010 siguen pasando (posición, filas, tooltip y clic).

## Pruebas a mano para Dani

- En la VPS (escalado al 150 %) y con un servicio real con problemas, que la franja se ve entera y
  clara.

## Fuera de alcance

- La franja en otros gráficos o cambiar cómo se reparten las filas.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
