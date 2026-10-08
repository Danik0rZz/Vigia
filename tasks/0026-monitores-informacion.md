---
id: '0026'
titulo: 'Monitores: tarjeta «Información» con los datos de la entidad'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0015', '0022', '0024']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0026-monitores-informacion
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:get` y `entities:names` de la 0014; scope `entities.read`)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «monitores» (0022 a 0026). "Haz lo mismo" que con SERVICE: consultar la entidad y sacar la
información relevante. La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

La tarjeta «Información» de la 0015 (generalizada por tipo en la 0020), para SYNTHETIC_TEST y
HTTP_CHECK, con su principio: breve y bonita, el detalle plegado.

- **Filas:** las `properties` que la 0022 encontró en vivo (`GET /entities/{entityId}`, decisión de
  Dani) y que sirvan para situar el monitor: tipo, si está activo, frecuencia, número de
  localizaciones y de pasos o peticiones, aplicación monitorizada…, las que vengan,
  elegidas por el developer con ese informe y anotadas en "Resultado"; visto por primera y última
  vez; management zones y etiquetas como chips.
- **Relaciones**, solo las que vengan: «Monitoriza» (la aplicación o el servicio), «Localizaciones»,
  «Pasos» o «Peticiones» y «Otras relaciones» plegada; con «Ver nombres» a demanda y enlaces a la
  página de cada entidad, como en la 0015.
- «Todas las propiedades», plegada.
- Sin `entities.read`, el aviso del scope y el resto de la página sigue.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario): la función que elige filas y grupos de relaciones para los dos tipos, con una
  salida de `entities:get` inventada (con todas las claves y con pocas).
- CA2 (e2e): la página de un browser monitor y la de un HTTP monitor enseñan su tarjeta con sus
  filas y relaciones; «Ver nombres» a demanda y los enlaces funcionan.
- CA3 (e2e): sin `entities.read`, aviso del scope y los marcadores y gráficos siguen.
- CA4 (e2e): las tarjetas de servicio y host siguen igual (sus e2e pasan).
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con monitores reales, que la tarjeta se lee de un vistazo y no sobra ni falta nada importante.

## Fuera de alcance

- La API v1 de sintéticos y el script del monitor (ver la 0022).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA5 con su test (CA4 es salvaguarda, como dice la ficha); sin tocar tests tras `6be05b8`. Sin
canal ni esquema nuevos: reutiliza `entities:get` y `entities:names` con `useEntityInfo`, espera a
`useConnectionStatusKnown` y respeta ADR-0004. Claves y relaciones las de la 0022 en
`docs/notas-api-v2.md`. Simulador con ids inventados y dominio `.invalid`.

Unidad de la frecuencia: basta para aprobar. `frequencyMin` está en la OpenAPI v2 («in minutes»);
la propiedad de la entidad no está documentada, pero la equivalencia es razonable y la confirma la
prueba a mano.

Sugerencias, no bloquean:

- Corregir en la ficha que la unidad viene de la OpenAPI v2, no de la v1, y que la prueba a mano
  mire la unidad (hecho por el Orquestador).
- `MonitorInfo.tsx:89`: el caso `'number'` da por hecho que el único número es la frecuencia;
  comprobar `row.key` como con `tags` si entra otra fila numérica.

## Verificación

Tests escritos en el commit `6be05b8` (`test(monitores): criterios de la ficha 0026 (#0026)`). Al
escribirlos fallan los unitarios (no existe `monitor-info.ts` ni `entities.monitor.info` en los
locales) y los e2e de CA2 y CA3 (no existe la tarjeta `monitor-info`); CA4 pasa ya (es una
salvaguarda). Los e2e de la 0015, la 0020, la 0024 y la 0025 siguen en verde con el simulador
ampliado (25 de 28 con `-g "(0015|0020|0024|0025|0026)"`; los 3 en rojo, los de esta ficha).

| Criterio | Test                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/renderer/src/pages/entities/monitor-info.test.ts` › `CA1 (0026): filas y grupos de relaciones de un browser monitor y de un HTTP monitor a partir de entities:get`               |
| CA2      | `e2e/views.spec.ts` › `CA2 (0026): la página de un browser monitor enseña la tarjeta «Información»…` y `CA2 (0026): la página de un HTTP monitor enseña su tarjeta con «Peticiones»…` |
| CA3      | `e2e/views.spec.ts` › `CA3 (0026): sin entities.read, la tarjeta del monitor dice qué scope falta y los marcadores y gráficos siguen`                                                 |
| CA4      | Los e2e de la 0015 y la 0020 sin tocar y `e2e/views.spec.ts` › `CA4 (0026): las tarjetas del servicio y del host siguen igual…`                                                       |
| CA5      | `src/renderer/src/locales/monitor-info.test.ts` › `CA5 (0026): textos de la tarjeta «Información» de los monitores en es y en` (la paridad general, `locales.test.ts`)                |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Función (CA1):** `buildMonitorInfo(data: EntityData): { rows, groups }` en
  `pages/entities/monitor-info.ts`; el tipo sale de `data.type` (`HTTP_CHECK` es HTTP). Filas
  planas, como el servicio (son pocas).
- **Filas obligatorias**, en este orden relativo y solo con dato; el developer puede añadir otras
  entre ellas con el informe de la 0022 (la ficha se las deja) y anotarlas en "Resultado":
  `monitorType` (`browserMonitorSubtype` / `httpMonitorSubtype`, texto), `enabled` (`isEnabled`,
  `{ kind: 'boolean', value }`, solo con true o false), `frequency`
  (`syntheticMonitorFrequency`, `{ kind: 'number', value }`, solo positivo; la unidad la pone la
  vista), `locations` y `steps` (browser) o `requests` (HTTP) (`{ kind: 'count', count }`),
  `firstSeen`, `lastSeen`, `managementZones` y `tags`. Nunca son fila las capturas
  (`syntheticScreenshot*Uri`) ni `detectedName`.
- **Recuentos de localizaciones y pasos, del `total` de las relaciones** (`runsOn` de from e
  `isStepOf` de to), no de `assignedLocations` ni `steps`: main recorta el texto de una propiedad
  a 300 caracteres y una lista larga daría una cuenta menor.
- **Grupos:** `monitors` («Monitoriza»: `monitors` y `calls` de from e
  `isApplicationOfSyntheticTest` de to), `locations`, `steps` o `requests` (según el tipo) y
  `other` (el resto, también esas relaciones en la dirección contraria). Direcciones, las de la 0022.
- **Nombres en el e2e:** prefijo `monitor-info` (como `host-info`): tarjeta entre la cabecera y
  `monitor-markers`, `monitor-info-row` (`data-key`), `-value`, `-chip`, `-relations`, `-group`
  (`data-group`), `-group-toggle`, `-group-count`, `-entity` (`data-entity-id`), `-names`,
  `-entity-name`, `-properties-toggle` y `-property` (`data-key`). En el e2e, «si está activo»
  no enseña `true`/`false` y el del HTTP (inactivo) es distinto del del browser.
- **Textos (CA5):** `entities.monitor.info.rows.<key>` y `groups.<key>` (Monitoriza,
  Localizaciones, Pasos, Peticiones, Otras relaciones).
- **Simulador:** `/entities/{id}` de `MONITOR_BROWSER_ID` y `MONITOR_HTTP_ID` con las claves y
  relaciones de la 0022 y valores inventados; localizaciones, pasos y peticiones con ids propios
  (`…E2EB*`, `…E2EC*`, `…E2ED*`) y nombres en `ENTITY_NAMES`; el HTTP «Monitoriza» a
  `INFO_FEW_ID` (para abrir la página del servicio) y una relación `belongsTo` (ENVIRONMENT) para
  «Otras relaciones».

## Resultado

- `pages/entities/monitor-info.ts` (`buildMonitorInfo`), `MonitorInfo.tsx` (sobre
  `EntityInfoCard.tsx`, prefijo `monitor-info`) y la tarjeta en `MonitorEntityPage.tsx`, entre la
  cabecera y los marcadores, con `useEntityInfo` y la espera a `connection:status`, como el host.
- **Filas añadidas por el developer** (informe de la 0022), entre las obligatorias:
  `deviceProfile` («Dispositivo», solo browser, texto, tras la frecuencia) y `lastExecution`
  («Última ejecución», fecha de `lastExecutionTimestamp` si es un número positivo, tras pasos o
  peticiones). El resto (`createdBy`, `lastModifiedBy`, `url`, `customizedName`…), solo en
  «Todas las propiedades».
- **Unidad de la frecuencia: minutos** («Cada 15 minutos»). La OpenAPI v2 no documenta la
  propiedad `syntheticMonitorFrequency` de la entidad; se toma la de `frequencyMin` de la API de
  monitores sintéticos, que la propia OpenAPI v2 define «in minutes» (corregido en la revisión).
  Sin confirmar en vivo: la prueba a mano de Dani mira expresamente la unidad; si no cuadra, se
  cambia el texto.
- «Si está activo» se enseña como «Activo» o «Inactivo» (fila «Estado»). Textos en
  `entities.monitor.info` (es y en), con `column` («Monitor») como título de la columna de filas.
