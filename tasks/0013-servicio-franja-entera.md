---
id: '0013'
titulo: 'SERVICE: la franja de problemas se ve entera y clara'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

**Decisión del Orquestador (2026-10-07, alcance dentro de la ficha):** el CI rojo tras la 0011 no es el
recorte: en la ventana del runner (pantalla de 1024×768) el tramo cerrado del CA5 (0010) queda por
debajo del borde visible y el test pulsa sin traerlo a la vista (ver "Resultado"). Como CA4 exige
que los e2e de la 0010 sigan pasando, esta ficha también hace que el CA5 (0010) traiga el tramo a la
vista (desplazando su contenedor, como haría el usuario) y espere a que esté quieto antes de
`clickInPlace`, sin cambiar ninguna de sus comprobaciones. El test nuevo de esta ficha lo comprueba
con la ventana del tamaño del CI.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con zoom 1 y con zoom 1,5, la caja del icono y la del texto de cada tramo quedan dentro
  de la caja de su tramo, y cada tramo dentro de la franja (sin recorte por arriba ni por abajo).
- CA2 (e2e): con zoom 1 y 1,5, la franja no se solapa con el `canvas` del gráfico de tasa de error.
- CA3 (e2e): un tramo muy corto (un problema de pocos minutos en un rango de 7 días, en el
  simulador) enseña su icono entero, sin texto, y su nombre accesible lleva el id.
- CA4 (e2e): los e2e de la 0010 siguen pasando (posición, filas, tooltip y clic), también con la
  ventana del tamaño del CI (contenido de unos 1008×705), donde el tramo empieza fuera de la vista.

## Pruebas a mano para Dani

- En la VPS (escalado al 150 %) y con un servicio real con problemas, que la franja se ve entera y
  clara.

## Fuera de alcance

- La franja en otros gráficos o cambiar cómo se reparten las filas.

## Ideas surgidas (fuera de alcance)

- (developer) Con el ancho mínimo, dos problemas cortos y seguidos en la misma fila pueden quedar
  uno encima del otro (el reparto de filas cuenta el tiempo, no el ancho pintado). Cambiar el
  reparto queda fuera de esta ficha.

## Notas del revisor

### Ronda 1: APROBADO (ficha ligera)

- Tests del developer (`4553cd5`) por criterio; CA1 y CA3 fallaban sin el arreglo; CA4 lo cubre «CA4
  (0013)» commiteado con `withContentSize({ width: 1008, height: 705 })`, que comprueba antes que el
  tramo empieza fuera de la vista; CA2 sirve de guarda. Tests sin tocar tras `4553cd5`.
- CA5 (0010): solo cambia una línea (`clickInPlace(…, { scroll: true })`); ninguna aserción.
- `ProblemBand.tsx`: alto desde un medidor en rem (sigue al zoom), ancho mínimo con el icono entero, tramo
  final corrido a la izquierda, nunca medio id; color nunca solo. Fixtures sintéticos.
- Opcionales: un tramo de 80-90 px con un id real largo no enseña el id pero deja el icono a la izquierda
  (`ProblemBand.tsx:179`, el centrado depende del ancho del contenedor); «CA4 (0013)» no repite las filas
  con la ventana del CI; la lección del tooltip de Radix y `focus()` a `e2e/CLAUDE.md`.

## Verificación

Tests (ficha ligera, del developer): commit 4553cd5, en `e2e/views.spec.ts`.

- CA1 → «CA1 (0013)»: zoom 1 y 1,5; tramos anchos (2 h, con id) y estrechos (7 días, `SVC_SHORT_ID`,
  uno pegado al final del rango). Fallaba antes del arreglo (icono fuera del tramo).
- CA2 → «CA2 (0013)»: franja encima del `canvas` y cada tramo recibe el clic en su centro. Ya pasaba
  antes del arreglo (es la guarda de que el nuevo alto no se mete en el gráfico).
- CA3 → «CA3 (0013)»: icono entero y centrado, sin texto visible y con el id en el nombre accesible.
  Fallaba antes del arreglo.
- CA4 → los e2e de la 0010 y «CA4 (0013)» (ventana del CI, 1008×705, con el tramo fuera de la vista
  al abrir). El CA5 (0010) usa `clickInPlace(…, { scroll: true })` (decisión del Orquestador); sus
  comprobaciones no cambian. Pasaba ya con el cambio de la ayuda, que va en el commit de tests.

Ejecución: `npm run check` en verde (2134 unitarios); `npm run test:e2e:affected -- main..HEAD`,
124 passed; «CA5 (0010)» envuelto a mano (sin commitear) en la ventana del CI más los cuatro de la
0013, `--repeat-each 3 --workers=1`: 15 passed.

### Verifier, 2026-10-07, commit `e37209c`, rango `main..e37209c`: VERDE

- check: 2134 tests en 106 ficheros, cobertura ok.
- e2e completo: **201/201**, sin fallos.
- `views.spec.ts -g "(0010)|(0013)" --repeat-each 3 --workers=1`: 24/24.

## Resultado

**Diagnóstico (developer, 2026-10-07), antes de tocar código.** Medido con un test temporal (no
commiteado) sobre `SVC_BAND_ID` (rango 2 h), en la VPS:

- **Fallo del CI en «CA5 (0010)» (run 37675895942): no es el recorte de la franja.** Con el
  contenido a 1024×720, el tramo cerrado queda en `top` 771 px con `innerHeight` 720: está debajo
  de lo visible de `main` (scrollTop 0, clientHeight 657, scrollHeight 1032).
  `elementFromPoint` en su centro devuelve `null` (punto fuera de la ventana), así que
  `receivesClick` da false. Con 1008×705 (lo que deja una pantalla de 1024×768) la cuadrícula pasa
  a una columna y el tramo baja a 1291 px: igual. Con la ventana de la VPS (1280×802) el tramo está
  en 745 px, dentro, y el test pasa. `clickInPlace` no desplaza (a propósito), y el test de la 0010
  no lleva el tramo a la vista antes de pulsarlo.
- **Recorte que vio Dani:** con zoom 1 y 1,5 la caja del icono (12 px) y la del texto (16 px) caben
  en vertical en la fila de 20 px CSS (`setZoomFactor` escala también los px fijos). El recorte
  viene del ancho: un tramo corto toma el ancho mínimo de 8 px, con `px-1` (4 + 4 px) no le queda
  sitio y el icono (12 px, `shrink-0`) se sale y lo corta el `overflow-hidden` del tramo.

**Arreglo (developer), commit d3dc6aa, `ProblemBand.tsx`** (`problem-band.ts` no cambia):

- Cada fila es un bloque con un medidor invisible con la misma caja que un tramo (borde, `py-px`,
  `text-xs leading-4`): el alto sale del contenido, en rem, y sigue al zoom. Los tramos van encima,
  con `inset-y-0`. El «+N» va en la última fila, a la izquierda del área de dibujo.
- Ancho mínimo `calc(0.75rem + 8px)`: el icono entero con su relleno y su borde. El tramo pegado al
  final del rango se corre a la izquierda (`left: min(L%, 100% - ancho)`) en vez de recortarse.
- Icono e id en una línea con `flex-wrap` y `overflow-hidden`: si el id no cabe entero salta a una
  segunda línea que queda fuera de la caja, así que se ve solo el icono (centrado con
  `@container` por debajo de 5rem) y nunca medio id. El icono lleva `my-0.5` para medir lo mismo
  que la línea y quedar centrado en vertical.
- `clickInPlace` acepta `{ scroll: true }`: trae el elemento al centro de la vista
  (`scrollIntoView`) antes de medir; sin la opción sigue fallando si el elemento está fuera, que es
  lo que quieren las listas. Lección para `e2e/CLAUDE.md`: el tooltip de Radix se cierra si se
  desplaza un contenedor del disparador, y `focus()` desplaza; traer el tramo a la vista antes de
  enfocarlo (`CA4 (0013)`).

**Cierre (doc-writer, 2026-10-07).** Commits: `4553cd5` (tests), `d3dc6aa` (arreglo). Ficheros
principales: `src/renderer/src/pages/entities/ProblemBand.tsx` y `e2e/views.spec.ts` (ayuda
`clickInPlace` con `{ scroll: true }` y CA5 (0010)). Rondas de revisión: 1 (aprobada). ADR nuevo:
ninguno. Sin migraciones.
