---
id: '0041'
titulo: 'HOST: tarjeta «Logs» con los procesos del host que tienen logs detectados'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
