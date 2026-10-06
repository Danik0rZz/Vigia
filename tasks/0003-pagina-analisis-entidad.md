---
id: '0003'
titulo: Página de análisis de la entidad desde el detalle de una evidencia (en construcción, una por tipo)
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
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

Tests escritos en `9becbc9` (test-writer, antes del código).

Nombres que fijan los tests (la ficha no los daba):

- Registro: `src/renderer/src/pages/entities/registry.ts` exporta `ENTITY_PAGES` (objeto
  `tipo → { Page, labelKey }`, con `labelKey` una clave de `common`, con o sin prefijo
  `common:`), `GenericEntityPage` y `entityPageFor(type)` (la página del tipo o, si no está en
  el registro, `GenericEntityPage`; también para claves del prototipo como `constructor` o
  `__proto__`).
- Ruta: `src/renderer/src/app/entity-route.ts` exporta `entityPath(type, id)`, que devuelve
  `/entities/<encodeURIComponent(type)>/<encodeURIComponent(id)>`; la ruta está en
  `buildRoutes` con los params `entityType` y `entityId`.
- `data-testid`: botón `evidence-analyze-entity` (dentro de `evidence-detail`); en la página,
  `entity-page-<tipo en minúsculas>` o `entity-page-generic`, `entity-page-type`,
  `entity-page-id`, `entity-under-construction` (con el `lighthouse` dentro) y `entity-back`;
  el título es el `h1` de la página.
- Simulador de `views.spec.ts`: `sim.requests` guarda cada petición («MÉTODO /ruta»).

Criterio → test (e2e en `e2e/views.spec.ts`, fixture P-786 `pd-entity`: EVENT sobre HOST,
METRIC sobre SERVICE, EVENT sin entidad y EVENT con entidad sin tipo):

- CA1: e2e `CA1 (0003)`: botón en EVENT/HOST y METRIC/SERVICE; ni en la sin entidad ni en la sin
  tipo.
- CA2: e2e `CA2 (0003)`: ruta `/entities/HOST/HOST-AN1`, `entity-page-host`, `h1` con el
  nombre, «Host», el id y «Página en construcción» con el faro.
- CA3: `src/renderer/src/pages/entities/registry.test.ts`, `CA3 (0003)`: los 9 tipos con
  página propia, distinta de la genérica y distintas entre sí, y su nombre exacto en es y en.
- CA4: e2e `CA4 (0003)` (`TIPO_ESTANDAR_INVENTADO` y `algo:otro` por URL:
  `entity-page-generic` con el código tal cual, sin `error-screen`) y unitario `CA4 (0003)`
  en `registry.test.ts` (`entityPageFor` → `GenericEntityPage`).
- CA5: `src/renderer/src/app/entity-route.test.ts`, `CA5 (0003)`: `entityPath` codifica y
  `matchRoutes(buildRoutes(...))` devuelve el tipo y el id de partida (`:`, `/`, `%`, `#`,
  `?`, `&`, espacios y tildes).
- CA6: e2e `CA6 (0003)`: «Volver» → `/problems/pd-entity` con la fila desplegada y sin más
  `GET /problems/{id}`.
- CA7: e2e `CA7 (0003)`: por URL desde Inicio, `h1` = id y «Volver» → `/problems`.
- CA8: e2e `CA8 (0003)`: ninguna petición al simulador en 1,5 s en la página (desde el botón y por
  URL, genérica y SERVICE).
- CA9: e2e `CA9 (0003)`: Tab hasta el botón, Escape pliega y devuelve el foco a la fila; Enter
  activa el botón; Tab hasta «Volver» y Enter vuelve al problema con la fila desplegada.
- CA10: `registry.test.ts`, `CA10 (0003)`: «Analizar entidad», «Página en construcción» y los 9
  nombres existen en es y en (traducidos). La paridad completa la cubre `locales.test.ts`.
- Ejecución: `npx vitest run src/renderer/src/app/entity-route.test.ts
src/renderer/src/pages/entities/registry.test.ts`: los 2 ficheros fallan al importar
  (`./entity-route` y `./registry` no existen). `npm run test:e2e -- e2e/views.spec.ts -g
"0003"`: 7 fallan, todos por no encontrar `evidence-analyze-entity` o `entity-page-*` (el
  problema P-786 y sus filas cargan y se despliegan).

## Resultado

(pendiente)
