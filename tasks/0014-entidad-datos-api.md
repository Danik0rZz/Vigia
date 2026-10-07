---
id: '0014'
titulo: 'Entidades: datos de una entidad y nombres de sus relaciones (scope entities.read)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0014-entidad-datos-api
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /entities/{entityId}` (`fields`, `from`, `to`) y `GET /entities` (`entitySelector=entityId(...)`, `fields`, `from`, `pageSize`); esquemas `Entity`, `EntityIcon` y `EntityId` de `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `entities.read` (token clásico, `x-token-scopes`) y `environment-api:entities:read` (OAuth). Comportamiento observado en `docs/notas-api-v2.md`, "b) Entities y entityTypes".
migracion: no
rondas_revision: 1
---

## Petición original

Lote «servicio-2» (0011 a 0015). Dani, sobre la página del servicio: con
`GET /api/v2/entities/<SERVICE-id>` llega información relevante (management zones,
`primaryIconType`, `fromRelationships` como runsOn, isServiceOf, isServiceOfProcessGroup, calls,
runsOnHost, runsOnProcessGroupInstance…, `toRelationships`, propiedades…). Pide:

- Hacer la llamada en vivo (solo lectura) y elegir qué cabe en una vista clara, bonita y bien
  nutrida, sin pasarse: la app es para ver las cosas de forma amigable y ágil.
- Donde haya ids de otras entidades (relaciones), poder consultarlas a demanda del usuario (no por
  defecto) para enriquecer los datos.
- Ojo: pide el scope `entities.read`, que Vigía hoy no usa; «Probar conexión» tendría que
  comprobarlo.

Esta ficha trae los datos; la vista es la 0015.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «servicio-2»:** separador de miles siempre que
el número tenga 4 cifras o más, con punto en español («9.907», no «9907»; Dani: "más elegante y
cuidado"); la información de la entidad, breve, bonita y ágil, pero con el detalle a mano.

**Lo que ya se sabe en vivo** (`entities-explore.live.test.ts`, relanzada por el Planificador el
2026-10-07, solo nombres de campo): un SERVICE trae `displayName`, `entityId`, `type`,
`properties`, `tags`, `managementZones`, `fromRelationships` y `toRelationships`; las
`managementZones` vienen vacías en la mayoría, las `fromRelationships` en una parte. Claves de
`properties` vistas en servicios: `serviceType`, `serviceTechnologyTypes`,
`softwareTechnologies`, `agentTechnologyType`, `webServerName`, `webServiceName`,
`webServiceNamespace`, `contextRoot`, `port`, `ipAddress`, `isExternalService`,
`externalDependency`, `remoteEndpoint`, `remoteServiceName`, `databaseName`, `databaseVendor`,
`databaseHostNames`, `applicationName`, `applicationEnvironment`, `applicationReleaseVersion`,
`publicCloudId`, `publicCloudRegion`, `detectedName`, `conditionalName` y otras internas
(`dt.security_context`, `matchedServiceDetectionV2Rules`, `serviceDetectionAttributes`,
`unifiedServiceIndicators`). Relaciones `from`: `calls`, `runsOn`, `runsOnHost`,
`runsOnProcessGroupInstance`, `isServiceOf`, `isServiceOfProcessGroup`,
`indirectlySendsToQueue`; `to`: `calls`, `isServiceMethodOfService`, `isClusterOfService`,
`isNamespaceOfService`, `isInstanceOf`, `isGroupOf`.

**Paso 0, exploración en vivo (solo lectura)** con `GET /entities/{entityId}` sobre 3 servicios
elegidos de los problemas de los últimos 7 días (nunca se guarda un id ni un nombre): forma del
`icon` (`primaryIconType`), `firstSeenTms`/`lastSeenTms`, forma de `properties`
(`softwareTechnologies` y `serviceTechnologyTypes`: lista de texto u objetos), tramos de número de
ids por relación, y si los ids de las relaciones se resuelven con
`GET /entities?entitySelector=entityId(...)` con el `from` por defecto (`now-3d`) o hace falta uno
mayor. Informe solo de comportamientos; lo que salga va a "Resultado" y a `docs/notas-api-v2.md`.

**Scope.** `MODULE_SCOPES` (`src/shared/dynatrace.ts`) gana el módulo `entities` con
`entities.read` (clásico) y `environment-api:entities:read` (OAuth), deducidos de la OpenAPI.
«Probar conexión» lo comprueba y avisa si falta, como con los demás. Sin el scope, la sección de la
0015 enseña el estado de "falta el scope" de `useModuleAccess` y el resto de la página sigue.

**Canal `entities:get`** (Zod en `src/shared/ipc.ts`):

- Entrada: `environmentId` y `entityId` (validado con `^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$`, como en la
  0007).
- Main pide `GET /entities/{entityId}` con
  `fields=+properties,+tags,+managementZones,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms,+icon`.
- Salida (ya preparada para la vista): `displayName`, `type`, `firstSeen`, `lastSeen`,
  `iconType` (`primaryIconType` o `null`), `managementZones` (nombres), `tags` (texto como en las
  evidencias), `properties` (todas, como `{ key, text }` con el valor convertido a texto y recortado
  a 300 caracteres, en el orden de la respuesta) y `relationships`: lista de
  `{ direction: 'from' | 'to', name, entities: [{ id, type }], total }`, con como mucho 50 ids por
  relación (`total` dice cuántas había).
- 404 → error con `reason` («la entidad no existe en este entorno»); el resto, como siempre
  (ADR-0005).

**Canal `entities:names`** (a demanda, para enriquecer las relaciones):

- Entrada: `environmentId` y `entityIds` (1 a 50, todos del mismo tipo, validados con el mismo
  patrón; el esquema rechaza tipos mezclados, porque la API lo exige).
- Main pide `GET /entities` con `entitySelector=entityId("id-1","id-2",…)`, `pageSize` 50 y el
  `from` que diga el paso 0.
- Salida: `{ names: { id, name }[], missing: string[] }` (los que la API no devuelve).
- Errores con `reason`. Sin refresco solo (ADR-0004): la clave es entorno + ids.

El simulador de los e2e responde a los dos canales con datos inventados (solo tipos estándar).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe del paso 0 sale sin ids ni nombres. Se salta sin
  `.env.live.local`.
- CA2 (unitario, shared): `MODULE_SCOPES.entities` tiene `entities.read` y
  `environment-api:entities:read`, y entran en `REQUIRED_CLASSIC_SCOPES` y `REQUIRED_OAUTH_SCOPES`.
- CA3 (unitario, main): «Probar conexión» con un token sin `entities.read` lo da como scope que
  falta.
- CA4 (unitario, main): `entities:get` pide `/entities/<id>` con esos `fields` y transforma una
  respuesta simulada: zonas por nombre, etiquetas como texto, propiedades a texto y recortadas,
  relaciones con dirección, nombre, máximo 50 ids y `total`.
- CA5 (unitario, main): un 404 acaba en error con su `reason`.
- CA6 (unitario, shared): `entities:names` rechaza 0 o más de 50 ids, ids con otro patrón y tipos
  mezclados.
- CA7 (unitario, main): `entities:names` construye `entityId("a","b")`, devuelve los nombres y
  pone en `missing` los que no vienen.
- CA8 (e2e): el simulador responde a los dos canales y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

- Añadir `entities.read` al token del entorno y que «Probar conexión» deje de avisar (y que avise
  sin él).

## Fuera de alcance

- La vista (0015).
- Una vista de Entidades con listas por tipo (propuesta 1).
- Relaciones de segundo nivel (las relaciones de una entidad relacionada).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- CA1-CA8 con su test; los ajustes del commit de tests a otros tests son solo los del scope nuevo.
- Scope contrastado con `APIv2.json` (`x-token-scopes` y `ssoAuth`); los módulos existentes piden lo
  mismo; CA3 cubre clásico y OAuth.
- Canales: Zod en las dos direcciones, id validado antes de ruta y selector, 1-50 ids, tipos mezclados
  rechazados (también por prefijo), repetidos quitados, `missing` correcto; la lectura tolerante solo
  afecta a lo opcional; 404 → `entityNotFound`. `tagText` solo se exporta. Sin datos del tenant.
- Opcionales: `entityTypeOf` sin guion recorta el último carácter (usar `requestedId` o devolver el
  texto entero); test de `useModuleAccess("entities")` en la 0015.

## Verificación

Tests escritos en `b58a0c8` (`test(entidades): criterios de la ficha 0014`). Ahora fallan porque
el código no existe (canal desconocido, `MODULE_SCOPES.entities` sin definir), no por el test.

| Criterio | Test                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/modules/entity-detail-explore.live.test.ts` › `CA1 (0014): el informe no contiene ningún id ni nombre observado` (ejecutada en vivo el 2026-10-08: pasa; informe en `live-reports/entity-detail-explore.json`, ignorado) |
| CA2      | `src/shared/dynatrace.test.ts` › `CA2 (0014): el módulo entities y sus scopes`                                                                                                                                                     |
| CA3      | `src/main/dynatrace/connection-test.test.ts` › `CA3 (0014): «Probar conexión» avisa si falta entities.read`                                                                                                                        |
| CA4      | `src/main/ipc/handlers/entity-detail.test.ts` › `CA4 (0014): entities:get pide /entities/<id> con los fields y transforma la respuesta`                                                                                            |
| CA5      | `src/main/ipc/handlers/entity-detail.test.ts` › `CA5 (0014): un 404 de entities:get acaba en error con su reason`                                                                                                                  |
| CA6      | `src/shared/ipc.test.ts` › `CA6 (0014): entrada de entities:names`                                                                                                                                                                 |
| CA7      | `src/main/ipc/handlers/entity-detail.test.ts` › `CA7 (0014): entities:names construye entityId(...), devuelve nombres y missing`                                                                                                   |
| CA8      | `e2e/views.spec.ts` › `CA8 (0014): entities:get y entities:names por IPC con ids inventados…` (simulador: `GET /api/v2/entities/{id}` y `GET /api/v2/entities`, `sim.entityInfoQueries` y `sim.entityNamesQueries`)                |

**Paso 0 en vivo (2026-10-08, 40 lecturas, mediana 337 ms, máximo 775 ms; 3 servicios de los
problemas de 7 días; solo comportamientos):**

- `GET /entities/{id}` con los `fields` de la ficha trae `displayName`, `entityId`, `type`,
  `firstSeenTms`, `lastSeenTms` (números, `firstSeen ≤ lastSeen`), `icon`, `managementZones`,
  `tags`, `properties`, `fromRelationships` y `toRelationships`.
- `icon`: objeto solo con `primaryIconType` (texto en minúsculas y guiones; sin
  `customIconPath` ni `secondaryIconType` en los vistos).
- `managementZones`: vacías en los 3. `tags`: entre 10 y 50, todas con `stringRepresentation`
  (claves `context`, `key`, `source`, `stringRepresentation`, `value`).
- `properties`: objeto de 10 a 50 claves. Texto: `serviceType`, `agentTechnologyType`,
  `conditionalName`, `detectedName`, `contextRoot`, `externalDependency`, `webServerName`,
  `remoteEndpoint`, `remoteServiceName`; lista de texto: `serviceTechnologyTypes`,
  `applicationName`, `applicationEnvironment`, `applicationReleaseVersion`; booleano:
  `isExternalService`; `softwareTechnologies`: **lista de objetos** `{ type, edition?, version? }`,
  que como JSON mide entre 101 y 300 caracteres (el resto, 100 o menos).
- Relaciones `{ id, type }`, tipos estándar. Tramos: `calls` (from) de 2 a 50 ids; `calls` (to) y
  `isGroupOf` de 1 a 9; las demás (`runsOn`, `runsOnHost`, `runsOnProcessGroupInstance`,
  `isServiceOf`, `isServiceOfProcessGroup`, `isInstanceOf`, `isClusterOfService`,
  `isNamespaceOfService`, `isServiceMethodOfService`), 1. **`to.calls` puede mezclar dos tipos**
  en una misma relación: la vista tendrá que agrupar por tipo antes de llamar a `entities:names`.
- Un id con el formato bien que no existe: **404** (`NOT_FOUND`).
- `GET /entities?entitySelector=entityId(...)` con el `from` por defecto (`now-3d`) resolvió el
  100 % de los ids en las 34 relaciones probadas (de 1 a 50 ids), con `displayName`, `totalCount`
  igual al número devuelto y sin `nextPageKey`. **No hace falta un `from` mayor.** Ids de tipos
  mezclados en el selector: **400**.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- `entities:names` no exige `from` (el paso 0 dice que el de por defecto basta).
- `firstSeen` y `lastSeen` en epoch ms (número), como las demás fechas de los canales.
- Sin `icon` ni partes opcionales: `iconType` null y `managementZones`, `tags`, `properties` y
  `relationships` como listas vacías.
- Valores de propiedades a texto: número con `String` (`8080` → `"8080"`), booleano `"true"` o
  `"false"`; listas y objetos, un texto que contenga sus valores (nunca `[object Object]`). El
  recorte deja 300 caracteres exactos.
- Con más de 50 ids, la relación se queda con los 50 primeros en el orden de la respuesta.
- El 404 lleva un `reason` propio (no `problemNotFound`) cuyo texto en español dice «entidad» y
  «no existe», con texto en inglés.
- Los dos canales van en `createModuleHandlers` (`channel-coverage.test.ts` y `modules.test.ts`
  ya los esperan ahí).
- Tests existentes ajustados al scope nuevo: `src/shared/dynatrace.test.ts`,
  `src/main/dynatrace/connection-test.test.ts`, `src/main/ipc/handlers/connection.test.ts` y los
  simuladores de `e2e/views.spec.ts` y `e2e/tls.spec.ts` (el token de prueba ya lleva
  `entities.read`). Hasta que exista el módulo, `tls.spec` › «con la huella fijada conecta» falla
  porque ve `entities.read` como extra.

**Decisiones del developer (delegadas por Dani, refinables):**

- Módulo puro en `src/main/modules/entities.ts` (con `entities.test.ts` para los casos límite); los
  dos canales van en `createModuleHandlers`. `tagText` de `problems.ts` se exporta y se reutiliza
  (el mismo texto de etiqueta que en las evidencias).
- Texto de una propiedad: listas separadas por `, ` y objetos con sus valores separados por espacio
  (`JAVA OpenJDK 17.0.2, APACHE_TOMCAT 10.1`); `null` da texto vacío; lo anidado a más de 4 niveles
  se omite. Se guardan todas las claves, también las internas (la vista decide cuáles enseña).
- La respuesta de `GET /entities/{id}` se lee de forma tolerante: una parte mal formada se ignora
  en vez de tumbar la entidad; sin `displayName` se usa el id y sin `type`, el prefijo del id; sin
  fechas, `firstSeen`/`lastSeen` null. Una relación sin ningún id válido no sale y `total` cuenta
  los ids válidos.
- `entities:names`: los ids repetidos se quitan antes de pedir y `entityIdSelector` vuelve a validar
  cada id (defensa en profundidad), aunque ya lleguen validados por Zod. Un rechazo de Dynatrace
  sin motivo lleva `entityNamesRejected` (estado y texto); el 404 de `entities:get`,
  `entityNotFound`.
- `useModuleAccess` gana el módulo `entities` (`entities.read`) para la 0015; los módulos que ya
  existían piden los mismos scopes que antes.
- Lo del paso 0 aún no está en `docs/notas-api-v2.md`: queda para el doc-writer, con "Resultado".

### Verifier, 2026-10-08, commit `b4e8ebc`, rango `main..b4e8ebc`: VERDE

- check: 2193 tests en 112 ficheros, cobertura ok.
- e2e completo (ventana del CI): 216/216.
- `-g "(0014)" --repeat-each 3 --workers=1`: 3/3.
- El intermitente que vio el developer (v0.9.0, exportación del detalle de un problema) no salió.

## Resultado

- Commits (`main..HEAD`): `b58a0c8` tests, `7d1cbb7` scope `entities.read` en `MODULE_SCOPES` y
  `useModuleAccess`, `b375440` canales `entities:get` y `entities:names` en el contrato IPC,
  `f3717fa` implementación en main.
- Ficheros principales: `src/shared/dynatrace.ts`, `src/shared/ipc.ts`, `src/shared/modules.ts`,
  `src/main/modules/entities.ts`, `src/main/ipc/handlers/modules.ts`,
  `src/main/modules/entity-detail-explore.live.test.ts` y los tests de CA1-CA8.
- Rondas de revisión: 1 (APROBADO). Verifier en verde (2193 tests, e2e 216/216). ADR nuevo: ninguno.
- Sin migraciones. Lo observado en el paso 0 está en `docs/notas-api-v2.md`.
- Ideas surgidas: dos opcionales del revisor y el e2e intermitente, pasados a "Mejoras anotadas".
