---
id: '0102'
titulo: Marcadores del HOST que no se parten ni se salen de su caja con la ventana de 1024 px
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0102-host-marcadores-ventana-pequena
adrs: [] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12). En una captura del e2e del
CA1 (0018), con el simulador y la ventana de 1024 px de los e2e, los marcadores del HOST se pintan
mal:

- Red: «3,6 kbit/s» se parte en dos líneas por la mitad de la unidad («3,6 kbi» / «t/s»).
- Memoria: «Recuperable ⓘ 2,5 G…» se sale de la caja y queda cortado; «10,0 GB de 16,0 GB» va
  justo.

Los tests pasan porque comprueban valores, no cómo se pintan. Criterio sugerido: con
`applyCiWindow` (1024×720), ningún valor de los marcadores se parte dentro de un número o una
unidad ni se sale de su caja, medido con la caja del elemento y no con el ancho supuesto.

## Especificación

Causa, vista en el código (2026-10-12):

- `BigValue` (`src/renderer/src/pages/entities/EntityMarkers.tsx`) lleva `wrap-anywhere`, que deja
  partir en cualquier carácter: con cinco tarjetas por fila a 1024 px (`lg:grid-cols-5` en
  `HostMarkers.tsx`), «3,6 kbit/s» se parte dentro de «kbit/s». `BigValue` lo comparten los
  marcadores de todas las páginas de entidad.
- `Reclaimable` (`HostMarkers.tsx`) es un `flex` de una línea sin `flex-wrap`: con la tarjeta
  estrecha, el valor se sale por la derecha y lo corta la caja.

Qué se construye (propuesta del Planificador; **Dani la eligió el 2026-10-12**: partir por el
espacio, con el mismo tamaño de letra):

- **Valor principal (`BigValue`):** se puede partir solo entre palabras (entre el número y la
  unidad, por el espacio), nunca dentro de un número ni de una unidad. «3,6 kbit/s» queda en una
  línea si cabe y, si no, «3,6» / «kbit/s». Se mantiene el tamaño de letra. Lo que no tiene espacio
  (un `%`) no se parte. Como `BigValue` es común, el cambio vale para todas las páginas de entidad.
- **Líneas de debajo** (recuperable, «usado de total», medias de red): pueden pasar a la línea
  siguiente entre palabras, centradas, y nunca salen de la caja. El rótulo «Recuperable» y su icono
  de ayuda van juntos; el valor puede bajar a la línea siguiente.
- Alternativa descartada por el Planificador: bajar el tamaño de letra para que todo quepa en una
  línea. Cambia el aspecto de todos los marcadores con cualquier ventana, y con valores más largos
  volvería a pasar.

## Carril

Normal (`ligera: no`):

1. No añade componentes, funciones ni cálculos nuevos: en la app, no (son clases de estilo), pero
   el e2e necesita una función nueva que mida las cajas y las líneas de cada valor.
2. No elimina nada visible para el usuario: cumple, no quita nada.
3. No toca datos, API ni lógica: cumple, solo el estilo.
4. No hay ninguna decisión que preguntar a Dani: **falla**. Cómo se reparte el valor (en dos líneas
   por el espacio o con letra más pequeña) cambia lo que ve el usuario en todas las páginas de
   entidad. Dani lo decidió el 2026-10-12 (por el espacio).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1: con `applyCiWindow` (1024×720) y los datos del simulador, en la página de un HOST, ningún
  texto de los cinco marcadores (valor principal, nivel, rótulo, líneas de debajo, recuperable y
  recuentos de problemas) se sale de la caja de su tarjeta: se mide con el rectángulo de cada
  elemento (`getBoundingClientRect` o los `Range` de su texto) contra el de la tarjeta, y también
  `scrollWidth <= clientWidth` en la tarjeta. e2e.
- CA2: en el mismo escenario, ningún número ni ninguna unidad del valor principal ni de las líneas
  de debajo se parte en dos líneas: cada palabra (separada por espacios) del texto ocupa una sola
  línea, medido con los rectángulos de un `Range` por palabra (`getClientRects` da uno). Incluye
  «kbit/s» del marcador de Red y el valor de «Recuperable». e2e.
- CA3: las mismas comprobaciones de CA1 y CA2 pasan en los marcadores de la página de un servicio
  con la ventana del CI, porque `BigValue` es común y no debe estropearlos. e2e.
- CA4: con `applyCiWindow` (1024×720), los valores principales de los marcadores del HOST que
  caben en una línea de su tarjeta (p. ej. el de CPU, con `%`) siguen en una sola línea: el
  arreglo no parte lo que cabe. e2e. (Reescrito por Dani el 2026-10-12: la ventana más ancha que
  1024 px no es fiable en el CI, cuya pantalla es de 1024×768.)

## Pruebas a mano para Dani

- Abrir la página de un HOST real con la ventana estrecha y con la ancha y ver que los marcadores se
  leen bien (con datos reales los valores pueden ser más largos que los del simulador).

## Fuera de alcance

- Cambiar el número de tarjetas por fila o el tamaño de letra de los marcadores.
- Los gráficos y las tablas del HOST.
- Comprobar las demás páginas de entidad una a una (proceso, disco, monitores, aplicación): CA3
  cubre el servicio como muestra de que `BigValue` no empeora.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1, CA2 y CA3 tienen su test con el número en el nombre (`e2e/views-host.spec.ts` y `e2e/views-servicio.spec.ts`). Miden con las cajas reales: `getBoundingClientRect`, un `Range` por texto y por palabra, y `scrollWidth <= clientWidth` (`markerLayout`, `expectMarkersInside` y `expectMarkersUnsplit` en `e2e/views/helpers.ts`). `git diff fe99a88..9827f2a -- e2e` sale vacío: el developer no tocó los tests de CA1 a CA3. El test de CA4 (`d4f210f`) se añadió después de que Dani reescribiera el criterio (`db83632`); exige que el valor de CPU quepa, para que no pase sin comprobar nada, y que cada valor que cabe ocupe una sola línea.
- Código: `BigValue` (`EntityMarkers.tsx`) cambia el espacio duro antes de una unidad con letras por uno normal, no antes del `%`; `wrap-anywhere` queda como último recurso. `children` es `string` en todos los usos, así que el `.replace` es seguro. `Reclaimable` (`HostMarkers.tsx`) pasa a `flex-wrap` centrado, con el rótulo y el icono en el mismo bloque; `ReclaimableHelp` conserva `data-testid`, `aria-label` y claves i18n. Encaja con lo que eligió Dani.
- Arquitectura y seguridad: solo estilos del renderer y e2e. Sin IPC, API, dependencias, esquema ni textos nuevos. Sin datos del tenant ni secretos.
- Legibilidad: comentarios en español e identificadores en inglés, con el estilo vecino.

Opcional: el cambio en `BigValue` también deja partir otros valores con espacio duro antes de letras (p. ej. duraciones como «1 h 20 min»). La ficha lo acepta («entre palabras»), pero las demás páginas de entidad solo se cubren con el servicio (CA3): conviene mirarlas en la prueba a mano de Dani.

## Verificación

Tests escritos en `fe99a88` (e2e, con la ventana del CI de todo el spec). Ayudantes nuevos en
`e2e/views/helpers.ts`: `markerLayout` (mide cada texto y cada elemento visible de una tarjeta
contra su rectángulo, y cada palabra con su `Range`), `expectMarkersInside` (CA1) y
`expectMarkersUnsplit` (CA2). Usan los `data-testid` de la 0018 y la 0008; no fijan nombres nuevos.

- CA1 → «CA1 (0102): con la ventana del CI, ningún texto de los cinco marcadores del HOST se sale
  de su tarjeta» (`e2e/views-host.spec.ts`). Falla hoy: `scrollWidth` de la memoria 155 > 128.
- CA2 → «CA2 (0102): con la ventana del CI, ningún número ni unidad de los marcadores del HOST se
  parte en dos líneas (incluidos «kbit/s» y la recuperable)» (`e2e/views-host.spec.ts`). Falla
  hoy: «kbit/s» en dos líneas.
- CA3 → «CA3 (0102): con la ventana del CI, los marcadores del servicio no se salen de su tarjeta
  ni parten un número o una unidad» (`e2e/views-servicio.spec.ts`). Pasa ya: es la guarda de que
  el cambio en `BigValue` no los estropea.
- CA4 → sin test: no se puede probar tal como está escrito. «La ventana ancha (la del arnés por
  defecto)» es la de `applyCiWindow` (1024×720), la misma de CA1, y con ella «3,6 kbit/s» no cabe
  en una línea (es justo el caso que se parte). Una ventana más ancha que 1024 no es fiable en el
  CI (pantalla de 1024×768, recorta la ventana). Dani lo reescribió el 2026-10-12: a 1024 px,
  los valores principales que caben siguen en una línea.

Desarrollo (`9827f2a`, developer). La causa real del corte de «kbit/s» era el espacio duro (U+00A0)
que ponen los formateadores entre número y unidad: el texto entero era una sola «palabra» y
`wrap-anywhere` la partía por cualquier letra. `BigValue` cambia ese espacio duro por uno normal
antes de una unidad con letras (no antes del `%`) y conserva `wrap-anywhere` solo como último
recurso para una palabra que sola no cabe. `Reclaimable` pasa a `flex-wrap` centrado, con el
rótulo y el icono de ayuda en un mismo bloque. Las líneas de debajo no cambian: ya se parten por
sus espacios normales y su «número + unidad» cabe. CA1–CA3 en verde; CA4 sigue sin test.

- CA4 (tras la reescritura de Dani) → «CA4 (0102): con la ventana del CI, los valores principales
  del HOST que caben en una línea de su tarjeta siguen en una sola línea» (`e2e/views-host.spec.ts`,
  test escrito después del desarrollo, en `d4f210f`). Mide cada valor principal con las cajas reales: líneas
  (los `top` distintos de un `Range`), ancho natural (una copia sin partir) y ancho disponible (el
  contenido del padre). Exige que el de CPU quepa, y que CPU, memoria y disco estén entre los que
  caben; cada uno de los que caben, en una línea. Pasa ya, porque el código está hecho («33,5 %»:
  90,7 px de 96 px, una línea).

Verificación 2026-10-12, commit 340e775, rango integra/20261012-7..fix/0102-host-marcadores-ventana-pequena: VERDE

- check: 4216 tests (226 ficheros), cobertura ok (sentencias 92,98 %, ramas 90,13 %, funciones 90,37 %, líneas 93,75 %).
- e2e: un único pase de `test:e2e:affected` sobre el rango: 289 pasan, ninguno falla (1,5 min), con CA1 a CA4 de la 0102 en la ventana del CI. Sin `--repeat-each`: el diff no toca temporización y nada falló.

## Resultado

- Commits: `fe99a88` (tests CA1 a CA3), `9827f2a` (arreglo), `d4f210f` (test de CA4 tras la reescritura de Dani). Rango `integra/20261012-7..HEAD`.
- Ficheros principales: `src/renderer/src/pages/entities/EntityMarkers.tsx` (`BigValue`), `src/renderer/src/pages/entities/HostMarkers.tsx` (`Reclaimable`), `e2e/views/helpers.ts` (`markerLayout`, `expectMarkersInside`, `expectMarkersUnsplit`), `e2e/views-host.spec.ts` y `e2e/views-servicio.spec.ts`.
- Rondas de revisión: 1 (aprobado). Verifier en verde. ADR nuevo: ninguno. Sin migraciones.
- Pruebas a mano para Dani: además de lo anterior, mirar las demás páginas de entidad con la ventana estrecha (el cambio de `BigValue` también deja partir valores como «1 h 20 min» entre palabras).
