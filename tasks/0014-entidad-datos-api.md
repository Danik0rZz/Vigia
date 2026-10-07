---
id: '0014'
titulo: 'Entidades: datos de una entidad y nombres de sus relaciones (scope entities.read)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
