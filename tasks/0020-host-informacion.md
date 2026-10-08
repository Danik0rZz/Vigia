---
id: '0020'
titulo: 'HOST: tarjeta «Información» con los datos de la entidad y sus relaciones'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

- (developer) Filas de región y tamaño de instancia de la nube: solo llegan con claves propias de
  cada proveedor (`gce*`…). Si Dani las quiere, decidir de qué claves salen por proveedor.

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en el commit `995d469` (`test(host): criterios de la ficha 0020 (#0020)`). Al
escribirlos fallan los unitarios (no existe `host-info.ts` ni `entities.host.info` en los locales)
y los e2e de CA2, CA3 y CA4 (no existe la tarjeta `host-info`); CA5 pasa ya (es una salvaguarda).
Los e2e de la 0015, la 0018 y la 0019 siguen en verde con el simulador ampliado.

| Criterio | Test                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/renderer/src/pages/entities/host-info.test.ts` › `CA1 (0020): grupos de filas y de relaciones de un HOST a partir de entities:get`                                                                                                                                                                             |
| CA2      | `e2e/views.spec.ts` › `CA2 (0020): la página de un HOST enseña la tarjeta «Información» con sus grupos (Sistema, Capacidad, Red…), memoria en GB, IPs con «+N» y lo demás solo en «Todas las propiedades»` y `CA2 (0020): con un HOST con pocas claves solo salen los grupos y las filas con dato, sin «undefined»` |
| CA3      | `e2e/views.spec.ts` › `CA3 (0020): las relaciones salen en su orden con su número; «Ver nombres» los trae a demanda; pulsar un servicio abre su página y «Volver» regresa al host`                                                                                                                                  |
| CA4      | `e2e/views.spec.ts` › `CA4 (0020): sin entities.read, la tarjeta del host dice qué scope falta y los marcadores y gráficos siguen`                                                                                                                                                                                  |
| CA5      | Los e2e de la 0015 sin tocar (`CA1 (0015)` a `CA7 (0015)`) y `e2e/views.spec.ts` › `CA5 (0020): la tarjeta del servicio sigue igual (sus filas, sus grupos y sin nada del host); los e2e de la 0015 siguen sin tocar`                                                                                               |
| CA6      | `src/renderer/src/locales/host-info.test.ts` › `CA6 (0020): textos de la tarjeta «Información» del HOST en es y en` (la paridad general, `locales.test.ts` y `CA9 (0018)`)                                                                                                                                          |

**Lectura en vivo (autorizada por Dani, solo lectura).** Ampliada
`src/main/modules/entity-detail-explore.live.test.ts` con «Ficha 0020: datos de un HOST»: lee
`GET /entityTypes/HOST` y `GET /entities/{id}` de 3 hosts (1 de los problemas de 7 días; los
otros 2 de `/entities`, porque no había más). El informe solo guarda nombres de la API (los que
define el tipo HOST) y la forma de cada valor; un test propio comprueba que no se cuela ningún
id, nombre ni valor (se vio que la forma de un objeto con sus claves, como `kubernetesLabels`,
filtraba datos: ahora solo dice «objeto»).

- **Claves de `properties` que existen:** todas las de la ficha llegaron: `osType`,
  `osVersion`, `osArchitecture`, `bitness`, `monitoringMode`, `state`, `installerVersion`,
  `networkZone`, `cloudType` e `hypervisorType` (texto); `cpuCores`, `logicalCpuCores`,
  `physicalMemory` y `memoryTotal` (número; la memoria en bytes por su magnitud, y las dos
  iguales en los 3); `ipAddress` (lista de texto); `hostGroupName` (en 2 de 3). Además:
  `detectedName`, `macAddresses`, `additionalSystemInfo`, `customHostMetadata`,
  `kubernetesLabels`, `softwareTechnologies`, `oneAgentCustomHostName`, `autoInjection`,
  `standalone`, `installer*`, `ebpf*`, `hasPublicTraffic`, `isMonitoringCandidate` y, en uno,
  `gce*` (`gceMachineType`…).
- **Relaciones que existen (dirección vista desde el host):** `to.isProcessOf` (procesos),
  `to.runsOnHost` (en 1 de 3; tipos `SERVICE` y `SERVICE_INSTANCE`), `from.runsOn`
  (`EC2_INSTANCE`), `from.isInstanceOf` (`HOST_GROUP`); y otras: `to.runsOn`
  (`PROCESS_GROUP`), `to.isDiskOf`, `to.isNetworkInterfaceOf`, `from/to.isNetworkClientOfHost`,
  `to.isSiteOf`, `to.isCgiOfHost`, `to.isNodeOfHost`, `to.isClusterOfHost` y
  `to.isRuntimeComponentOf`.
- **No probado ni a pintar como fila:** «los datos de la nube (región, tamaño de instancia)». No
  llegó ninguna clave genérica de región o tamaño; solo las propias de un proveedor (`gce*`), y
  esas son «fuera de alcance» (van en «Todas las propiedades»). Si Dani quiere esas filas, hace
  falta decidir de qué claves salen.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Función (CA1):** `buildHostInfo(data: EntityData): { sections, groups }` en
  `pages/entities/host-info.ts`. `sections` = `{ key, rows }`, en este orden y solo las que
  tengan filas: `system` (osType, osVersion, osArchitecture, bitness), `capacity` (cpuCores,
  logicalCpuCores, memory), `network` (ipAddress, networkZone), `monitoring` (monitoringMode,
  state, installerVersion, firstSeen, lastSeen), `grouping` (hostGroupName, managementZones,
  tags) y `cloud` (cloudType, hypervisorType). Primera y última vez van en «Monitorización» y
  zonas y etiquetas en «Agrupación» (la ficha no les daba grupo). Filas como en la 0015 (`text`,
  `chips`, `date`) más `{ key: 'memory', kind: 'bytes', bytes }`: physicalMemory y, si no hay
  número positivo, memoryTotal; sin ninguno, sin fila. `ipAddress` en chips (partida por «, »).
- **Grupos de relaciones:** `{ key, total, entities }` como en la 0015, con `processes`
  (`to.isProcessOf`), `services` (`to.runsOnHost`), `runsOn` (`from.runsOn`), `hostGroup`
  (`from.isInstanceOf`) y `other` (el resto de las dos direcciones, también `to.runsOn`).
  Direcciones las vistas en vivo; las contrarias no se prueban.
- **Nombres en el e2e:** tarjeta `host-info` entre la cabecera y `host-markers`;
  `host-info-section` (`data-section`, con su nombre en un encabezado), `host-info-row`
  (`data-key`), `host-info-value`, `host-info-chip`, `host-info-more` («+N» de las IPs: se ven
  las 2 primeras), `host-info-relations`, `host-info-group` (`data-group`),
  `host-info-group-toggle`, `host-info-group-count`, `host-info-entity` (enlace, `data-entity-id`),
  `host-info-names`, `host-info-entity-name`, `host-info-properties-toggle` y
  `host-info-property` (`data-key`). Sin scope, `module-unavailable` dentro de `host-info`. La
  tarjeta del servicio conserva sus `service-info-*`. Memoria en GB como la 0018 («16,0 GB»).
- **Textos (CA6):** en `entities.host.info`: `sections.<key>` (Sistema, Capacidad, Red,
  Monitorización, Agrupación, Nube o virtualización), `rows.<key>` (una por fila) y
  `groups.<key>` (Procesos, Servicios, Se ejecuta en, Grupo de hosts, Otras relaciones). Título,
  «Ver nombres» y «Todas las propiedades» pueden seguir en `entities.service.info` si se
  generaliza la tarjeta.
- **Simulador:** `HOST_INFO_FULL_ID` (`HOST-00000000000E2E60`, todas las claves y las relaciones
  de cada grupo, con `INFO_FEW_ID` como servicio que se abre) y `HOST_METRICS_ID` (el de la
  0018/0019) con pocas claves (osType, memoryTotal y vacías). Nombres nuevos en `ENTITY_NAMES`.

**Decisiones del developer y del Orquestador (delegadas por Dani, refinables):**

- Región y tamaño de instancia de la nube no se pintan (decisión del Orquestador): solo llegan
  con claves propias de un proveedor, fuera de alcance; quedan en «Ideas surgidas». `cloudType`
  e `hypervisorType` sí, si vienen.
- Memoria en GB con `formatGigabytes` (`lib/host-format.ts`, la de la 0018, sobre
  `formatNumber`); versiones, IPs, núcleos y bits, tal cual (como en la 0015).
- La tarjeta se generaliza en `EntityInfoCard.tsx` (marco, chips, relaciones con «Ver nombres»
  y «Todas las propiedades», con `prefix` para los `data-testid`); `ServiceInfo.tsx` y
  `HostInfo.tsx` solo ponen sus filas. Los textos comunes siguen en `entities.service.info`.
- Las etiquetas del host, como las del servicio, con «+N» a partir de 6 (`host-info-tags-more`).
- `HostRow.key` es `string` (no `HostRowKey`): el test de CA1 busca filas en un `Map` con
  claves de texto y con el tipo estrecho no compila.
- En inglés, «Information about the host» y «Group of hosts»: el test del glosario exige que
  «Host» (con mayúscula) salga igual en es y en.

**Bloqueo para el Orquestador (developer):** `CA5 (0015)` (`e2e/views.spec.ts`, «pulsar una
entidad relacionada abre su página…») falla: cuenta todas las peticiones de `entities:get` y
espera las mismas al volver, pero ahora la página del host al que navega pide su propio
`entities:get` (lo que pide esta ficha). El servicio no se vuelve a pedir. Propuesta: contar
solo las peticiones del id del servicio, como hace `CA3 (0020)` con `hostQueries`. No lo he
tocado (es un test de otra ficha).

**Resuelto (test-writer, decisión del Orquestador delegada por Dani), commit `2646be5`:** `CA5 (0015)`
ahora cuenta solo las `entities:get` con el id del servicio (`serviceInfoQueries`), porque la
página del host a la que navega pide la suya, como manda la 0020; su intención (no volver a pedir
los datos del servicio) y el resto de comprobaciones siguen igual. `-g "CA5 \(0015\)|\(0020\)"`
con `--repeat-each 3 --workers=1`: 18 en verde.

## Resultado

(pendiente)
