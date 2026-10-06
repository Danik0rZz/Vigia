---
id: '0003'
titulo: Página de análisis de la entidad desde el detalle de una evidencia (en construcción, una por tipo)
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0003-pagina-analisis-entidad
adrs: [2, 4]
adr_nuevo:
api: ninguna (usa el `entityId.id` y `entityId.type` que ya trae la evidencia; sin peticiones nuevas)
migracion: no
rondas_revision: 0
---

## Petición original

"Cuando se haga click y se despliegue la información del evento del problema, quiero un botón que
te lleve a una página nueva de análisis de esa entidad. Hay que tener en cuenta que hay diferente
tipo de entidades. Host, service, browser monitor, http, process… unos cuantos. Hay que crear una
página por cada entidad (de momento, página en construcción)."

## Especificación

**Botón.** En la fila desplegada de la tabla de evidencias del detalle del problema
(`src/renderer/src/components/EvidenceSection.tsx`), un botón **«Analizar entidad»** cuando la
evidencia tiene entidad (`view.entity` no nulo, con `id` y `type`). Va en todos los tipos de
evidencia con entidad (EVENT, METRIC, TRANSACTIONAL…), no solo en EVENT. Motivo: en la tabla
todas las filas se presentan igual y la entidad es la misma pieza en todas; limitarlo a EVENT
dejaría filas con entidad sin el botón. Sin entidad, o sin tipo, no hay botón. Dani aprobó la
ficha con el botón en todas las evidencias con entidad y la lista de 9 tipos de abajo
(2026-10-06).

**Ruta.** `#/entities/:entityType/:entityId` (los dos segmentos con `encodeURIComponent`: los
tipos personalizados llevan `:`). Es una página dentro de la app, no una sección del menú
(`NAV_SECTIONS` no cambia), igual que `problems/:problemId`. El tipo va en la ruta y no se deduce
del prefijo del id.

**Una página por tipo.** Un registro `tipo → componente` (por ejemplo
`src/renderer/src/pages/entities/`), con una página propia para cada tipo estándar de esta lista:

| Tipo de Dynatrace        | Nombre en la interfaz (es / en)  |
| ------------------------ | -------------------------------- |
| `HOST`                   | Host                             |
| `SERVICE`                | Servicio / Service               |
| `PROCESS_GROUP_INSTANCE` | Proceso / Process                |
| `PROCESS_GROUP`          | Process group                    |
| `SYNTHETIC_TEST`         | Browser monitor                  |
| `HTTP_CHECK`             | HTTP monitor                     |
| `APPLICATION`            | Aplicación web / Web application |
| `CLOUD_APPLICATION`      | Cloud application                |
| `ENVIRONMENT`            | Entorno / Environment            |

La lista sale de los tipos de entidad afectada observados en vivo (`docs/notas-api-v2.md`,
Problemas) más `PROCESS_GROUP`, que Dani nombra ("process") y que es el padre de
`PROCESS_GROUP_INSTANCE`. Los nombres propios de Dynatrace (Host, Process group, Browser monitor,
HTTP monitor, Cloud application) se escriben igual en los dos idiomas, como pide
`docs/glosario.md`; el doc-writer los añade al glosario, que hoy no los tiene. Añadir un tipo más después es una entrada en el registro y sus
textos.

**Cualquier otro tipo** (estándar no listado, personalizado o de extensión) va a una **página
genérica** que enseña el tipo tal cual llega (es un dato en tiempo de ejecución, no va al
repositorio). Nunca a la página de "no existe".

**Contenido de cada página (de momento, en construcción):**

- Cabecera (`PageHeader`) con el nombre de la entidad como título y, debajo, el nombre del tipo
  (o el código, en la genérica) y el id.
- Un bloque «Página en construcción» con el faro (`Lighthouse`, que ya respeta reducir el
  movimiento) y un texto corto que dice que el análisis de este tipo de entidad llegará más
  adelante. Cada página por tipo tiene su propio `data-testid` (`entity-page-<tipo en
minúsculas>`; la genérica, `entity-page-generic`) para que el contenido futuro de cada una se
  pueda construir y probar por separado.
- Botón **«Volver»**: si se llegó desde el detalle del problema (estado de navegación, como
  `ProblemDetailLocationState`), vuelve atrás en el historial; si no (se abrió la ruta
  directamente), va a Problemas.
- El nombre de la entidad viaja en el estado de navegación. Sin él (ruta abierta directamente o
  recargada sin estado), el título es el id. No se pide nada a Dynatrace para resolverlo.

**Sin peticiones nuevas.** La página no llama a la API ni necesita `entities.read`. Al volver al
problema, la fila sigue desplegada (estado de la tabla de evidencias) y no se vuelve a pedir el
detalle (ADR-0004).

Textos nuevos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): al desplegar una evidencia con entidad sale «Analizar entidad»; en una evidencia sin
  entidad, no.
- CA2 (e2e): pulsar «Analizar entidad» en una evidencia de tipo `HOST` lleva a
  `#/entities/HOST/<id>`, con `entity-page-host`, el nombre de la entidad como título, «Host»
  como tipo, el id y el bloque «Página en construcción».
- CA3 (unitario): el registro tiene una página propia para cada uno de los 9 tipos de la tabla,
  distinta de la genérica, y cada una tiene el nombre de su tipo en es y en.
- CA4 (unitario de componente o e2e): un tipo que no está en el registro (estándar inventado y
  uno con forma de tipo personalizado, `algo:otro`) muestra `entity-page-generic` con el código
  del tipo tal cual; nunca la página de "no existe".
- CA5 (unitario): la ruta codifica y decodifica bien un tipo con `:` y un id con caracteres
  especiales (ida y vuelta iguales).
- CA6 (e2e): «Volver» desde la página de entidad regresa al detalle del problema con la misma
  fila desplegada, y el simulador no recibe una petición nueva del detalle.
- CA7 (e2e): con la ruta abierta directamente (sin estado), el título es el id y «Volver» lleva a
  Problemas.
- CA8 (e2e): mientras está en la página de entidad, el simulador no recibe ninguna petición nueva.
- CA9 (e2e): el botón y «Volver» son alcanzables con Tab y se activan con Enter; dentro del
  detalle desplegado, Escape sigue plegando la fila.
- CA10 (unitario): los textos nuevos existen en es y en (test de paridad de `check`).

## Pruebas a mano para Dani

- Con problemas reales, que «Analizar entidad» sale en las evidencias con entidad y lleva a la
  página del tipo correcto (y a la genérica en los tipos personalizados o de extensión).

## Fuera de alcance

- El contenido real del análisis de cada tipo: sin definir. Cada página tendrá su ficha cuando
  Dani diga qué debe enseñar (probablemente con la Vista de Entidades, propuesta 1, y el scope
  `entities.read`).
- Llamadas a la API para la entidad (nombre, propiedades, relaciones).
- Entrada en el menú o una lista de entidades.
- El botón en otros sitios (lista de Problemas, entidades afectadas o causa raíz del detalle,
  Eventos, Métricas).
- Cambios en la descripción del evento (ficha 0002).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
