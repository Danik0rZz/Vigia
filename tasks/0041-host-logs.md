---
id: '0041'
titulo: 'HOST: tarjeta «Logs» con los procesos del host que tienen logs detectados'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host-2
depende_de: ['0036']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0041-host-logs
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /entities` con `entitySelector=type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))`, `fields=+properties.logFileStatus,+properties.logPathLastUpdate,+properties.logSourceState` (formato `properties.FIELD` de la OpenAPI), `from`, `to` y `pageSize`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `entities.read`.
migracion: no
rondas_revision: 1
---

## Petición original

Lote «host-2» (0039 a 0042). Dani (2026-10-09): "Sería interesante, porque veo que la UI lo
muestra, ver si tiene logs ese host." Capturó cómo lo saca la interfaz de Dynatrace: una consulta a
`entities` de los procesos del host (`type(PROCESS_GROUP_INSTANCE)` relacionados con el host por
`isProcessOf`) pidiendo las propiedades `logFileStatus`, `logPathLastUpdate` y `logSourceState`, con
`pageSize=1000` y un rango. (El id del host de su ejemplo no se copia aquí.)

## Especificación

**Paso 0 (en vivo, solo lectura):** con 3 hosts de muestra, que la consulta da 200 con la forma
documentada (`fromRelationships`, en plural; la captura usaba `fromRelationship`, y se prueba si la
API acepta las dos), qué forma tienen las tres propiedades (texto, lista u objeto; valores posibles
de estado, que son de Dynatrace y pueden ir al informe; si `logPathLastUpdate` es una fecha o lleva
rutas) y cuántos procesos tienen logs. Sin ids, nombres ni rutas.

**Canal `entities:hostLogs`** (Zod): entrada `environmentId`, `entityId` (`^HOST-…`) y `timeRange`;
main pide la consulta con el `from`/`to` del rango y `pageSize` 500 (paginando con `nextPageKey` si
hiciera falta, como manda la OpenAPI). Salida: por proceso, `id`, `name`, estado del fichero de log,
estado de la fuente y última actualización (fecha); **nunca rutas de ficheros** (pueden llevar
nombres de usuario o de cliente): si una propiedad lleva rutas, solo se cuenta cuántas.
`withLogs` y `total`. Errores con `reason`; simulador.

**Tarjeta «Logs»** en la página del host, antes de «Información»: resumen («3 de 12 procesos con
logs»), y lista de los procesos con logs: nombre (enlace a su página), estado (con texto y color) y
última actualización. Sin procesos con logs, «Sin logs detectados». Sin `entities.read`, aviso del
scope.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice si la consulta funciona, la forma de las propiedades y
  si llevan rutas, sin ids, nombres ni rutas. Se salta sin `.env.live.local`.
- CA2 (unitario, main): la consulta lleva el selector con el id del host, los `fields` y el rango.
- CA3 (unitario, main): de una respuesta con rutas en sus propiedades, la salida no contiene
  ninguna ruta.
- CA4 (e2e): la página del host del simulador enseña la tarjeta con el resumen y los procesos con
  logs; pulsar uno abre su página.
- CA5 (e2e): sin procesos con logs, «Sin logs detectados»; con el canal caído, aviso con Reintentar.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un host real con logs, que la tarjeta cuadra con lo que enseña Dynatrace.

## Fuera de alcance

- Leer las líneas de log (es DQL o la API de logs, fase 8).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Decisiones del developer

Delegadas por Dani; conservadoras y refinables.

- `entity-secrets.ts`: se quitan **las tres propiedades enteras** (`logFileStatus`,
  `logPathLastUpdate`, `logSourceState`) como claves exactas, no solo sus claves internas: sin la
  ruta, sus valores (estado o fecha en segundos) no dicen de qué fichero son, y el estado ya se ve
  en la tarjeta «Logs». No se oculta nada más con «log» en el nombre (test en
  `entity-secrets.test.ts`).
- Con varias entradas de estado en un proceso, se enseña `FILE_STATUS_OK` si alguna lo es (que se
  lea algún fichero es lo que más dice del proceso); si no, la primera válida. Igual con la fuente
  y `LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE` (`pickStatus` en
  `src/main/modules/host-logs.ts`).
- Un valor que no tiene forma de enum (`dtLogEnumSchema`: mayúsculas, cifras y `_`) sale como
  null; una fecha que no es un número positivo, también.
- `total` es el `totalCount` de la API (o los recibidos más los descartados, si no llega). Hasta 10
  páginas de 500; si se llega al tope con páginas pendientes, la salida trae `truncated: true` y la
  tarjeta avisa (`entities.host.logs.partial`). `truncated` solo llega cuando es `true`, para no
  cambiar la forma de salida que fijan los tests de la ficha (`toEqual` sin ese campo). Test en
  `src/main/ipc/handlers/host-logs-truncated.test.ts` (ronda 1 de revisión).
- Error 400 o 404 con `reason` `hostLogsRejected` (el texto de Dynatrace, como detalle).
- Tarjeta: después de las tablas de discos y procesos y antes de «Información»; sale aunque falte
  Métricas (solo depende de `entities.read`). Columnas: proceso (enlace, con «N fuentes» debajo),
  estado del fichero (verde si se lee, rojo si no existe, ámbar si ya no se monitoriza, gris sin
  estado), estado de la fuente y última actualización. Orden: la más reciente primero. Sin
  procesos con logs, «Sin logs detectados» y debajo el resumen («0 de N…»).

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Ficha] La ficha quedó corrupta en `68ee374`: una segunda copia del front matter y de la ficha
   en mitad de una decisión (probable `String.replace` de node con `` $` `` en el reemplazo), y las
   decisiones del developer dentro de «Ideas surgidas». Rehacerla desde `1d2fe40` con las
   decisiones una sola vez en su sitio.
2. [Casos límite] `modules.ts:708` ignora `page.truncated`: con más de 10 páginas de 500, la
   tarjeta diría «N de M» con N corto y sin aviso, contra el contrato de `DtClient.paginate`
   («la interfaz debe avisar»). Añadir `truncated` a la salida, una nota en la tarjeta (es y en) y
   un test que pida 10 páginas, ni una más, y dé `truncated: true`.

Bien: ninguna ruta llega a la interfaz por el canal nuevo (solo enums validados, fecha y recuento),
el log de main, los errores, `entities:get` («Todas las propiedades», claves exactas en
`HIDDEN_EXACT` sin quitar `logLevel` ni similares) ni la caché. CA2 a CA6 con su test; la
paginación sigue la OpenAPI; sin scope nuevo; ADR-0004; nada del tenant.

Opcional: `HostLogs.tsx:119` reutiliza `fromProblem: true` para «Volver», como `HostTables` y
`EntityInfoCard`; si se renombra, en todos los sitios a la vez.

## Verificación

**Paso 0 (en vivo, solo lectura, 2026-10-09; `src/main/modules/host-logs-explore.live.test.ts`):**
3 hosts de `type("HOST")` con procesos, `now-2h`, 20 peticiones GET, token fuera del log. Informe
en `live-reports/host-logs-explore.json` (ignorado), sin ids, nombres ni rutas.

- La consulta da 200 con `fromRelationships` (plural, la de la OpenAPI) y también con
  `fromRelationship` (la de la captura), con el mismo recuento; el canal usa la plural. Con rango
  relativo y absoluto (`from`/`to` ISO), mismo total; `pageSize=500` aceptado; en los 3 hosts,
  de 10 a 150 procesos y una sola página.
- `GET /entityTypes/PROCESS_GROUP_INSTANCE`: las tres propiedades son de tipo `Map`. Llegan como
  **lista de `{ key, value }`**; la `key` es la fuente del log: **una ruta de fichero** (Unix, con
  extensión) o un nombre de fuente con espacios y sin barra (el mismo en todos los procesos de un
  host). Nunca se enseña.
- `logFileStatus`: `value` enum; vistos `FILE_STATUS_OK`, `FILE_STATUS_NOT_EXIST` y
  `FILE_STATUS_NOT_MONITORED_ANY_MORE`; una entrada por proceso.
- `logPathLastUpdate`: `value` es una fecha en **segundos** desde epoch (no lleva rutas en el
  valor; sí en la clave); de 1 a 9 entradas por proceso. La tienen casi todos los procesos.
- `logSourceState`: `value` es un objeto `{ storageStatus }`; visto
  `LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE`.
- Un proceso sin logs llega sin esas claves en `properties`. En un host solo había
  `logPathLastUpdate`.
- **`GET /entities/{id}` de un proceso (`entities:get`, `+properties`) también trae las tres, con
  las rutas en las claves**: hoy «Todas las propiedades» del proceso las enseñaría. Por la regla de
  Dani, la 0041 lo cierra (test abajo).
- Sin scope nuevo: `entities.read`, el de la ficha. Nada fuera de la OpenAPI (las propiedades se
  piden con `fields=+properties.X`, documentado).

**Decisiones del test-writer (delegadas por Dani, conservadoras y refinables):**

- Salida de `entities:hostLogs`: `{ processes, withLogs, total }`. `processes` trae **solo los
  procesos con logs** (al menos una entrada en alguna de las tres propiedades), cada uno con `id`,
  `name`, `fileStatus` (enum o null), `sourceState` (el `storageStatus`, enum o null),
  `lastUpdate` (la más reciente de `logPathLastUpdate`, en **milisegundos**, o null) y
  `logCount` (fuentes de log distintas: se cuentan, nunca se enseñan). `withLogs` =
  `processes.length`; `total`, procesos del host. Un valor que no sea un enum de Dynatrace no
  sale. Con varias entradas de estado, cuál se enseña lo decide el developer (en vivo solo hubo una).
- «Proceso con logs» = alguna entrada en cualquiera de las tres. Como `logPathLastUpdate` lo tienen
  casi todos los procesos (con la fuente genérica), el resumen puede salir «N de N»: a revisar con
  Dani en la prueba a mano.
- Paginación: con `nextPageKey`, la siguiente petición lleva **solo** `nextPageKey` (OpenAPI).
- `entities:get` no saca ninguna ruta ni fuente de log de esas propiedades (cómo, lo decide el
  developer: quitar la propiedad o solo sus claves, en `entity-secrets.ts`).
- Textos en `entities.host.logs`: `title` («Logs»), `summary` (con `withLogs` y `count`, el
  total: «3 de 12 procesos con logs»), `empty` («Sin logs detectados»), `fileStatus.<enum>` (los
  tres vistos) y `fileStatus.unknown`, `sourceState.<enum>` y `sourceState.unknown`.
- Testids: `host-logs` (antes de `host-info`), `host-logs-summary`, `host-log-row` con
  `data-process-id`, el nombre como enlace, `host-log-status` con `data-status` (texto traducido y
  color distinto para OK y NOT_EXIST) y `host-log-updated`. Sin scope, `module-unavailable` dentro
  de la tarjeta.

**Tests (commit `8e46d61`):**

| Criterio | Test                                                                                                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/host-logs-explore.live.test.ts` › `CA1 (0041): el informe dice si la consulta funciona…` (pasa; se salta sin `.env.live.local`)                                                                                                                                                                                      |
| CA2      | `src/main/ipc/handlers/host-logs.test.ts` › describe `CA2 (0041)` (rangos relativo y absoluto, paginación, sin selector de la interfaz; 4 tests) y `src/shared/ipc.test.ts` › `CA2 (0041): entrada de entities:hostLogs`                                                                                                               |
| CA3      | `src/main/ipc/handlers/host-logs.test.ts` › describe `CA3 (0041)` (salida por proceso, sin rutas en la salida ni en el log, valor raro, vacíos y errores con `reason`; 7 tests) y `src/main/ipc/handlers/entity-detail.test.ts` › `CA3 (0041): entities:get de un proceso con logs no saca las rutas de log («Todas las propiedades»)` |
| CA4      | `e2e/views.spec.ts` › `CA4 (0041): la tarjeta «Logs» del host enseña el resumen y los procesos con logs, sin rutas; pulsar uno abre su página…`                                                                                                                                                                                        |
| CA5      | `e2e/views.spec.ts` › `CA5 (0041): sin procesos con logs…` y `CA5 (0041): con el canal caído…`; además `Aviso del scope (0041)`                                                                                                                                                                                                        |
| CA6      | `src/renderer/src/locales/host-logs.test.ts` › describe `CA6 (0041)` (4 tests)                                                                                                                                                                                                                                                         |

También: `entities:hostLogs` en `channel-coverage.test.ts` y en «todos los canales de módulos»
(`modules.test.ts`). Simulador del e2e: `hostLogsResponse` (solo la forma plural; 400 con otra),
`HOST_LOGS_ENTRIES` (3 de los 15 procesos de `HOST_PAGE_PROCESSES`, con rutas Unix, Windows y una
fuente sin ruta), `sim.hostLogsQueries`, `sim.hostLogsFail`, `sim.hostLogsEmpty` y la entidad
`hostLogsProcessBody` (con las mismas rutas en `properties`).

Ejecución sin el código: 31 unitarios en rojo (`canal entities:hostLogs: expected undefined`,
`implementación de entities:hostLogs: expected undefined`, textos de `entities.host.logs` sin
definir, los dos registros de canales, y `entities:get` que hoy saca la ruta del log) y los 4 e2e
de la 0041 en rojo (no existe `host-logs`). Los e2e vecinos del host y de entidades (0014 a 0020,
0028, 0029, 0032, 0036, 0037, 0039 y 0040) siguen en verde con el simulador ampliado.

## Resultado

(pendiente)
