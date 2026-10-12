---
id: '0102'
titulo: Marcadores del HOST que no se parten ni se salen de su caja con la ventana de 1024 px
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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
- CA4: con la ventana ancha (la del arnés por defecto), el valor de Red del HOST sigue en una sola
  línea (el arreglo no parte lo que cabe). e2e.

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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
