---
id: '0042'
titulo: 'HOST: tarjeta «Eventos» con los eventos del host y de lo que corre en él (scope events.read)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(pendiente)

## Resultado

(pendiente)
