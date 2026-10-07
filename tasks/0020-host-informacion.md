---
id: '0020'
titulo: 'HOST: tarjeta «Información» con los datos de la entidad y sus relaciones'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0015', '0018']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0020-host-informacion
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:get` y `entities:names` de la 0014; scope `entities.read`)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host» (0016 a 0020). "También sería interesante hacer lo mismo que con services: consultar la
entidad y sacar la información relevante." La petición completa está en la ficha 0016.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

Misma tarjeta «Información» que la del servicio (0015), con su principio: breve y bonita, el
detalle plegado a un clic. Si la 0015 la dejó solo para SERVICE, se generaliza (filas y grupos de
relaciones por tipo); el servicio no cambia.

**Qué enseña para HOST** (solo las filas que vengan; claves vistas en vivo en
`entities-explore.live.test.ts`):

- **Sistema:** `osType`, `osVersion`, `osArchitecture` y `bitness`.
- **Capacidad:** `cpuCores` y `logicalCpuCores`; `physicalMemory` o `memoryTotal` (en GB).
- **Red:** `ipAddress` (las primeras y «+N») y `networkZone`.
- **Monitorización:** `monitoringMode`, `state` y versión de OneAgent (`installerVersion`).
- **Agrupación:** `hostGroupName`.
- **Nube o virtualización:** `cloudType`, `hypervisorType` y, si vienen, los datos de la nube
  (región, tamaño de instancia).
- Visto por primera y última vez; management zones y etiquetas como chips.
- **Relaciones**, en este orden y solo las que vengan: «Procesos» (`isProcessOf`), «Servicios»
  (`runsOnHost`), «Se ejecuta en» (`runsOn` de `fromRelationships`: hipervisor o similar), «Grupo
  de hosts» (`isInstanceOf`) y «Otras relaciones», plegada. Con «Ver nombres» a demanda y enlaces a
  la página de cada entidad, como en la 0015.
- «Todas las propiedades», plegada.

Dónde: entre la cabecera y los marcadores, como en el servicio. Sin el scope `entities.read`, el
aviso de "falta el scope" y el resto de la página sigue.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario): la función que elige y ordena las filas y los grupos de relaciones para HOST, a
  partir de una salida de `entities:get` inventada con todas las claves y con pocas.
- CA2 (e2e): la página de un HOST del simulador enseña la tarjeta con sus grupos (Sistema,
  Capacidad, Red…), memoria en GB y solo las filas con dato.
- CA3 (e2e): las relaciones salen en su orden; «Ver nombres» los trae a demanda; pulsar un servicio
  abre su página (la del servicio) y «Volver» regresa al host.
- CA4 (e2e): sin `entities.read`, la tarjeta enseña el aviso del scope y los marcadores y gráficos
  siguen.
- CA5 (e2e): la tarjeta del servicio sigue igual (sus e2e pasan).
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con hosts reales, que la tarjeta se lee de un vistazo y no sobra ni falta nada importante.

## Fuera de alcance

- Las propiedades de nube una a una de cada proveedor (van en «Todas las propiedades»).
- Iconos de Dynatrace.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
