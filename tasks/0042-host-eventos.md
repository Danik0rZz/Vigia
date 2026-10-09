---
id: '0042'
titulo: 'HOST: tarjeta «Eventos» con los eventos del host y de lo que corre en él (scope events.read)'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host-2
depende_de: ['0036']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0042-host-eventos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /events` (`eventSelector` con `entityId("id-1","id-2")`, `entitySelector`, `from`, `to`, `pageSize`); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `events.read` (token clásico) y `environment-api:events:read` (OAuth), de la OpenAPI. El `optionalEntitySelector` de la captura de Dani **no está en la OpenAPI** (es la interfaz interna de Dynatrace, `/rest/v2/events`) y no se usa.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host-2» (0039 a 0042). Dani (2026-10-09): "También añadir un apartado de eventos para host."
Capturó la consulta de la interfaz de Dynatrace: eventos del host y de las entidades relacionadas
con él (nodo de Kubernetes, procesos, servicios del sistema, grupos de contenedores, máquinas
virtuales de nube, interfaces de red y discos), con `pageSize=10`. (La URL del tenant y el id del
host no se copian aquí.)

## Especificación

**API pública.** Esa consulta usa un parámetro interno. Con la API pública (`GET /api/v2/events`) se
propone:

- `eventSelector=entityId("<host>","<id-2>",…)`: la OpenAPI admite varios ids en ese criterio
  ("ID of related entity"). Los ids salen de las relaciones del host que ya trae `entities:get`
  (0014): procesos (`isProcessOf`), discos (`isDiskOf`), interfaces de red
  (`isNetworkInterfaceOf`), grupos de contenedores (`isCgiOfHost`), nodo de Kubernetes y la máquina
  virtual en la que corre (`runsOn`), más el propio host. Hasta el límite de longitud del selector.
- **Paso 0 (en vivo, solo lectura):** que esa forma da 200 con ids de tipos mezclados, que trae lo
  mismo que una consulta por tipo con `entitySelector` y relaciones
  (`type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))`…), cuántos
  ids caben y la forma de un evento (`eventType`, `title`, `startTime`, `endTime`, `status`,
  `entityId`, `properties`). Se elige la que funcione con menos peticiones y se anota.

**Scope.** `MODULE_SCOPES` gana `events` con `events.read` y `environment-api:events:read` (de la
OpenAPI). «Probar conexión» lo comprueba; sin él, la tarjeta enseña el aviso del scope.

**Canal `entities:hostEvents`** (Zod): entrada `environmentId`, `entityId` (`^HOST-…`) y
`timeRange`; salida: los 20 eventos más recientes del rango con `eventType`, `title`, `status`,
`startTime`, `endTime` y la entidad (`id`, `name`, `type`), más `totalCount`. Errores con `reason`;
simulador.

**Tarjeta «Eventos»** en la página del host, antes de «Información»: lista con tipo (en una
píldora), título, entidad (enlace a su página si tiene tipo con página), inicio, fin o «Activo» y
estado; «20 de N» si hay más. Los títulos son texto del tenant: como texto, nunca HTML.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice qué forma de consulta funciona, cuántos ids caben y la
  forma de los eventos, sin ids, nombres ni títulos. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): `MODULE_SCOPES.events` y su entrada en los scopes requeridos.
- CA3 (unitario, main): «Probar conexión» sin `events.read` lo da como scope que falta.
- CA4 (unitario, main): la consulta lleva el selector con el host y sus relacionados (o la forma
  elegida) y el rango; la salida trae 20 como mucho, ordenados del más reciente.
- CA5 (e2e): la página del host del simulador enseña la tarjeta con sus eventos y enlaces; sin el
  scope, el aviso; con el canal caído, aviso con Reintentar.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Añadir `events.read` al token y comprobar que los eventos del host cuadran con Dynatrace.

## Fuera de alcance

- Una vista de Eventos general (propuesta 2 del BACKLOG) y eventos en otras páginas de entidad.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

**Paso 0 (en vivo, solo lectura, 2026-10-09; `src/main/modules/host-events-explore.live.test.ts`):**
el token de pruebas **tiene `events.read`**. 3 hosts de `type("HOST")` con eventos en `now-24h`, 42
peticiones GET (mediana unos 340 ms), token fuera del log. Informe en
`live-reports/host-events-explore.json` (ignorado), sin ids, nombres ni títulos.

- **Forma A (la de la ficha) funciona:** `eventSelector=entityId("<host>","<id-2>",…)` con ids de
  tipos mezclados da 200 y trae **exactamente los mismos eventos** (mismo `totalCount` y mismos
  `eventId`) que la forma B: una consulta por tipo con `entitySelector` y la relación
  (`type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))`…) más
  `entityId("<host>")`, que necesita 6 o 7 peticiones. Ningún evento de una entidad que no se
  pidiera. **Se elige A:** `GET /entities/{host}` (relaciones) y un `GET /events`.
- **Cuántos ids caben:** el límite es de longitud, no de número: 250 ids (9.898 caracteres de
  selector) dieron 200; 250 ids más largos (10.485) y 300 (11.998) dieron **400**. Los hosts de la
  muestra tenían de 20 a más de 200 ids relacionados (casi todos procesos): no siempre caben con
  holgura, así que el canal **reparte los ids en varias consultas** si hace falta.
- **Relaciones del host** (`GET /entityTypes/HOST` y los hosts de la muestra): procesos
  `to:isProcessOf`, discos `to:isDiskOf`, interfaces `to:isNetworkInterfaceOf`, grupos de
  contenedores `to:isCgiOfHost`, **nodo de Kubernetes `to:isNodeOfHost`** (no `runsOn`, como decía
  la ficha) y máquina virtual `from:runsOn` (`EC2_INSTANCE`, `AZURE_VM`…). `to:runsOn` es el
  `PROCESS_GROUP`. El tipo HOST **no tiene relación con servicios del sistema** (`OS_SERVICE`): los
  «servicios del sistema» de la captura no se pueden sacar de sus relaciones.
- **Forma de un evento:** `eventId`, `eventType`, `title`, `status`, `startTime`, `endTime`
  (número), `entityId` = `{ entityId: { id, type }, name }` (el nombre llegó siempre),
  `entityTags`, `managementZones`, `properties`, `correlationId` y los cuatro booleanos. La
  respuesta llega **ordenada por `startTime` descendente**; `pageSize=20` trae 20 con su
  `totalCount` y `nextPageKey`. Rango absoluto (`from`/`to` ISO): mismo total que el relativo.
  `endTime` de los activos: -1 según `docs/notas-api-v2.md` (en esta muestra no hubo activos).
- El `optionalEntitySelector` de la captura no se ha usado (no está en la OpenAPI).

**Decisiones del test-writer (delegadas por Dani, conservadoras y refinables):**

- **Ids que entran:** el host y sus relaciones `to:isProcessOf`, `to:isDiskOf`,
  `to:isNetworkInterfaceOf`, `to:isCgiOfHost`, `to:isNodeOfHost` y `from:runsOn`, sin repetir. No
  entran `to:runsOn` (el process group: ya están sus instancias), `to:runsOnHost` (servicios),
  `from:isInstanceOf` (grupo de hosts), `isNetworkClientOfHost`, `isSiteOf` ni las demás. Un id de
  relación sin forma de id de Dynatrace no llega al selector.
- **Reparto:** cada `eventSelector` por debajo de 9.800 caracteres (el fetch falso del unitario da
  400 por encima); con 450 procesos, entre 2 y 4 consultas, cada id una vez; se juntan y se queda
  con los 20 más recientes; `totalCount` es la suma. Con todo en una consulta: exactamente 2
  peticiones (`GET /entities/{host}` con `+fromRelationships,+toRelationships` y `GET /events`).
  `pageSize` entre 20 y 1000; sin `entitySelector` ni `optionalEntitySelector`.
- **Salida de `entities:hostEvents`:** `{ events, totalCount }`; cada evento con `eventType`,
  `title` (tal cual: lo pinta la interfaz como texto), `status`, `startTime`, `endTime` (**null si
  está activo**: -1, `null` o ausente) y `entity: { id, name, type }` (`name` null si no llega).
  Salen ordenados del más reciente al más antiguo aunque la respuesta llegue desordenada.
- **Scope en la interfaz:** la tarjeta pide `events.read` y, como el canal lee las relaciones del
  host, también `entities.read`: sin cualquiera de los dos, el aviso con el que falte (y no se
  pide nada). `MODULE_SCOPES.events` lleva solo `events.read` (la ficha).
- **Textos** en `entities.host.events`: `title` («Eventos»), `summary` (con `shown` y `count`:
  contiene «20 de 31»), `active` («Activo»), `empty`, `status.OPEN` y `status.CLOSED`.
- **Testids:** `host-events` (antes de `host-info`), `host-events-summary`, `host-event-row` (del
  más reciente al más antiguo) con `host-event-type` (la píldora), `host-event-title`,
  `host-event-entity` (enlace si el tipo está en `ENTITY_PAGES`; texto si no, como la EC2),
  `host-event-start`, `host-event-end` («Activo» en los activos) y `host-event-status` con
  `data-status`. Sin scope, `module-unavailable` dentro de la tarjeta. El e2e usa la página de
  `HOST_INFO_FULL_ID` (la de la 0020, con relaciones).
- **Tests existentes:** los tokens del simulador de `views` y `tls` llevan ahora `events.read`;
  `TOKEN_NO_EVENTS` es el de siempre sin él. Los tests de `connection-test`, `connection` y
  `dynatrace` con listas fijas de scopes incluyen ya `events.read`.

**Tests (commit `e331d2e`):**

| Criterio | Test                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/host-events-explore.live.test.ts` › `CA1 (0042): el informe dice qué forma funciona, cuántos ids caben y la forma de los eventos…` (pasa; se salta sin `.env.live.local`)                                                                                                        |
| CA2      | `src/shared/dynatrace.test.ts` › describe `CA2 (0042)` (2 tests) y `MODULE_SCOPES` (listas con `events`)                                                                                                                                                                                           |
| CA3      | `src/main/dynatrace/connection-test.test.ts` › describe `CA3 (0042)` (clásico sin y con `events.read`; OAuth sin `environment-api:events:read`)                                                                                                                                                    |
| CA4      | `src/main/ipc/handlers/host-events.test.ts` › describes `CA4 (0042)` (selector, rango, relaciones que entran, ids raros, reparto con 450 procesos; 20 como mucho, orden, forma, activos y errores con `reason`) y `src/shared/ipc.test.ts` › `CA4 (0042): entrada y salida de entities:hostEvents` |
| CA5      | `e2e/views.spec.ts` › `CA5 (0042): la tarjeta «Eventos» del host…`, `CA5 (0042): con el canal caído…` y `CA5 (0042): sin events.read…`; `src/renderer/src/data/modules.test.ts` › describes `CA5 (0042)` (`useModuleAccess('events')`)                                                             |
| CA6      | `src/renderer/src/locales/host-events.test.ts` › describe `CA6 (0042)` (4 tests)                                                                                                                                                                                                                   |

Ejecución con el código aún sin hacer: los unitarios nuevos fallan porque no existen el canal,
`MODULE_SCOPES.events`, el módulo `events` de la interfaz ni los textos (51 fallos, todos por eso);
los tres e2e de la 0042, porque no hay tarjeta `host-events`; y `tls.spec` › «con la huella fijada
conecta», porque `events.read` sale aún como scope que Vigía no usa.

**Decisiones del developer (delegadas por Dani, conservadoras y refinables):**

- Canal en `src/main/modules/host-events.ts`: `GET /entities/{host}` solo con
  `+fromRelationships,+toRelationships`; cada `eventSelector` como mucho de 9.800 caracteres
  (`HOST_EVENTS_MAX_SELECTOR`), con `pageSize=20` por consulta (cada una trae sus 20 más recientes,
  así que entre todas están los 20 del conjunto); las consultas van en paralelo.
- Un evento sin id de entidad o sin `startTime` numérico se descarta; sin `type`, el del prefijo
  del id. Cualquier rechazo de Dynatrace (de la entidad o de los eventos) sale con
  `reason: hostEventsRejected` y su texto como detalle.
- Tarjeta (`HostEvents.tsx`) después de «Logs» y justo antes de «Información». «20 de N» solo si
  `totalCount` es mayor que lo enseñado. El `eventType` va tal cual en la píldora; un estado que no
  sea `OPEN`/`CLOSED` se enseña tal cual.
- Para saber si la entidad lleva enlace sin importar el registro de páginas (sería un ciclo de
  imports), `src/renderer/src/pages/entities/entity-page-types.ts` con `ENTITY_PAGE_TYPES`;
  `registry.ts` lo exige con `satisfies Record<EntityPageType, …>` (no compila si no coinciden).

**Tests de la ficha que el developer cree incorrectos (decide el Orquestador; no se han tocado):**

1. `src/main/ipc/handlers/host-events.test.ts` › «con muchos procesos (450)…»: el host se
   sobrescribe con `{ ...hostBody(), toRelationships: … }`, así que conserva el
   `fromRelationships.runsOn` con la EC2, que por la propia decisión del test-writer entra en la
   consulta; el test espera solo `[HOST_ID, ...many]` y falla con la EC2 de más. Arreglo propuesto:
   añadir `fromRelationships: {}` a ese host. Con el hook de pre-commit (`vitest related`) este
   fallo impide commitear el código.
2. `e2e/views.spec.ts` › «CA5 (0042): la tarjeta «Eventos» del host…»: en el e2e completo falla
   (solo pasa aislado) porque `sim.hostEventsQueries` recoge una consulta de `HOST_METRICS_ID`. La
   lanza la recarga del `finally` del test anterior («Aviso del scope (0041)»), que deja la interfaz
   en la página de ese host con Producción activo; el canal hace dos peticiones seguidas y la
   segunda llega después del `resetState` del test siguiente. Arreglo propuesto: en el test de la
   0042, quedarse con las consultas cuyo selector incluye `HOST_EVENTS_HOST` (o esperar
   `settledRequests()` y vaciar `sim.hostEventsQueries` antes de abrir la página).

Los dos los corrigió el test-writer en `b8aac1c`. Código en `fd80a9c` (canal) y `49db995`
(tarjeta). `npm run check` en verde (3053 tests) y e2e completo en verde (316).

## Resultado

(pendiente)
