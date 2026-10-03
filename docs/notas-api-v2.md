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
- **Límites:** `now-30d`, `now-90d` y `now-1y` responden sin error con `pageSize` 1.
- **Tiempos:** mediana de unos 350 ms y máximo por debajo de 600 ms en las 15 peticiones.

### `GET /problems/{problemId}`

- Con `fields=evidenceDetails,impactAnalysis,recentComments` llegan las tres partes.
  `linkedProblemInfo` no aparece si no hay problema vinculado (es opcional en el esquema).
- En la muestra, la evidencia era de tipo `EVENT`, `impactAnalysis.impacts` venía vacío y no había
  comentarios: el detalle tiene que mostrar bien las partes vacías ("Ninguno").
- La respuesta valida con `problemDetailSchema`.
- Un id inexistente da **404** (`NOT_FOUND`).

## b) Entities y entityTypes

_OpenAPI._ Pendiente de la prueba en vivo.

### `GET /entityTypes`

### `GET /entities`

## c) Metrics

_OpenAPI._ Pendiente de la prueba en vivo.

### `GET /metrics`

### `GET /metrics/query`

## d) SLOs

_OpenAPI._ Pendiente de la prueba en vivo.

### `GET /slo`

## e) Events y eventTypes

_OpenAPI._ Pendiente de la prueba en vivo.

### `GET /eventTypes`

### `GET /events`

## f) Settings 2.0 (solo lectura)

_OpenAPI._ Solo si sobra tiempo.

## Propuestas

Funciones que la exploración hace posibles y que decide Dani. No se implementa ninguna interfaz
nueva sin su visto bueno.

- ~~Problems: mostrar `warnings`~~ y ~~error 400 propio (`BAD_REQUEST`)~~: correcciones técnicas,
  ya hechas (las decidió senior).
- **Problems por clúster de Kubernetes:** decidido por peticiones. Columna "Clúster" y filtro local
  (sin agrupar).
