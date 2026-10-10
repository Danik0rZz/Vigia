# Notas de la Environment API v2

Cómo se comporta de verdad la API v2 clásica (`<url>/api/v2`) frente a lo que dice su OpenAPI
(`..\API\Dynatrace Environment APIv2\APIv2.json`). Las observaciones salen de `npm run test:live`
contra el tenant de pruebas.

**Aquí solo van comportamientos.** Nunca URLs, IDs, nombres de entidades, etiquetas ni ningún otro
dato del tenant. Los ejemplos usan valores inventados (`svc-falso`, `HOST-0000000000000001`…).

**Solo tipos estándar de Dynatrace** (`SERVICE`, `HOST`, `PROCESS_GROUP`…). Los tipos de entidad
personalizados o de extensión (con prefijos como `empresa:…` o `custom:…`), las métricas
personalizadas (`calc:`, `ext:`, `log:` con nombres propios) y los SLOs y eventTypes
personalizados pueden identificar al cliente: aquí se describe su forma y se cuentan como "tipos
personalizados (N)", nunca su nombre. El informe local de las pruebas tampoco guarda esos nombres.

Estado de cada sección: _OpenAPI_ (solo lo que dice la spec, sin comprobar) o _Observado_ (con la
fecha de la prueba en vivo).

## Reglas comunes

- **Solo lectura en las pruebas en vivo:** GET y `POST /apiTokens/lookup`. El cliente de
  `test:live` rechaza cualquier otro método antes de llegar a la red (`LIVE_READ_ONLY`).
- **Ritmo:** peticiones en serie, como mucho una cada 334 ms (3 por segundo), respetando
  `Retry-After` de los 429.
- **Parámetros siempre explícitos** (`from`, `to` si aplica y `pageSize`): los valores por defecto
  cambian de un endpoint a otro (tabla siguiente) y cambian lo que se ve.
- **Paginación:** la página siguiente se pide con `nextPageKey` y **sin el resto de parámetros**.
  La única excepción es `/problems`, que repite `fields` (si no, la página 2 llega sin las partes
  pedidas). En el código, cada endpoint lo declara en `DT_ENDPOINTS`
  (`src/shared/dt-endpoints.ts`, `keepOnNextPage`) y `paginate` lo exige.

### Valores por defecto según la OpenAPI

| Endpoint             | `from` por defecto | `pageSize` por defecto | Máximo / notas                                | Repite en la página 2 |
| -------------------- | ------------------ | ---------------------- | --------------------------------------------- | --------------------- |
| `GET /problems`      | `now-2h`           | 50                     | `entitySelector` ≤ 2000 caracteres            | `fields`              |
| `GET /entities`      | `now-3d`           | 50                     | Exige `entitySelector` (type, entityId o tag) | nada                  |
| `GET /entityTypes`   | —                  | 50                     |                                               | nada                  |
| `GET /metrics`       | —                  | 100                    |                                               | nada                  |
| `GET /metrics/query` | `now-2h`           | —                      | 120 puntos por serie si no se da `resolution` | (no pagina)           |
| `GET /slo`           | `now-2w`           | 10                     | Con `evaluate=true`, `pageSize` ≤ 25; es caro | nada                  |
| `GET /events`        | `now-2h`           | 100                    | `entitySelector` ≤ 2000 caracteres            | nada                  |
| `GET /eventTypes`    | —                  | 100                    |                                               | nada                  |

### Scopes

| Endpoint                     | Token clásico (`Api-Token`) | OAuth (SSO)                     |
| ---------------------------- | --------------------------- | ------------------------------- |
| `/problems`                  | `problems.read`             | `environment-api:problems:read` |
| `/entities`, `/entityTypes`  | `entities.read`             | `environment-api:entities:read` |
| `/metrics`, `/metrics/query` | `metrics.read`              | `environment-api:metrics:read`  |
| `/slo`                       | `slo.read`                  | `environment-api:slo:read`      |
| `/events`, `/eventTypes`     | `events.read`               | `environment-api:events:read`   |
| `/settings/objects`          | `settings.read`             | `settings:objects:read`         |

La OpenAPI no lista los scopes del token clásico (solo `Api-Token`). Los de esta tabla se comprueban
con el lookup del token en la primera prueba en vivo. Un 403 se anota como "falta el scope X", no
como un fallo.

### `POST /apiTokens/lookup`

_Observado (2026-10-04)._ Prueba: `src/main/dynatrace/token-lookup.live.test.ts`.

- **Cuerpo:** `{ "token": "<token>" }`. No necesita scope. Es la única petición no GET que permite
  la guarda de `test:live`.
- **Respuesta (esquema `ApiToken`):** `id`, `name` y `owner` (string), `enabled` y
  `personalAccessToken` (boolean), `creationDate`, `expirationDate`, `lastUsedDate` y
  `lastUsedIpAddress` (string, fechas ISO) y `scopes` (array de string).
- **Diferencias con la OpenAPI:** no llegaron `modifiedDate` ni `additionalMetadata`, que la spec
  declara. La spec no marca ningún campo como obligatorio, así que Vigía los trata todos como
  opcionales (`connection-test.ts` solo usa `name`, `enabled`, `expirationDate` y `scopes`).
- **Datos personales:** `owner` y `lastUsedIpAddress` identifican a una persona y una IP. Vigía no
  los pide ni los guarda, y el informe de la prueba solo registra los tipos.
- **Tiempo:** una sola petición, por debajo de un segundo.

### Scopes del token de pruebas

- Tiene `problems.read`, `entities.read`, `metrics.read`, `slo.read`, `events.read` y
  `settings.read`: **se pueden explorar los seis bloques** (a-f).
- **También tiene scopes de escritura e instalación** en casi todas las APIs (`*.write`,
  `events.ingest`, `hub.install`…). Por eso la guarda de `test:live` es la única barrera y
  nunca se relaja: solo GET al tenant y el POST exacto del lookup.
- **Scopes mínimos para las pruebas en vivo** (recomendados para un token de solo lectura):
  `problems.read`, `entities.read`, `metrics.read`, `slo.read`, `events.read` y `settings.read`.
  El lookup no necesita scope. Vigía, como app, usa `problems.read`, `metrics.read` y `slo.read`.

## Plantilla de cada endpoint

Cada endpoint se documenta con los mismos apartados:

- **Parámetros por defecto:** qué pasa si no se envían (y qué envía Vigía).
- **Paginación:** tamaño real de página, `nextPageKey`, `totalCount`, qué se repite.
- **Campos opcionales o vacíos observados:** qué falta o llega vacío, y con qué frecuencia.
- **Diferencias con la OpenAPI:** enums con valores nuevos, campos que no están en la spec, tipos
  distintos.
- **Límites:** errores al pasarse (rango, `pageSize`, longitud del selector).
- **Tiempos medios:** mediana de las peticiones de la prueba.

## a) Problems

_Observado (2026-10-04)._ Prueba: `src/main/modules/problems-explore.live.test.ts` (15 lecturas).
Las proporciones están redondeadas al 5 % y salen de una muestra de 7 días: describen este tenant,
no la API en general.

### `GET /problems`

- **Parámetros por defecto:** sin `from`, la API usa `now-2h`, y sin `pageSize`, 50 (OpenAPI).
  Vigía siempre envía el rango de la vista y `pageSize` 100 (hasta 5 páginas).
- **Orden (según la OpenAPI):** parámetro `sort`, lista separada por comas con prefijo `+`
  (ascendente, el de por defecto) o `-`: `status` (`+` abiertos primero), `startTime` (`-` los
  más recientes primero) y `relevance`, que solo vale junto a la búsqueda `text(…)`. Vigía pide
  `sort=-startTime` desde la 0.9.0: si la lista se recorta, lo que falta es lo más antiguo.
  _Observado (2026-10-04, `problems-detail.live.test.ts`):_ la página 1 llega ordenada, la página 2
  pedida solo con `nextPageKey` sigue el mismo orden y un campo de orden que no existe da **400**.
- **Respuesta:** `problems`, `totalCount` (número, también en la página 2), `pageSize`,
  `nextPageKey` y **`warnings`**, que la OpenAPI declara y Vigía todavía no muestra.
- **Paginación:**
  - Con `pageSize` 2 llegan exactamente 2 elementos.
  - Página 2 con `nextPageKey` y el mismo `fields` → trae las partes pedidas (`evidenceDetails`).
  - Página 2 solo con `nextPageKey` → **no** las trae: hay que repetir `fields`.
  - Página 2 con `nextPageKey` **y otro parámetro** (`from`) → **400**. Confirma la regla de
    `DT_ENDPOINTS` (solo se repite `fields`).
- **Campos vacíos o ausentes** (en la lista, sin `fields`):
  - Siempre presentes: `problemId`, `displayId`, `title`, `status`, `severityLevel`,
    `impactLevel`, `startTime`, `endTime`, `affectedEntities` e `impactedEntities`.
  - `endTime` es `-1` en todos los abiertos.
  - A menudo vacíos: `managementZones` (casi siempre), `rootCauseEntity` y
    `k8s.namespace.name` (en la mayoría), `entityTags` y `problemFilters` (en una parte).
  - Nunca vienen sin `fields`: `evidenceDetails`, `impactAnalysis` y `recentComments`. Tampoco
    `linkedProblemInfo`.
- **Diferencias con la OpenAPI:**
  - Llegan campos que no declara: `k8s.cluster.name` y `k8s.cluster.uid`. Los esquemas son
    tolerantes (`looseObject`), así que no rompen nada.
  - Valores observados de `severityLevel`: `AVAILABILITY`, `CUSTOM_ALERT`, `ERROR`,
    `PERFORMANCE` y `RESOURCE_CONTENTION`, todos de la OpenAPI. Los de `impactLevel` son los
    cuatro de la OpenAPI.
  - Tipos de entidad afectada: `APPLICATION`, `CLOUD_APPLICATION`, `ENVIRONMENT`, `HOST`,
    `HTTP_CHECK`, `PROCESS_GROUP_INSTANCE`, `SERVICE` y `SYNTHETIC_TEST`.
  - Ningún elemento de la muestra falla con `problemSchema`.
- **Selectores:**
  - Funcionan `status("open")`, `severityLevel("ERROR","AVAILABILITY")`, `text("a")` y
    `entitySelector=type("SERVICE")`.
  - Un `problemSelector` mal formado da **400**. Vigía lo muestra como `BAD_REQUEST`, con el
    mensaje de Dynatrace.
  - **No hay criterio de clúster:** `problemSelector=k8s.cluster.name("…")` da 400 y la OpenAPI no
    lo declara. El filtro de clúster de Problemas es local, sobre lo cargado.
- **Problemas de una entidad (ficha 0007, observado 2026-10-07,
  `problems-entity-count.live.test.ts`, 14 lecturas):**
  `problemSelector=affectedEntities("<id>"),status("open")` (o `status("closed")`) responde 200
  en una muestra de 3 entidades de tipos distintos (servicio, monitor sintético y aplicación en la
  nube). Con `pageSize=1` llega `totalCount` y la página trae como mucho un problema. El
  `totalCount` coincide con contar la lista completa con el mismo selector y con filtrar a mano la
  lista del rango (estado y entidad afectada). Los criterios separados por comas se combinan con
  AND. Los ids de las entidades afectadas cumplen `^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$`.
- **Límites:** `now-30d`, `now-90d` y `now-1y` responden sin error con `pageSize` 1.
- **Tiempos:** mediana de unos 350 ms y máximo por debajo de 600 ms en las 15 peticiones.

### `GET /problems/{problemId}`

- Con `fields=evidenceDetails,impactAnalysis,recentComments` llegan las tres partes.
  `linkedProblemInfo` no aparece si no hay problema vinculado (es opcional en el esquema).
- En la muestra, la evidencia era de tipo `EVENT`, `impactAnalysis.impacts` venía vacío y no había
  comentarios. Desde la 0.9.0 la página de detalle no pinta las secciones vacías.
- La respuesta valida con `problemDetailSchema`.
- Un id inexistente da **404** (`NOT_FOUND`); la página lo dice con su propio mensaje.
- _Observado en la 0.9.0 (2026-10-04, `problems-detail.live.test.ts`), uno abierto y uno
  cerrado:_ los dos validan y `parseItems` no descarta ninguna evidencia, impacto ni comentario.
  Pocas evidencias (menos de 10), todas `EVENT`; sin impactos ni comentarios, así que
  `estimatedAffectedUsers` no se ha visto en vivo. Los `problemId` llevan `-` y `_`, y con
  `encodeURIComponent` en la ruta funcionan. No había ningún problema con más de 50 evidencias
  entre los primeros 6: el "Ver todas" y la exportación de cientos de evidencias solo se han
  probado con el simulador de los e2e.
- **Desde la 0.9.1** el detalle pide solo `fields=evidenceDetails,recentComments` (sin
  `impactAnalysis`). Según la OpenAPI, las evidencias son de 5 tipos (`EVENT`, `METRIC`,
  `TRANSACTIONAL`, `MAINTENANCE_WINDOW` y `AVAILABILITY_EVIDENCE`) con `displayName`, `entity`,
  `groupingEntity`, `rootCauseRelevant` y `startTime` comunes; `METRIC` y `TRANSACTIONAL` traen
  `unit` y `valueBefore/AfterChangePoint`, y `METRIC`, además, `metricId`. `endTime` es `-1` en
  un `EVENT` activo y `null` en un `METRIC` abierto. `evidenceDetails.totalCount` y
  `recentComments.totalCount` dicen cuántas hay en total.
- _Observado en la 0.9.1 (2026-10-04, `problems-detail.live.test.ts`, 3 abiertos y 3
  cerrados):_ solo llegaron evidencias `EVENT`, todas con `data.properties`, con `endTime` `-1`
  (activas) o un número, sin `groupingEntity` y ninguna con `rootCauseRelevant`. `METRIC` y
  `TRANSACTIONAL`: **según la OpenAPI; sin observar en vivo (en las pruebas solo llegaron
  EVENT)**. Sus unidades, `displayName` y valores de antes y después solo se han probado con el
  simulador; queda como prueba manual para Dani. La API no recortó ninguna lista
  (`totalCount` igual a lo recibido) y no había comentarios.

### Eventos con `dt.event.metric_selector` (0.9.2)

_Observado (2026-10-04, `problems-event-metric.live.test.ts`, 10 detalles, 13 peticiones):_

- **La clave `dt.event.metric_selector` NO está en la OpenAPI:** es una propiedad observada y
  opcional. Viene en `evidenceDetails.details[].data.properties[]` como `{ key, value }`, con
  `value` de texto; en ningún otro sitio de `data`. La traía en torno a un 10 % de las evidencias
  `EVENT` de la muestra.
- **Longitud:** hasta unos cientos de caracteres (ninguno pasó de 500). Por eso no puede salir del
  recorte de `properties` (8 propiedades de 300 caracteres): el selector se extrae aparte.
- **Claves estándar que la acompañan** (solo nombres): `dt.event.metric_threshold` (el umbral),
  `dt.event.title`, `dt.event.description`, `dt.event.group_label`, `dt.event.impact_level`,
  `dt.event.is_rootcause_relevant`, `dt.event.timeout`, `dt.event.allow_davis_merge`,
  `dt.event.allow_frequent_issue_detection` y `dt.event.dql_query`, además de claves
  `dt.event.oa.*` propias de algunas alertas y otras que no son `dt.event.*`. No apareció ninguna
  clave de baseline, dirección ni unidad.
- **`/metrics/query` acepta el selector tal cual:** los que se probaron dieron 200 con datos y sin
  `warnings`. Ninguno tenía forma de DQL (`fetch`/`timeseries`), aunque algunos eventos traen
  también `dt.event.dql_query`.
- El selector no se copió en ninguna línea del log del cliente.

### Descripción del evento: `dt.event.description` (ficha 0001)

_Observado (2026-10-06, `problems-event-description.live.test.ts`, 10 detalles, 11 peticiones):_

- **La clave `dt.event.description` NO está en la OpenAPI como clave fija:** es una propiedad
  observada en `evidenceDetails.details[].data.properties[]`, como `{ key, value }` con `value` de
  texto.
- **Longitud:** máxima de 245 caracteres y mediana de 90. Ninguna llegaba al recorte genérico de
  300 caracteres, pero podía quedar fuera de las 8 propiedades que se mandan a la interfaz; por eso
  se extrae aparte, como `dt.event.metric_selector`.
- **Formato:** un 25 % con rasgos de Markdown, sobre todo tablas GFM compactas (`|a|b|` con fila de
  alineación `|:--|`) y escapes con barra invertida. Sin HTML en crudo.
- No salió en ninguna línea del log del cliente.
- **Tope `MAX_DESCRIPTION_LENGTH` = 5 000** (`src/shared/problem-evidence.ts`). Regla de la ficha:
  el doble de la máxima observada, redondeado hacia arriba al millar, con un mínimo de 5 000 y un
  máximo de 20 000 (el límite de `app:copyText`). El doble de 245 redondeado es 1 000, así que
  queda en el mínimo: margen de unas 20 veces sobre lo visto. Si se recorta, la interfaz lo dice.
  Cómo se pinta: ADR-0008.

### Descripciones largas y en todas las evidencias (ficha 0035)

_Observado (2026-10-09, `problems-description-everywhere.live.test.ts`, 30 días, hasta 50 detalles y el problema indicado por Dani, 51 peticiones, solo lectura):_

- **Dónde llega:** `dt.event.description` solo vino en evidencias `EVENT` (también había `METRIC`,
  `TRANSACTIONAL` y `AVAILABILITY_EVIDENCE`, sin descripción), siempre en
  `data.properties[]`. Vigía la lee igual en cualquier tipo por si llega.
- **Longitud:** mínima 27, mediana 162 y máxima **4 096**, también en el problema indicado. Que la
  máxima sea justo 4 096 apunta a un tope de Dynatrace en el valor de la propiedad: la descripción
  puede llegar ya cortada de origen sin que Vigía lo sepa.
- **Rasgos:** títulos, listas, negrita, marcas ✓, código en línea, bloques `yaml`, tablas, líneas
  horizontales y enlaces. Sin HTML en crudo, citas, avisos de GitHub ni `==resaltado==`.
- **Otras claves:** en los `EVENT` hay propiedades con «description» en la clave (no `dt.*`) que
  también traen Markdown. Vigía las pinta como Markdown en su propia sección (`extraDescriptions`,
  hasta 4 por evidencia).
- **Tope `MAX_DESCRIPTION_LENGTH` = 9 000** (4 096 × 2 = 8 192, redondeado al millar, regla de la
  0001), antes 5 000.

### Estado propio de los eventos (0.10.0)

_Observado (2026-10-04, `problems-event-state.live.test.ts`, 5 abiertos y 5 cerrados, 11
peticiones):_

- Todas las evidencias `EVENT` traen `data` (el `Event` de la OpenAPI) con `eventId`,
  `eventType`, `title`, `status`, `startTime`, `endTime`, `entityId`, `entityTags`,
  `managementZones`, `properties`, `correlationId`, `frequentEvent`, `suppressProblem`,
  `suppressAlert` y `underMaintenance`.
- **`data.status`** (`OPEN` o `CLOSED`, según la OpenAPI) cuadró siempre con el `endTime` de la
  evidencia (`-1` en los abiertos, un número en los cerrados); `data.endTime` tiene las mismas
  formas. Si algún día no cuadran, Vigía hace caso a `data.status`.
- **`data.entityTags`:** una lista de `{ context, key, value?, stringRepresentation }`; `value`
  falta en los tags de solo clave. Vigía muestra `stringRepresentation` y, si falta, `key:value`
  o `key`.
- **Flags** (`underMaintenance`, `frequentEvent`, `suppressProblem`, `suppressAlert`): booleanos;
  ninguno a `true` en la muestra.
- `data.title` fue igual al `displayName` de la evidencia en todos los casos.
- No hubo ningún problema cerrado con eventos abiertos ni abierto con eventos cerrados en la
  muestra; la tabla no lo supone (cada fila usa su propio estado).

### `GET /problems/{problemId}/comments`

- **Parámetros (OpenAPI):** solo `problemId`, `nextPageKey` y `pageSize` (máximo 500, 10 por
  defecto). **No tiene `fields`:** el texto de `nextPageKey` ("except the optional fields
  parameter") es el genérico de todos los endpoints. Por eso su descriptor
  (`problemCommentsEndpoint`) no repite nada en la página 2.
- **Respuesta (observado):** `comments`, `pageSize` y `totalCount`; `nextPageKey` solo si hay
  más páginas. Cada comentario, según la OpenAPI: `id`, `authorName`, `content`, `context` y
  `createdAtTimestamp`, y solo este último es obligatorio.
- _Observado (2026-10-04):_ con un `fields` inventado en la primera página responde igual
  (lo ignora). La página 2: **según la OpenAPI (solo `nextPageKey`); sin observar en vivo**, porque
  no había ningún problema con 2 comentarios o más en la muestra.

### Problemas de una entidad: `GET /problems` con `affectedEntities` (ficha 0010, observado en vivo, solo lectura)

Muestra: tres entidades (un SERVICE, un ENVIRONMENT y una PROCESS_GROUP_INSTANCE), con rango.

- **Consulta:** `problemSelector=affectedEntities("<id>")` más `from`, `to`, `pageSize=100` y
  `sort=-startTime` da 200, con `totalCount` y sin elementos fuera del esquema.
- **Orden:** `-startTime` devuelve de más nuevo a más antiguo.
- **Entidades afectadas:** todos los problemas devueltos incluyen la entidad pedida.
- **`endTime`:** en los problemas abiertos llega **`-1`** (ninguno `null` en la muestra), así que la
  app lo normaliza a `null`. En los cerrados, `endTime` no es anterior a `startTime`.
- Sin `status` en el selector la lista trae abiertos y cerrados a la vez.

## b) Entities y entityTypes

_Observado (2026-10-04)._ Prueba: `src/main/modules/entities-explore.live.test.ts` (11 lecturas).
Tipos explorados: `SERVICE`, `HOST`, `PROCESS_GROUP`, `APPLICATION` y `KUBERNETES_CLUSTER`.

### `GET /entityTypes`

- **Respuesta:** `types`, `totalCount` y `pageSize`. Cada tipo trae `type`, `displayName`, `dimensionKey`, `entityLimitExceeded`, `properties`,
  `tags`, `managementZones`, `fromRelationships` y `toRelationships` (la definición del tipo, no
  sus entidades).
- **Tipos personalizados o de extensión:** son la mayoría de la lista en este tenant (tipos
  personalizados, sin nombrarlos aquí). Una interfaz de entidades tendría que separarlos de los
  estándar.
- **Paginación:** según la OpenAPI (`DT_ENDPOINTS.entityTypes`), la página 2 se pide solo con
  `nextPageKey`. No comprobado en vivo: en la prueba no hubo página 2.

### `GET /entities`

- **`entitySelector` obligatorio:** sin él, **400** (`BAD_REQUEST`); mal formado, también 400.
- **Parámetros por defecto:** `from` = `now-3d` y `pageSize` = 50. La prueba los manda siempre.
- **`fields`:** `+properties,+tags,+managementZones,+fromRelationships,+toRelationships` añade
  esas partes a cada entidad, que siempre trae `entityId`, `displayName` y `type`.
- **Paginación (confirmada en vivo):**
  - Página 2 solo con `nextPageKey` → OK.
  - Página 2 con `nextPageKey` **y `fields`** → **400**. A diferencia de `/problems`, aquí no se
    repite nada (`DT_ENDPOINTS.entities.keepOnNextPage = []`).
  - Las partes pedidas con `fields` se mantienen en la página 2 aunque solo se envíen en la
    primera: la página 2 pedida solo con `nextPageKey` trae `properties` (observado).
  - `nextPageKey` solo aparece cuando hay más páginas.
- **Campos vacíos (con `fields`):** `displayName` y `properties` siempre llegan. `managementZones`
  está vacío casi siempre. `tags` varía mucho según el tipo. Las relaciones suelen venir, salvo en
  una parte de los servicios y las aplicaciones.
- **`properties`:** un objeto con claves propias de cada tipo (la definición está en
  `GET /entityTypes/{type}`). Las claves que aparecen dependen de la tecnología y la nube de cada
  entorno, así que aquí no se listan.
- **Relaciones:** objetos cuyas claves son el nombre de la relación (`runsOn`, `calls`,
  `isInstanceOf`, `isClusterOfService`…) y cuyos valores son listas de `{ id, type }`.
- **Tiempos:** mediana de unos 380 ms y máximo por debajo de 650 ms.

### `GET /entities/{entityId}` y nombres de relaciones (ficha 0014, observado en vivo, solo lectura)

Prueba: `src/main/modules/entity-detail-explore.live.test.ts` (40 lecturas, 3 servicios, mediana
337 ms, máximo 775 ms).

- **Campos** con `fields=+properties,+tags,+managementZones,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms,+icon`:
  `displayName`, `entityId`, `type`, `firstSeenTms` y `lastSeenTms` (números, el primero no mayor que
  el segundo), `icon`, `managementZones`, `tags`, `properties`, `fromRelationships` y `toRelationships`.
- **`icon`:** objeto con solo `primaryIconType` (texto en minúsculas y guiones); sin `customIconPath`
  ni `secondaryIconType` en los vistos.
- **`tags`:** todas con `stringRepresentation` (también `context`, `key`, `source` y `value`).
- **`properties`:** de texto, de lista de texto (`serviceTechnologyTypes`, `applicationName`…), booleano
  (`isExternalService`) y `softwareTechnologies`, que es una **lista de objetos**
  `{ type, edition?, version? }` (como JSON puede pasar de 100 y de 300 caracteres).
- **Relaciones:** `{ id, type }`. `calls` (from) puede traer decenas de ids (hasta 50 en lo visto);
  las demás, entre 1 y 9. `to.calls` **puede mezclar dos tipos** en una misma relación: hay que
  agrupar por tipo antes de pedir nombres.
- **Id inexistente con formato válido:** **404** (`NOT_FOUND`).
- **Nombres de relaciones:** `GET /entities?entitySelector=entityId(...)` con el `from` por defecto
  (`now-3d`) resolvió todos los ids de 34 relaciones (de 1 a 50 ids), con `displayName`, `totalCount`
  igual al número devuelto y sin `nextPageKey`: no hace falta un `from` mayor. Ids de **tipos
  mezclados** en el selector: **400**.

## c) Metrics

_Observado (2026-10-04)._ Prueba: `src/main/modules/metrics-explore.live.test.ts` (12 lecturas).
Las consultas usan una métrica estándar (`builtin:host.cpu.usage`).

### `GET /metrics`

- **Respuesta:** `metrics`, `totalCount` y `nextPageKey`. Cada métrica trae `metricId`,
  `displayName`, `description` y `unit`. La OpenAPI declara también `warnings`, que no llegó.
- **Orden:** la primera página son todas `builtin:`. Las métricas personalizadas aparecen después
  (no se nombran aquí).
- **Paginación (confirmada en vivo):** página 2 solo con `nextPageKey` → OK; con `nextPageKey` y
  `pageSize` → **400** (`DT_ENDPOINTS.metrics.keepOnNextPage = []`).
- **Búsqueda:** `text=cpu` funciona.
- **`GET /metrics/{metricId}`:** descriptor completo: `aggregationTypes`, `defaultAggregation`,
  `dimensionDefinitions`, `entityType`, `resolutionInfSupported`, `transformations`, `unit`,
  `billable`, `dduBillable`, `created`, `lastWritten`, `tags`…

### `GET /metrics/query`

- **Respuesta:** `resolution` (la que se aplicó), `result`, `totalCount` y `nextPageKey`. Cada
  resultado trae `metricId`, `data`, **`dataPointCountRatio`** y **`dimensionCountRatio`**. Cada
  serie trae `dimensions`, `dimensionMap`, `timestamps` y `values`. En la muestra no llegó
  `warnings`.
- **Resolución:**
  - Sin `resolution` en 2 h → aplica `1m`, con unos 120 puntos por serie (la OpenAPI habla de
    "120 puntos").
  - **`1m` en 7 días → 10 081 puntos por serie, sin rebajar la resolución ni avisar.** La API
    admite consultas de este tamaño: es la interfaz la que tiene que limitar o avisar (ver
    Propuestas).
  - `1h` en 7 días → unos 170 puntos. `Inf` en 30 días → 1 punto.
  - **Devuelta frente a pedida (0.10.2):** la interfaz formatea el eje con la `resolution` que
    DEVUELVE la respuesta, no con la pedida: por la retención de Dynatrace, en rangos antiguos
    puede llegar más gruesa. En la muestra en vivo (mini gráficos de evidencias de problemas
    abiertos desde hace más de una semana, ventanas de unas 4 semanas y de 7 días) coincidió
    siempre con la pedida (`6h` y `1h`).
  - **Eje de tiempo:** en rangos de varias semanas, ECharts pone las marcas del eje a medianoche
    aunque los puntos no lo estén (`6h`). Por eso una etiqueta con solo la hora sale "00:00" en
    todas (el fallo de la 0.10.1); el eje se formatea por niveles (fecha en el cambio de día).
    Fuente: `src/main/modules/problems-long-evidence.live.test.ts`.
- **Errores:** una `resolution` no válida o un `metricSelector` mal formado dan **400**
  (`BAD_REQUEST`, con el mensaje de Dynatrace). Una métrica inexistente da **404**.
- **Valores nulos:** ninguno en la muestra (las series de la métrica estándar estaban completas).
- **Tiempos:** mediana de unos 340 ms y máximo por debajo de 1 s (la consulta de 10 081 puntos es
  la más lenta).

### Métricas de un servicio (ficha 0006, observado en vivo, solo lectura)

Muestra: 3 servicios con problemas en los últimos 7 días, con `now-2h` y `now-7d`.

- **Unidades** (`GET /metrics/{metricId}`): `builtin:service.response.server` en `MicroSecond`
  (admite `median` y `percentile`); `requestCount.server` y `errors.server.count` en `Count`;
  `errors.server.rate` en `Percent` (0–100). Las cuatro con `resolutionInfSupported: true` y
  `fold` entre sus transformaciones. La app pasa los tiempos a ms (÷ 1000).
- **Varias expresiones en una consulta:** 6 expresiones separadas por comas dan 200, un resultado
  por expresión **en el orden pedido** y los mismos `timestamps`. El `metricId` devuelto no es la
  expresión enviada (Dynatrace quita las comillas del id en el filtro): se casa por posición.
- **Filtro:** `:filter(eq("dt.entity.service",…)):splitBy("dt.entity.service")` y
  `entitySelector=entityId("…")` devuelven lo mismo (valores y resolución).
- **Resolución sin `resolution`:** `1m` en 2 h (10–150 puntos) y `1h` en 7 días (151–1000).
  Sin `null` en la muestra; los errores llegan como 0, no como hueco.
- **Totales del rango:** `:fold(sum)` = suma de los puntos de la serie. `resolution=Inf` coincide
  en 2 h pero no siempre en 7 días (diferencias de hasta ≥ 1 % en errores). Para los tiempos,
  `resolution=Inf` da la mediana o percentil reales del rango y `:fold(avg)` una media de
  medianas: valores distintos.
- **`:fold` junto con `resolution=Inf` en la misma consulta da 400.**
- **`requestCount.server` incluye las peticiones con error:** errores ≤ peticiones en cada punto y
  tasa = errores / peticiones × 100. Por eso OK = peticiones − errores.
- **Ratios de recorte:** `dataPointCountRatio` y `dimensionCountRatio` llegan siempre, entre 0 y
  0,01 en consultas normales. La OpenAPI los define como «pedido / máximo permitido» (`APIv2.json`,
  descriptor del resultado): **recortado es un ratio mayor que 1**, y 1 / ratio es la parte que
  llegó. Un ratio < 1 es lo normal. (La app usaba «< 1» y avisaba en falso.)

### Métricas de un servicio según su `serviceType` (ficha 0046, observado en vivo, solo lectura)

Muestra: censo de `type("SERVICE")` en `now-24h` y 2 servicios por tipo con
`entitySelector=type("SERVICE"),serviceType("…")` (el selector filtra bien).

- **`GET /entities/{id}`** con `fields=+properties.serviceType,+properties.webServerName,+properties.remoteEndpoint,+properties.remoteServiceName`:
  200 y `properties.serviceType` siempre; una propiedad que el servicio no tiene **no llega** (la
  clave falta, no viene a `null`).
- **Tipos vistos:** `WEB_SERVICE`, `CUSTOM_SERVICE`, `SPAN`, `EXTERNAL`, `WEB_REQUEST_SERVICE`,
  `RPC_SERVICE`, `DATABASE_SERVICE`, `UNIFIED` y `QUEUE_LISTENER_SERVICE` (no
  `BACKGROUND_ACTIVITY` ni `MESSAGING_SERVICE`).
- **Qué conjunto tiene datos:** Servidor (`*.server`) en WEB_SERVICE, CUSTOM_SERVICE, SPAN,
  WEB_REQUEST_SERVICE con `webServerName` y RPC_SERVICE sin `remote*`. Cliente (`*.client`) en
  WEB_REQUEST_SERVICE sin `webServerName`, DATABASE_SERVICE y **EXTERNAL** (sin datos de
  Servidor); el RPC_SERVICE con `remote*` tiene datos en los dos. QUEUE_LISTENER_SERVICE: solo
  `response.server` (tiempos y `:count`); `requestCount.server` y los errores, sin datos.
- **Cliente** tiene las mismas unidades que Servidor (tiempos en `MicroSecond`, recuentos `Count`,
  tasa `Percent`).
- **Unificadas** (`builtin:service.request.*_service_aggregation`): `response_time_…` en
  **`MilliSecond`** (con `median` y `percentile`), `failure_count_…` y `count_…` en `Count`.
  `response_time_…` y `count_…` tienen la dimensión `failed` (`"true"`/`"false"`): sin
  `:splitBy("dt.entity.service")` llegan dos series. Con él, el total es la suma de las dos, y
  `failure_count_…` = `count_…` con `failed=true`. **No hay métrica de tasa**: se calcula como
  fallidas / total × 100.
- Todas las expresiones del canal (con `:filter(eq("dt.entity.service",…)):splitBy("dt.entity.service")`
  tras la clave) dan 200, una serie cada una y en el orden pedido, sin `resolution` y con
  `resolution=Inf`.

### Métricas de un host (ficha 0016, observado en vivo, solo lectura)

Muestra: 3 hosts, con `now-2h` y `now-7d`. Las 11 candidatas existen. Todas con
`resolutionInfSupported: true` y `fold` entre sus transformaciones; dimensión `dt.entity.host`.

| Métrica                           | Unidad       | Por defecto | Agregaciones        | Dimensión extra               |
| --------------------------------- | ------------ | ----------- | ------------------- | ----------------------------- |
| `builtin:host.cpu.usage`          | Percent      | avg         | auto, avg, max, min |                               |
| `builtin:host.cpu.user`           | Percent      | avg         | auto, avg, max, min |                               |
| `builtin:host.cpu.system`         | Percent      | avg         | auto, avg, max, min |                               |
| `builtin:host.cpu.iowait`         | Percent      | avg         | auto, avg, max, min |                               |
| `builtin:host.cpu.load`           | Ratio        | avg         | auto, avg, max, min |                               |
| `builtin:host.mem.usage`          | Percent      | avg         | auto, avg, max, min |                               |
| `builtin:host.mem.used`           | Byte         | avg         | auto, avg, max, min |                               |
| `builtin:host.mem.total`          | Byte         | **value**   | auto, value         |                               |
| `builtin:host.mem.recl`           | Byte         | avg         | auto, avg, max, min |                               |
| `builtin:host.net.nic.trafficIn`  | BitPerSecond | avg         | auto, avg, max, min | `dt.entity.network_interface` |
| `builtin:host.net.nic.trafficOut` | BitPerSecond | avg         | auto, avg, max, min | `dt.entity.network_interface` |
| `builtin:host.disk.usedPct`       | Percent      | avg         | auto, avg, max, min | `dt.entity.disk`              |

- **Una consulta con 10 expresiones** y `entitySelector=entityId("…")` da 200, en el orden pedido y
  con los mismos `timestamps`. Resolución sin `resolution`: `1m` en 2 h y `1h` en 7 días.
- **Red y disco** llegan con una serie por interfaz o disco. `:splitBy():sum` (red) da una serie
  igual a la suma de las interfaces; `:splitBy():max` (disco), al máximo de los discos.
- **Marcadores:** `resolution=Inf` y `:fold(...)` dan 200 por separado (juntos, 400). En 7 días las
  medias difieren < 1 %; los máximos coinciden. `cpu.usage:max` con `Inf` difiere del máximo de la
  serie de medias: el máximo real sale de la consulta con `Inf`.
- **Nulos:** casi siempre 0 %; un host con 60 % en 7 días. El último punto de `now-2h` puede ser
  `null`: usada y total salen del último punto con dato.
- **`mem.used / mem.total × 100` coincide con `mem.usage`.** `user + system + iowait` **no suma el
  total de CPU** en 2 de 3 hosts (hay más componentes): el desglose no es un reparto.
- Ratios de recorte entre 0 y 0,01; ninguna respuesta con `warnings`.
- **`builtin:host.mem.recl` (ficha 0039, en vivo):** memoria recuperable, `Byte`, con datos en los hosts de muestra. La usada **no** la incluye (usada + recuperable < total), así que se apilan. Es la memoria disponible sin swap menos la libre.
- **Límite de expresiones:** el entorno acepta 11 expresiones en `metricSelector` aunque la OpenAPI dice «up to 10 metrics»; el canal respeta 10 (series en dos consultas).

### Discos y procesos de un host (ficha 0017, observado en vivo, solo lectura)

Muestra: 3 hosts, con `now-2h` y `now-7d`. Las 7 candidatas existen, todas con
`resolutionInfSupported: true`, agregaciones auto, avg, max y min, y las transformaciones `fold`,
`last`, `limit`, `sort`, `filter` y `splitBy`.

| Métrica                                   | Unidad        | Dimensiones                        |
| ----------------------------------------- | ------------- | ---------------------------------- |
| `builtin:host.disk.usedPct`               | Percent       | `dt.entity.host`, `dt.entity.disk` |
| `builtin:host.disk.used`                  | Byte          | `dt.entity.host`, `dt.entity.disk` |
| `builtin:host.disk.avail`                 | Byte          | `dt.entity.host`, `dt.entity.disk` |
| `builtin:host.disk.bytesRead`             | BytePerSecond | `dt.entity.host`, `dt.entity.disk` |
| `builtin:host.disk.bytesWritten`          | BytePerSecond | `dt.entity.host`, `dt.entity.disk` |
| `builtin:tech.generic.cpu.usage`          | Percent       | `dt.entity.process_group_instance` |
| `builtin:tech.generic.mem.workingSetSize` | Byte          | `dt.entity.process_group_instance` |

- **Procesos de un host:** solo se limitan con `entitySelector=type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<id>"))`
  (mismos procesos que `/entities` con ese selector). La dimensión del host **no existe** en las
  métricas de proceso: `:filter(eq("dt.entity.host",…))` y `entitySelector=entityId("<host>")` dan
  200 sin series.
- **Nombres:** `dimensionMap` solo trae ids; con la transformación `:names` llegan
  `dt.entity.disk.name` y `dt.entity.process_group_instance.name`, también con `resolution=Inf`.
- **`:last` con `resolution=Inf` da 400** (como `fold`): el último dato sale del último punto con
  dato de la serie. `usedPct:max` con `Inf` sí vale.
- **Tope de 1.000 series por respuesta:** con 3 expresiones por proceso, unos 333 procesos por
  host; por encima la respuesta sale recortada (`dataPointCountRatio`/`dimensionCountRatio` > 1).
  En vivo, 10–150 procesos por host y 2–9 discos.
- Con `now-2h` el último punto de las series de disco puede ser `null`; `used / (used + avail)`
  coincide con `usedPct`. `bytesRead`/`bytesWritten` pueden traer más discos que `usedPct`.

### Métricas de browser y HTTP monitor (ficha 0022, observado en vivo, solo lectura)

Muestra: 3 browser monitors y 3 HTTP monitors, con `now-24h`. `builtin:synthetic.browser.*` da 109
métricas y `builtin:synthetic.http.*` 22, en una sola página; todas admiten `resolution=Inf`.

| Papel (browser)                | Métrica                                                                                                              | Unidad      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| Disponibilidad                 | `builtin:synthetic.browser.availability.location.total`                                                              | Percent     |
| Duración                       | `builtin:synthetic.browser.totalDuration` (`:avg`, `:median`)                                                        | MilliSecond |
| Ejecuciones correctas/fallidas | `builtin:synthetic.browser.success` / `.failure`                                                                     | Count       |
| Rendimiento                    | `largestContentfulPaint.load`, `visuallyComplete.load`, `cumulativeLayoutShift.load` (sin unidad), `speedIndex.load` | MilliSecond |

| Papel (HTTP)                   | Métrica                                                                                         | Unidad      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ----------- |
| Disponibilidad                 | `builtin:synthetic.http.availability.location.total`                                            | Percent     |
| Duración                       | `builtin:synthetic.http.duration.geo` (`:avg`)                                                  | MilliSecond |
| Ejecuciones correctas/fallidas | `builtin:synthetic.http.resultStatus` con `filter(eq("Result status","SUCCESS"))` / `"FAILURE"` | Count       |
| Tiempos                        | `dns.geo`, `tcpConnectTime.geo`, `tlsHandshakeTime.geo`, `timeToFirstByte.geo`                  | MilliSecond |

- **`splitBy`:** en HTTP, todas las expresiones llevan `splitBy("dt.entity.http_check")`. En browser,
  solo `availability.location.total` lleva `splitBy("dt.entity.synthetic_test")`; `totalDuration`,
  `success`, `failure` y las de rendimiento van sin `splitBy`. Con él, `browser.duration` da de 2 a
  9 series. El simulador acepta las dos formas: cada expresión del canal tiene que ser la probada.
- **HTTP no tiene mediana de duración:** `http.duration.geo:median` da 200 pero devuelve lo mismo
  que `:avg`. En browser, `totalDuration:median` sí es distinta.
- **Disponibilidad:** `availability` dice `Count` pero sus valores son % (0 a 100); trae la
  dimensión `interpolated`. Las `.geo` y `availability.location.total` de browser van por
  `dt.entity.geolocation`; en HTTP, por `dt.entity.synthetic_location`.
- **Pasos y peticiones:** las métricas `*.event.*` (browser) y `*.request.*` (HTTP) no traen la
  dimensión del monitor; se limitan con `entitySelector=type("SYNTHETIC_TEST_STEP")` (o
  `"HTTP_CHECK_STEP"`)`,fromRelationships.isStepOf(entityId("<id>"))`. Con `:names`, `dimensionMap`
  trae los nombres.
- **Sin fallos:** `filter(eq("Result status","FAILURE"))` de un HTTP monitor sin fallos llega sin series.
- **Recuentos con `Inf`:** dan lo mismo que sumar la serie o menos del 1 % de diferencia.
- **`GET /entities/{id}`** (con `+properties`, relaciones y `+firstSeenTms`/`+lastSeenTms`).
  Claves de `properties` de SYNTHETIC_TEST: `assignedLocations`, `browserMonitorSubtype`,
  `createdBy`, `customizedName`, `detectedName`, `deviceProfile`, `isEnabled`,
  `lastExecutionTimestamp`, `lastModificationSource`, `lastModifiedBy`,
  `manuallyAssignedApplications`, `modificationTimestamp`, `steps`, `syntheticMonitorFrequency`,
  cuatro `syntheticScreenshot*Uri` y, a veces, `url`. De HTTP_CHECK: las mismas menos las de
  navegador (`browserMonitorSubtype`, `customizedName`, `deviceProfile`, capturas, `url`), más
  `httpMonitorSubtype`. Relaciones: `fromRelationships.runsOn` (SYNTHETIC_LOCATION),
  `toRelationships.isStepOf` (SYNTHETIC_TEST_STEP / HTTP_CHECK_STEP), a veces
  `fromRelationships.monitors` (APPLICATION); en HTTP, a veces `fromRelationships.calls` (SERVICE) y
  `toRelationships.isApplicationOfSyntheticTest` (APPLICATION).

### Desglose por localización y por paso (ficha 0023, observado en vivo, solo lectura)

Las 7 expresiones del canal `entities:monitorBreakdown` (disponibilidad, duración y fallidas por
localización; duración por paso o petición) se confirmaron en vivo con 200, con y sin
`resolution=Inf`. Ámbitos:

- `browser.availability`, `http.availability`, `http.duration.geo` y `http.resultStatus`: `entitySelector=entityId(...)`.
- `browser.duration` y `browser.step.duration` con `entityId(...)` **traen las series de todos los
  monitores** del entorno: hay que acotarlas con `:filter(eq("dt.entity.synthetic_test","<id>"))`.
- Las peticiones HTTP (`http.request.duration.geo`) salen vacías con el `entityId` del monitor: se
  acotan con `type("HTTP_CHECK_STEP"),fromRelationships.isStepOf(entityId(...))`.
- Con `filter(eq(...))`, el `metricId` vuelve sin las comillas del valor: se casan por posición.
- Ninguna dimensión trae número de secuencia de paso (está en `sequenceNumber` de las entidades de paso).
- Browser no tiene métrica de fallidas por localización; en HTTP, una localización sin fallos no trae serie.
- Con `:names`, `dimensionMap` trae el nombre de localización y de paso; las series de cada métrica
  no llegan en el mismo orden: se casan por id.

### Métricas de un proceso (ficha 0027, observado en vivo, solo lectura)

Canal `entities:processMetrics`, con `entitySelector=entityId("<PROCESS_GROUP_INSTANCE>")`. Series
sin `resolution` (`10m` con `now-24h`) y marcadores con `resolution=Inf`. Todas las expresiones se
confirmaron con 200, `metricId` igual a la expresión y ratios < 0,01.

| Papel          | Métrica (prefijo `builtin:tech.generic.` salvo `pgi`) | Unidad        | Marcador (Inf) |
| -------------- | ----------------------------------------------------- | ------------- | -------------- |
| CPU            | `cpu.usage`                                           | Percent       | `:avg`, `:max` |
| Memoria        | `mem.workingSetSize`                                  | Byte          | `:avg`, `:max` |
| Red (entrada)  | `network.bytesRx`                                     | BytePerSecond | `:avg`         |
| Red (salida)   | `network.bytesTx`                                     | BytePerSecond | `:avg`         |
| Salud de red   | `network.packets.retransmission`                      | Percent       | sin marcador   |
| Disponibilidad | `builtin:pgi.availability`                            | Percent       | `:avg`         |
| Recursos       | `handles.fileDescriptorsPercentUsed`                  | Percent       | `:max`         |

- Red y salud de red no tenían datos en las 3 muestras, pero sí en otras instancias del entorno;
  entraron por decisión del Orquestador. Un proceso sin datos de un papel llega con series vacías,
  no con `null` (el `null` es de los marcadores sin valor).
- Las cinco métricas `tech.generic.*` usadas (`cpu.usage`, `mem.workingSetSize`, `network.bytesRx`, `network.bytesTx`, `network.packets.retransmission`) llevan la dimensión `dt.entity.process_group_instance`; se deduce de la exploración de la 0027 (una serie con `entityId(<PGI>)`) y es la del filtro de «Abrir en Métricas» (0028).
- `network.packets.retransmissionIn`/`Out` y `network.sessions.connectivity` no admiten
  `resolution=Inf` (400). Varias métricas de red (`packets.reRx`, `sessions.new`…) van por
  `dt.entity.host` o `dt.entity.network_interface`, no por el proceso; sus variantes `…Aggr` sí.
- `handles.fileDescriptorsPercentUsed.new` y `mem.usage.new` no tienen dimensiones: con
  `entityId(...)` devuelven más de 1000 series de otros procesos. No se usan.
- `fileDescriptorsPercentUsed` dice Percent pero los valores observados están en [0, 1]: se mira al
  pintar (0028).
- Entidad: `metadata` de `properties` es una lista de `{key, value}`. **`COMMAND_LINE_ARGS` y
  `EXE_PATH` llegan ahí** (la línea de comandos puede llevar contraseñas): no se enseñan (0029).
  Otras claves: `EXE_NAME`, `OSAGENT_*` y `KUBERNETES_*`. Relaciones: `fromRelationships.isInstanceOf`
  (PROCESS_GROUP), `isProcessOf` (HOST), a veces `toRelationships.isHostGroupOf` y, en contenedores,
  `isPgiOfCgi` e `isMainPgiOfCgi`.

### Métricas de un process group (ficha 0031, observado en vivo, solo lectura)

3 grupos con 2 a 4 instancias, `now-24h`.

- `builtin:tech.generic.cpu.usage`, `mem.workingSetSize` y `network.bytesRx`/`bytesTx` solo tienen
  la dimensión `dt.entity.process_group_instance`: con `entityId("<grupo>")` no llega ninguna serie.
- Selector que funciona:
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<id>"))`. En `/entities`
  da las mismas instancias que `toRelationships.isInstanceOf` desde el grupo.
- Total del grupo: `:splitBy():sum` (punto a punto, la suma de las instancias). `:splitBy()` y
  `:splitBy():avg` dan la media de las instancias, no el total. Con `resolution=Inf`, la media del
  total queda a menos del 1 % de la media de la suma; ninguna expresión con `Inf` da el máximo de la
  suma, así que el máximo se saca de la serie.
- Por instancia: `:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names`
  trae en `dimensionMap` el nombre de la instancia, `dt.entity.host` y `dt.entity.host.name`. Sin
  `:parents` solo llega el nombre de la instancia. No hace falta `/entities`.
- Límite: la consulta de marcadores da 4 + 2·N series y `/metrics/query` corta en 1000, así que desde
  unas 498 instancias la respuesta llega recortada (el canal lo avisa en `partial`).
- Dos de los tres grupos no traían red: sin series en esas métricas.

### Las instancias de más CPU de un process group (ficha 0050, observado en vivo, solo lectura)

3 grupos de 51 a 150 instancias, `now-24h`.

- `<CPU por instancia>:sort(value(avg,descending)):limit(20)` (la expresión por instancia de la
  0031 seguida de `:sort` y `:limit`) funciona con `resolution=Inf`: 200, `metricId` igual a la
  expresión y las 20 de más CPU de más a menos, las mismas y en el mismo orden que ordenar la lista
  completa. También vale con `:names` detrás de `:limit`. `:limit` sin `:sort` da unas cualesquiera
  (la lista sin `:sort` no viene ordenada) y `ascending` invierte el orden.
- La memoria de esas 20 no sale de una expresión ordenada por CPU: se pide la memoria de todas en la
  misma consulta (4 totales + CPU de las 20 + memoria, 6 expresiones) y se casa por id. Filtrarla
  aparte con `:filter(or(eq("dt.entity.process_group_instance","<id>"),…))` da los mismos valores,
  pero es una petición más. Así, la consulta de marcadores da 4 + 20 + N series: cabe hasta unas
  976 instancias.
- `GET /entities` con el selector de las instancias del grupo y `pageSize=1` da `totalCount`, igual
  al número de instancias de la lista y al de series de CPU cuando no hay recorte.
- Tope: `dimensionCountRatio` deduce un máximo de 100000 por métrica, que no es el de 1000 series de
  la respuesta. Con grupos de 150 instancias como mucho no se pudo comprobar dónde corta la lista
  completa (por cálculo, 2·N ≤ 1000: unas 500 instancias) ni si `:limit(20)` elige las de más CPU
  entre todas cuando el grupo pasa del tope.

### Métricas de una aplicación web (ficha 0033, observado en vivo, solo lectura)

3 aplicaciones, `now-24h`. Catálogo `builtin:apps.web.*`: 89 métricas. Las de la aplicación tienen la
dimensión `dt.entity.application`; las `action.*`, solo `dt.entity.application_method` (más
navegador, tipo de usuario o geolocalización).

| Papel      | Métrica (prefijo `builtin:apps.web.`)       | Unidad      | Expresión del canal             |
| ---------- | ------------------------------------------- | ----------- | ------------------------------- |
| Apdex      | `apdex.userType`                            | Unspecified | `:splitBy():avg`                |
| Acciones   | `actionCount.summary`                       | Count       | `:splitBy():sum`                |
| Duración   | `visuallyComplete.load.browser`             | MilliSecond | `:splitBy():avg`                |
| Errores    | `countOfErrors`                             | Count       | `:splitBy():sum`                |
| Sesiones   | `startedSessions`                           | Count       | `:splitBy():sum`                |
| Por acción | `action.duration.{load,xhr,custom}.browser` | MilliSecond | `:count` y `:avg`, con `:names` |

- Series con `entitySelector=entityId("<id>")` y sin `resolution`; totales con `resolution=Inf`. Los
  totales de recuentos quedan a menos del 1 % de la suma de la serie; en Apdex y duración son la media
  ponderada.
- Por acción hace falta el selector
  `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("<id>"))`; con el
  `entityId` de la aplicación no llega nada. `isApplicationMethodOf` no está en las OpenAPI, pero es
  una relación (no un parámetro) y se confirmó en vivo.
- Las `action.*` parecen ser solo de las acciones clave (key user actions): 2 de 3 aplicaciones no
  traían ninguna en 24 h aunque tienen de 2 a 9 entidades `APPLICATION_METHOD`. La lista vacía es
  frecuente y la vista (0034) debe contemplarla.
- `:sort(value(count,descending)):limit(10)` por tipo (`load`, `xhr`, `custom`): las dos expresiones del
  mismo tipo traen las mismas acciones en el mismo orden y ninguna acción sale en dos tipos. El orden
  del `:sort` está por confirmar con más de 10 acciones por tipo (no se ha visto con más de una).
- Entidad: `properties` con `applicationInjectionType`, `applicationType`, `customizedName`,
  `detectedName` y, a veces, `applicationMatchTarget`, `ruleAppliedMatchType` y `ruleAppliedPattern`.
  Relaciones: `calls` (SERVICE), `isApplicationOfSyntheticTest` (HTTP_CHECK), `isApplicationMethodOf`,
  `isGroupOf` (APPLICATION_METHOD_GROUP) y `monitors` (SYNTHETIC_TEST, HTTP_CHECK).
- «Abrir en Métricas» de la página de la aplicación (ficha 0034) filtra con
  `:filter(eq("dt.entity.application","<id>")):splitBy()`. La dimensión es la del catálogo de la 0033 y
  la forma `:filter(eq(...))` equivale a `entityId(...)` en vivo (0006, 0023), pero este filtro es
  deducido: no se ha probado en vivo.

### RUM de una aplicación web (ficha 0052, observado en vivo, solo lectura)

3 aplicaciones, `now-24h`, solo API clásica (`GET /metrics/{metricId}` y `GET /metrics/query`; nada
de Grail ni DQL). Todas las candidatas existen, admiten `resolution=Inf` y tienen la dimensión
`dt.entity.application`. Canal `entities:applicationRum`.

| Papel               | Expresión del canal (prefijo `builtin:apps.web.`)                                                                          | Unidad                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Acciones por tipo   | `actionCount.{load,xhr,custom}.browser:splitBy():sum`                                                                      | Count                   |
| Duración por tipo   | `actionDuration.{load,xhr,custom}.browser:splitBy():avg`                                                                   | MilliSecond             |
| Errores por tipo    | `countOfErrors:splitBy("Error type"):sum`                                                                                  | Count                   |
| Acciones afectadas  | `percentageOfUserActionsAffectedByErrors:splitBy()`                                                                        | Percent (0 a 100)       |
| Usuarios activos    | `activeUsersEst:splitBy()`                                                                                                 | Count (estimación)      |
| Sesiones            | `startedSessions:splitBy():sum` y `endedSessions:splitBy():sum`                                                            | Count                   |
| Duración de sesión  | `sessionDuration:splitBy():avg`                                                                                            | **MicroSecond**         |
| Acciones por sesión | `actionsPerSession:splitBy():avg`                                                                                          | Count                   |
| Rebote              | `bouncedSessionRatio:splitBy()`                                                                                            | Percent (0 a 100)       |
| Core Web Vitals     | `{largestContentfulPaint.load.browser,cumulativeLayoutShift.load.browser,interactionToNextPaint}:splitBy():percentile(75)` | ms, ms; CLS Unspecified |
| Rage clicks         | `event.count.rageClick:splitBy():sum`                                                                                      | Count                   |

- Como mucho **10 expresiones por consulta** (OpenAPI v2, `metricSelector`): las 18 van en dos
  consultas de series (sin `resolution`) y dos de totales (`resolution=Inf`), en paralelo. Todas 200,
  con `metricId` igual a la expresión (también con las comillas de `"Error type"`); se casan por
  posición de todos modos.
- **Errores HTTP:** no hay métrica con «http» en el nombre. `countOfErrors` tiene `Error type`
  (valores vistos: `JavaScript` y `Request`) y `Error origin` (`First party`, `Third party`). Por
  `Error type`, los tipos suman el total en el rango y en cada intervalo, con los mismos timestamps:
  los HTTP son `Request`. `jsErrorsDuringUa` + `jsErrorsWithoutUa` es igual al tipo `JavaScript`.
  `errorCountForDavis` solo trae `Request` (y añade `Error context`): no sirve para separar.
- `activeUsersEst` con `resolution=Inf` y `:splitBy()` (igual que `:value`) es la estimación de
  usuarios distintos del rango: no es la suma ni el máximo de la serie y queda por debajo de las
  sesiones. `:avg` no sirve.
- En los porcentajes, `:splitBy()` es `:value`; `:avg` es la media sin ponderar de los tipos de
  usuario (difiere con varios). Ninguno coincide con 100 × `countOfUserActionsWithErrors` /
  `actionCount.summary`. En `sessionDuration` y `actionsPerSession`, `:splitBy()` es `:avg`.
- INP no admite `avg` (sí `percentile`): los tres Core Web Vitals van con el percentil 75.
- Sin datos en ninguna de las 3: `actionCount.custom.browser`, `actionDuration.custom.browser` y
  `event.count.rageClick` (llegan sin series). `jsErrorsDuringUa` y `jsErrorsWithoutUa`, en 2 de 3.
- En los recuentos, el total con `Inf` queda a menos del 1 % de la suma de la serie.

### Métricas de un disco (ficha 0040, observado en vivo, solo lectura)

3 discos, `now-2h`. `builtin:host.disk.*` da 16 métricas, todas con `entityType` HOST y las dimensiones `dt.entity.host` y `dt.entity.disk`.

- Son métricas **del host**: con `entitySelector=entityId("<disco>")` no llega ninguna serie (0 de 3 en las 16). Hay que acotar con `:filter(eq("dt.entity.disk","<disco>"))` en cada expresión; así las 16 traen una serie cada una y ninguna de otro disco. La agregación va detrás del filtro (`…:filter(…):max`).
- El `metricId` de la respuesta llega **sin las comillas** del valor del filtro, así que no es la expresión enviada: los resultados se casan por posición.
- Elegidas por papel: uso `usedPct`; espacio `used` y `avail`; rendimiento `bytesRead` y `bytesWritten`; latencia `readTime` y `writeTime`; cola `queueLength`; inodos `inodesAvail` (% libre).
- No todos los discos de un host traen las de E/S: `readTime` y `writeTime` suelen venir en uno solo. Latencia, cola e inodos pueden quedar `null`.
- `:last` con `resolution=Inf` da 400; el libre se saca de la serie (último punto con dato).
- Entidad `DISK`: `properties` con `detectedName` y `filesystemType`, `firstSeenTms` y `lastSeenTms`, y la relación `fromRelationships.isDiskOf` (HOST).

### Logs de los procesos de un host (ficha 0041, observado en vivo, solo lectura)

3 hosts con procesos, `now-2h`. Consulta: `GET /entities` con `entitySelector=type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))` y `fields=+properties.logFileStatus,+properties.logPathLastUpdate,+properties.logSourceState`.

- Da 200 con `fromRelationships` (plural, la de la OpenAPI) y también con `fromRelationship` (la de la captura de la interfaz), con el mismo recuento. Rango relativo y absoluto dan el mismo total; `pageSize=500` se acepta. De 10 a 150 procesos por host, una sola página.
- Las tres propiedades son de tipo `Map` y llegan como **lista de `{ key, value }`**. La `key` es la fuente del log: **una ruta de fichero** o un nombre de fuente con espacios y sin barra. Nunca se enseña.
- `logFileStatus`: `value` enum; vistos `FILE_STATUS_OK`, `FILE_STATUS_NOT_EXIST` y `FILE_STATUS_NOT_MONITORED_ANY_MORE`.
- `logPathLastUpdate`: `value` es una fecha en **segundos** desde epoch; de 1 a 9 entradas por proceso. La llevan casi todos los procesos.
- `logSourceState`: `value` es un objeto `{ storageStatus }`; visto `LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE`.
- Un proceso sin logs llega sin esas claves en `properties`.
- `GET /entities/{id}` de un proceso con `+properties` trae también las tres, con las rutas en las claves: `entity-secrets.ts` las quita enteras.

## d) SLOs

_Observado (2026-10-04)._ Prueba: `src/main/modules/slos-explore.live.test.ts` (6 lecturas, solo 2
con `evaluate=true` y `pageSize` 5). Los SLO son del cliente: aquí solo va su forma.

### `GET /slo`

- **Respuesta:** `slo`, `totalCount` y `pageSize`; `nextPageKey` solo si hay más páginas.
- **Cada SLO:** `id`, `name`, `status`, `target`, `warning`, `evaluatedPercentage`, `errorBudget`,
  `error`, `enabled`, `evaluationType`, `timeframe`, `filter`, `metricExpression`, `metricKey`,
  `metricName`, `metricNumerator`, `metricDenominator`, `metricRate`, `useRateMetric`,
  `numeratorValue`, `denominatorValue`, `burnRateMetricKey`, `errorBudgetMetricKey`,
  `normalizedErrorBudgetMetricKey` y `errorBudgetBurnRate` (objeto). Con `evaluate=true` llegan
  además **`relatedOpenProblems`** y **`relatedTotalProblems`**.
- **`relatedOpenProblems`, según la OpenAPI:** lo calcula Dynatrace con el `problemFilters` del
  SLO (generado automáticamente si el SLO no tiene filtro) y vale -1 si el cálculo falla. Inicio
  no muestra nada con un valor negativo y lo exporta como celda vacía, con una nota en la hoja Info.
- **Sin evaluar (`evaluate=false`) el estado no vale nada:** todos llegan con `status: SUCCESS`,
  `evaluatedPercentage` y `errorBudget` a -1, y a veces con un `error` distinto de `NONE`. Una
  interfaz nunca debe mostrar ese `status`. Inicio pide la lista evaluada, así que no le afecta.
- **Evaluados (`CURRENT` o `GTF` con `from`/`to`):** valores reales, `status` `SUCCESS` o
  `FAILURE` y `error` = `NONE`. `evaluationType` observado: `AGGREGATE`. Todos validan con
  `sloSchema`.
- **Límites:**
  - `evaluate=true` con `pageSize` 26 → **400**, como dice la OpenAPI (máximo 25). Vigía pide 25
    por página y como mucho 4 páginas.
  - Un `timeFrame` no válido da **404** (no 400): Vigía siempre manda `CURRENT` o `GTF`.
- **Paginación:** según la OpenAPI (`DT_ENDPOINTS.slo`), la página 2 se pide solo con
  `nextPageKey`. No comprobado en vivo.
- **`GET /slo/{id}`:** misma forma que un elemento de la lista evaluada (con `timeFrame`, `from` y
  `to`).
- **Tiempos:** mediana de unos 380 ms; las evaluadas, por debajo de 0,5 s con `pageSize` 5.

## e) Events y eventTypes

_Observado (2026-10-04)._ Prueba: `src/main/modules/events-explore.live.test.ts` (6 lecturas). Ni
títulos, ni propiedades, ni entidades de los eventos: son datos del cliente.

### `GET /eventTypes`

- **Respuesta:** `eventTypeInfos` (no `eventTypes`), `totalCount` y `pageSize`. Cada tipo trae
  `type`, `displayName`, `description` y `severityLevel`.
- Es el catálogo de Dynatrace: todos los tipos de la muestra son estándar (de `AVAILABILITY_EVENT`,
  `ERROR_EVENT`, `PERFORMANCE_EVENT`, `RESOURCE_CONTENTION_EVENT`, `CUSTOM_ALERT`, `CUSTOM_INFO`…
  a los de infraestructura: `OSI_*`, `PGI_*`, `ESXI_*`, `RDS_*`, `HTTP_CHECK_*`, `SYNTHETIC_*`).
- **Paginación:** según la OpenAPI (`DT_ENDPOINTS.eventTypes`), solo `nextPageKey`. No comprobado
  en vivo.

### `GET /events`

- **Parámetros por defecto:** `from` = `now-2h` y `pageSize` = 100 (máximo 1000, según la
  OpenAPI; `test:live` no pasa de 500). La prueba manda `from=now-24h` y `pageSize=100`.
- **Respuesta:** `events`, `totalCount`, `pageSize`, `nextPageKey` y `warnings`.
- **Cada evento:** `eventId`, `eventType`, `title`, `status` (`OPEN` o `CLOSED`), `startTime`,
  `endTime` (-1 en los abiertos), `entityId` (objeto `{ entityId, name }`; `name` no siempre
  llega), `entityTags`, `managementZones`, `properties` (lista de `{ key, value }`),
  `correlationId`, `frequentEvent`, `suppressAlert`, `suppressProblem` y `underMaintenance`.
- **Paginación (confirmada en vivo):** página 2 solo con `nextPageKey` → OK; con `nextPageKey` y
  `from` → **400** (`DT_ENDPOINTS.events.keepOnNextPage = []`).
- **Relación con los problemas (observado):** todos los eventos de la muestra traen
  `correlationId`, pero **no coincide con el `problemId`** de ningún problema de las mismas 24 h.
  No es un enlace directo al problema.
- **El enlace evento→problema, según la OpenAPI (`EventEvidence`):** las evidencias de tipo `EVENT`
  del detalle del problema (`evidenceDetails`) traen `eventId` y el evento completo en `data`. No
  hace falta ninguna petición nueva: el detalle ya las pide. No comprobado en vivo. El filtro
  `correlationId(…)` existe, pero la OpenAPI no lo relaciona con los problemas.
- **Errores:** un `eventSelector` mal formado da **400**.
- **Tiempos:** mediana de unos 330 ms y máximo por debajo de 0,5 s.
- **Eventos de un host y de lo que corre en él (ficha 0042, paso 0 en vivo):** `eventSelector=entityId("<host>","<id-2>",…)` con ids de tipos mezclados da 200 y trae los mismos eventos que una consulta por tipo con `entitySelector` y relaciones (6 o 7 peticiones). El límite es de **longitud del selector, no de número de ids**: unos 9.900 caracteres dan 200 y desde unos 10.485, **400**; un host puede tener más de 200 ids relacionados, así que se reparte en varias consultas. Relaciones del HOST: procesos `to:isProcessOf`, discos `to:isDiskOf`, interfaces `to:isNetworkInterfaceOf`, grupos de contenedores `to:isCgiOfHost`, **nodo de Kubernetes `to:isNodeOfHost`** y máquina virtual `from:runsOn`. El HOST **no tiene relación con `OS_SERVICE`**. La respuesta llega ordenada por `startTime` descendente. El `optionalEntitySelector` de la interfaz de Dynatrace no está en la OpenAPI y no se usa.

## f) Settings 2.0 (solo lectura)

_Observado (2026-10-04)._ Prueba: `src/main/modules/settings-explore.live.test.ts` (6 lecturas,
solo GET). Los objetos pueden llevar valores sensibles (webhooks, credenciales, cabeceras): aquí
no va ningún `value`, y la prueba pide `fields=objectId,schemaId,scope` salvo en una petición de un
solo objeto, de la que solo mira el tipo de `value`.

### `GET /settings/schemas`

- **Respuesta:** `items` y `totalCount`, sin paginar (llegan todos). Cada esquema trae
  `schemaId`, `displayName` y `latestSchemaVersion` (la OpenAPI declara más campos, como
  `multiObject` u `ordered`, que no llegaron).
- **Con un token clásico con `settings.read`, la lista es reducida:** solo aparece una parte
  pequeña de los esquemas `builtin:`. Los clásicos (`builtin:anomaly-detection.*`,
  `builtin:management-zones`, `builtin:host.monitoring`…) no aparecen. Es probable que dependa de
  los permisos del token sobre cada esquema (sin confirmar). Una función de Settings tendría que
  partir de lo que este listado devuelve, no de una lista fija.

### `GET /settings/objects`

- **Sin `schemaIds` ni `scopes` → 400**, como dice la OpenAPI.
- **Respuesta:** `items`, `totalCount`, `pageSize` y `nextPageKey`.
- **`fields`:** con `fields=objectId,schemaId,scope` llegan exactamente esos tres y **no llega
  `value`**. Es la forma de listar objetos sin traer secretos por la red.
- **`value`:** es un objeto (tipo de nivel superior); su forma depende del esquema.
- **Paginación (confirmada en vivo):** página 2 solo con `nextPageKey` → OK; con `nextPageKey` y
  `fields` → **400**. Igual que el resto de endpoints salvo `/problems`.
- **Tiempos:** mediana de unos 400 ms; `/settings/schemas` es la más lenta (por debajo de 1 s).

## Propuestas

Funciones que la exploración hace posibles y que decide Dani. No se implementa ninguna interfaz
nueva sin su visto bueno.

- ~~Problems: mostrar `warnings`~~ y ~~error 400 propio (`BAD_REQUEST`)~~: correcciones técnicas,
  ya hechas (las decidió senior).
- **Problems por clúster de Kubernetes:** decidido por peticiones. Columna "Clúster" y filtro local
  (sin agrupar).
- **Métricas: resolución y avisos (mejora del módulo existente, AUD-13).** Mostrar la `resolution`
  aplicada, los `warnings` (con ApiWarnings) y los `dataPointCountRatio` y `dimensionCountRatio`
  cuando son menores que 1 (resultado recortado). Y, como la API no rebaja la resolución, avisar o
  proponer una más gruesa cuando una consulta pase de unos miles de puntos por serie.
- **SLOs en Inicio (mejora del módulo existente).** Mostrar `relatedOpenProblems` (problemas
  abiertos relacionados con el SLO, que ya llega con la evaluación, sin peticiones nuevas) y
  distinguir el estado `WARNING` (la API lo da: valor entre `warning` y `target`). Hoy Inicio pinta
  `WARNING` con el mismo color que `FAILURE`. Y, si se pide algún día la lista sin evaluar (por
  ejemplo, para un listado barato), no mostrar su `status`.
- **Eventos de un problema (bloque e).** En el detalle de Problemas, una sección con los eventos
  del problema (los de `evidenceDetails` de tipo `EVENT`, que ya llegan con el evento completo),
  sin interfaz nueva de Events. Se decide con Dani.
- **Settings 2.0 (bloque f).** Con este token solo se ven unos pocos esquemas: antes de cualquier
  función de Settings hay que saber qué permisos necesita el token para ver los clásicos. Los
  listados, siempre con `fields` sin `value`.
- **Vista de Entidades (bloque b).** Un explorador por tipo (lista de tipos estándar y, aparte, los
  personalizados), con la tabla de entidades del tipo elegido, su `properties` y sus relaciones
  navegables (de un servicio a su host o a su process group). Necesita `entities.read`. No se
  implementa sin el visto bueno de Dani.
