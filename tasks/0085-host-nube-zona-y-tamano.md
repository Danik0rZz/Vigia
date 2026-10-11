---
id: '0085'
titulo: 'Host: filas «Zona» y «Tamaño de instancia» en «Nube o virtualización», según el proveedor'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: ideas-backlog # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0085-host-nube-zona-y-tamano
adrs: [8] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: v2 (la misma respuesta de entities:get de hoy; nombres de las propiedades del esquema Host de `..\API\Dynatrace Environment APIv1\APIv1.json`, sin confirmar en v2 salvo gce*) # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

BACKLOG, «Mejoras anotadas» (surgió en 0020): «Información de la nube del host: filas de región y
tamaño de instancia. Solo llegan con claves propias de cada proveedor (`gce*`…); decide Dani de qué
claves salen por proveedor». Dani dijo que sí el 2026-10-11, con los proveedores que propuso el
Planificador.

## Especificación

Tarjeta «Información» del host (ficha 0020), grupo «Nube o virtualización»
(`src/renderer/src/pages/entities/host-info.ts`, `SECTION_ROWS.cloud`). Hoy tiene `cloudType` e
`hypervisorType`. Se añaden dos filas, después de esas, que salen solo si llega alguna de sus
claves:

- **Zona** (`cloudZone`): la zona de disponibilidad del host en su nube.
- **Tamaño de instancia** (`instanceSize`): el tipo o tamaño de la máquina.

De qué propiedad sale cada fila (propuesta del Planificador; **Dani la aprobó tal cual el
2026-10-11**: los cuatro proveedores de la tabla). Los nombres salen
del esquema `Host` de la API v1 (`..\API\Dynatrace Environment APIv1\APIv1.json`), que es donde la
OpenAPI los documenta; la v2 los devuelve en `properties` con el mismo nombre en los que se han
visto en vivo (`gce*`, ficha 0020). Ninguno se inventa:

| Proveedor    | Zona                                     | Tamaño de instancia                            |
| ------------ | ---------------------------------------- | ---------------------------------------------- |
| Google Cloud | `gcpZone`                                | `gceMachineType`                               |
| Azure        | `azureZone`                              | `azureVmSizeLabel`                             |
| AWS          | (ninguna: el esquema `Host` no la tiene) | `awsInstanceType`                              |
| OpenStack    | `openstackAvZone`                        | `openStackInstaceType` (escrito así en la API) |

- Se toma la primera clave de la tabla que llegue con texto; si no llega ninguna, la fila no sale
  (como las demás filas de la 0020). El texto se pinta tal cual, sin traducir.
- Las claves siguen saliendo también en «Todas las propiedades», como hoy.
- **Paso previo de solo lectura:** el developer amplía la prueba en vivo de la 0020
  (`npm run test:live`) para que diga cuáles de estas claves llegan en los hosts del tenant de
  pruebas, solo por su nombre y la forma del valor (nada del tenant). Lo que no llegue queda como
  «no probado en vivo» en la ficha y en `docs/notas-api-v2.md`; las filas salen igual si la clave
  llega.
- No cambia ninguna petición: `entities:get` ya trae todas las `properties`.
- Textos nuevos en es y en (`rows.cloudZone` y `rows.instanceSize`).

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**; dos filas nuevas con su
   regla de qué clave usar.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**; lee claves nuevas de la respuesta de la API (sin
   cambiar la petición, por eso sin la exclusión `api`).
4. No hay ninguna decisión que preguntar a Dani: **no se cumplía** al redactarla (qué proveedores
   y qué claves); Dani aprobó la propuesta el 2026-10-11.

## Criterios de aceptación

- CA1: un test unitario de `buildHostInfo` con «CA1 (0085)» en el nombre: con las claves de cada
  proveedor de la tabla (una fixture por proveedor, con valores inventados), el grupo «cloud» tiene
  las filas `cloudZone` e `instanceSize` con el texto de su clave, después de `cloudType` e
  `hypervisorType`; con AWS, solo `instanceSize`.
- CA2: sin ninguna de esas claves (o con texto vacío), las filas no salen y el grupo queda como hoy.
- CA3: los textos `rows.cloudZone` y `rows.instanceSize` existen en es («Zona», «Tamaño de
  instancia») y en en, y la paridad de `check` sigue en verde.
- CA4: un e2e con etiqueta `@host` y «CA4 (0085)» en el título: con un host simulado de Google Cloud,
  la tarjeta «Información» enseña «Zona» y «Tamaño de instancia» con sus valores.

## Pruebas a mano para Dani

- Con un host real en una nube, «Zona» y «Tamaño de instancia» coinciden con lo que enseña Dynatrace
  para ese host.

## Fuera de alcance

- La región de AWS, que no está en las propiedades del host (se podría sacar de la entidad
  `EC2_INSTANCE` con la que se relaciona; sería otra ficha, con la exclusión `api`).
- Otros datos de la nube (proyecto, grupo de recursos, nombre de la VM…), que siguen en «Todas las
  propiedades».

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
