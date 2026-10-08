---
id: '0029'
titulo: 'PROCESS_GROUP_INSTANCE: tarjeta «Información» del proceso (sin línea de comandos)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: proceso
depende_de: ['0015', '0020', '0027', '0028']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0029-proceso-informacion
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:get` y `entities:names` de la 0014; scope `entities.read`)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «proceso» (0027 a 0029). "Consultar la entidad y sacar la información relevante", como en
SERVICE. La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

La tarjeta «Información» (0015, generalizada en la 0020) para PROCESS_GROUP_INSTANCE, breve y con el
detalle plegado:

- **Filas** (claves vistas en vivo en la 0027; en `PROCESS_GROUP` se vieron `detectedName`,
  `listenPorts`, `metadata` y `softwareTechnologies`): tecnologías como chips, puertos de escucha,
  nombre detectado, ejecutable (solo el nombre del fichero, si viene en `metadata`), visto por
  primera y última vez, management zones y etiquetas.
- **Seguridad:** la línea de comandos, los argumentos y las variables de entorno que puedan venir en
  `properties` (por ejemplo, dentro de `metadata`) **no se enseñan en ningún sitio**, tampoco en
  «Todas las propiedades»: pueden llevar contraseñas o tokens. Se filtran en main antes de mandar
  la entidad a la interfaz, con una lista de claves y de formas (las que encuentre la 0027) y un
  test. La ruta completa del ejecutable tampoco (puede llevar el nombre del usuario).
- **Relaciones:** «Se ejecuta en» (el host), «Process group» (`isInstanceOf`), «Servicios» (los
  que corren en él) y «Otras relaciones» plegada; «Ver nombres» a demanda y enlaces, como en la 0015.
- «Todas las propiedades», plegada (sin lo filtrado). Sin `entities.read`, aviso del scope.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, main): una entidad inventada con línea de comandos, argumentos, variables de
  entorno y ruta completa en sus propiedades sale de `entities:get` sin ninguno de esos valores (ni
  en las filas ni en todas las propiedades).
- CA2 (unitario): la función que elige filas y grupos para PROCESS_GROUP_INSTANCE.
- CA3 (e2e): la página de un proceso del simulador enseña su tarjeta, relaciones con «Ver nombres»
  y enlaces (al host y a los servicios), y no enseña el valor de la línea de comandos del
  simulador en ningún sitio de la página.
- CA4 (e2e): sin `entities.read`, aviso del scope y los marcadores y gráficos siguen.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con procesos reales, que la tarjeta se lee de un vistazo y que no aparece ninguna línea de
  comandos ni ruta con nombres de usuario.

## Fuera de alcance

- Página de PROCESS_GROUP (el grupo), que sigue en construcción.

## Ideas surgidas (fuera de alcance)

- (developer) Otras claves de `metadata` con rutas (`JAVA_JAR_PATH`, `PHP_SCRIPT_PATH`,
  `PYTHON_SCRIPT_PATH`, `NODE_JS_APP_BASE_DIRECTORY`…) también pueden llevar el nombre del usuario;
  no se filtran porque la ficha solo pide la ruta del ejecutable. Si Dani lo quiere, basta con
  añadirlas a `src/main/modules/entity-secrets.ts`.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA5 con su test; sin tocar tests tras `8769183`. CA1 mira respuesta y log y que no se quite de más; CA3 busca en HTML y texto con todo desplegado y al volver. El filtro (`entity-secrets.ts`) va en `toEntityData`, único paso de las `properties` a la interfaz; main no guarda caché, el log no lleva valores y «Todas las propiedades» recibe lo ya filtrado. Claves en el enum de metadata de la Configuration API. Puertos con « · »: decisión refinable aceptada.

Sugerencias, no bloquean:

- Seguridad: `isHiddenEntry` solo mira elementos de lista; un `{ key: "COMMAND_LINE_ARGS", value }` como valor directo de una propiedad saldría. No visto en vivo; cubrirlo en la rama de objetos de `withoutHiddenValues`.
- Quitar de más: `env` y `environment` exactos se quitan en todas las entidades; anotarlo si se ve en vivo un uso inocuo.
- Otras rutas de metadata (`JAVA_JAR_PATH`, `PHP_SCRIPT_PATH`, `CATALINA_HOME`…) siguen pasando: en "Ideas surgidas", lo decide Dani.

## Verificación

Tests escritos en el commit `8769183` (`test(proceso): criterios de la ficha 0029 (#0029)`). Al
escribirlos fallan por lo que falta, no por el test: CA1 porque `entities:get` aún devuelve los
valores (5 en rojo; «lo demás sigue llegando» ya pasa, es una salvaguarda), CA2 porque no existe
`process-info.ts`, CA5 porque no existe `entities.process.info` en los locales, y CA3 y CA4 porque
no existe la tarjeta `process-info`. Los e2e de la 0015, la 0020, la 0026, la 0027 y la 0028 siguen
en verde con el simulador ampliado.

| Criterio | Test                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/main/ipc/handlers/entity-detail.test.ts` › `CA1 (0029): entities:get de un proceso sale sin línea de comandos, argumentos, variables de entorno ni ruta completa`                                                  |
| CA2      | `src/renderer/src/pages/entities/process-info.test.ts` › `CA2 (0029): filas y grupos de relaciones de un PROCESS_GROUP_INSTANCE a partir de entities:get`                                                               |
| CA3      | `e2e/views.spec.ts` › `CA3 (0029): la página de un proceso enseña su tarjeta «Información» (…), sus relaciones con «Ver nombres» y enlaces al host y a los servicios, y nunca la línea de comandos ni la ruta completa` |
| CA4      | `e2e/views.spec.ts` › `CA4 (0029): sin entities.read, la tarjeta del proceso dice qué scope falta y los marcadores y gráficos siguen`                                                                                   |
| CA5      | `src/renderer/src/locales/process-info.test.ts` › `CA5 (0029): textos de la tarjeta «Información» del proceso en es y en` (la paridad general, `locales.test.ts`)                                                       |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Formas filtradas (CA1):** en `metadata` (lista de `{ key, value }`), `COMMAND_LINE_ARGS` y
  `EXE_PATH` (vistas en vivo en la 0027). Para la línea de comandos y las variables de entorno,
  que la 0027 no vio, formas inventadas: propiedad de texto `commandLine` y propiedad objeto
  `environmentVariables`. Se exige que sus valores no salgan en la respuesta ni en el log; el
  resto de `metadata` (`EXE_NAME`, `KUBERNETES_*`…) y las demás propiedades siguen llegando.
- **Función (CA2):** `buildProcessInfo(data: EntityData): { rows, groups }` en
  `pages/entities/process-info.ts`. Filas planas, en este orden y solo con dato: `technologies`
  (chips de `softwareTechnologies`, partida por «, »), `listenPorts` (texto tal cual),
  `detectedName`, `executable` (el valor de `EXE_NAME` dentro del texto de `metadata`, y si trae
  ruta, solo el nombre del fichero), `firstSeen`, `lastSeen`, `managementZones` y `tags`.
  `metadata` nunca es fila.
- **Grupos:** `runsOn` («Se ejecuta en», `isProcessOf` de from), `processGroup` («Process group»,
  `isInstanceOf` de from), `services` («Servicios», `runsOnProcessGroupInstance` de to: la
  contraria de la que usa el servicio en la 0015; la 0027 no la vio en sus muestras) y `other`
  (el resto, también esas en la dirección contraria).
- **Nombres en el e2e:** prefijo `process-info` (como `monitor-info`), tarjeta entre la cabecera
  y `process-markers`, con `-row` (`data-key`), `-value`, `-chip`, `-relations`, `-group`
  (`data-group`), `-group-toggle`, `-group-count`, `-entity` (`data-entity-id`), `-names`,
  `-entity-name`, `-properties-toggle` y `-property` (`data-key`).
- **Textos (CA5):** `entities.process.info.rows.<key>` y `groups.<key>`.
- **Simulador:** `/entities/{id}` de `PROCESS_METRICS_ID` (el proceso de la 0027 y la 0028) con las
  claves de la 0027, `metadata` con `COMMAND_LINE_ARGS` y `EXE_PATH` inventados, host, process
  group, dos servicios (`INFO_FEW_ID` para abrir su página) y `isPgiOfCgi` para «Otras
  relaciones»; ids nuevos `…E2E90` a `…E2E93`. CA3 mira el HTML y el texto de toda la página con
  todo desplegado y otra vez al volver.

**Decisiones del developer:**

- **Filtro en main** (`src/main/modules/entity-secrets.ts`, usado por `toEntityData` para todas
  las entidades, no solo procesos): fuera la propiedad o el campo anidado, y la entrada
  `{ key, value }` de una lista, cuya clave (en minúsculas y sin `_`, `-`, `.`) contenga
  `commandline`, `cmdline`, `commandpath`, `exepath`, `environmentvariable` o `envvar`, o sea
  `args`, `arguments`, `argv`, `env`, `environment` o `dotnetcommand`. Cubre `COMMAND_LINE_ARGS`,
  `EXE_PATH`, `DOTNET_COMMAND` y `DOTNET_COMMAND_PATH` del enum de metadata de la Configuration API.
- **Puertos de escucha** en la vista separados por « · » («8080 · 8443»): `buildProcessInfo` los da
  tal cual («8080, 8443»), pero con la coma pegada CA3 (`loneNumber`) no ve el número suelto, y
  además se leería como un decimal.

### Verifier, 2026-10-08, commit `a3ea5fd`, rango `main..feat/0029-proceso-informacion`: VERDE

- check: 2494 tests en 139 ficheros, cobertura ok.
- e2e afectados: 215/215 (incluye CA3 y CA4 de la 0029).

## Resultado

- **Commits** (`main..HEAD`): tests `8769183`; filtro en main `83d43a5`; filas y grupos `3e08f87`; tarjeta en la página `c0ac149`; puertos con « · » `8dc349e`; el resto, fichas.
- **Ficheros principales:** `src/main/modules/entity-secrets.ts` (+ `entities.ts`), `src/renderer/src/pages/entities/process-info.ts`, `ProcessInfo.tsx`, `ProcessEntityPage.tsx`, `EntityInfoCard.tsx` y los locales es y en.
- **Rondas de revisión:** 1 (aprobada). Verifier en verde (2494 unitarios, 215 e2e afectados).
- **ADR nuevo:** ninguno. Sin migraciones.
- Sugerencias del revisor pasadas a "Mejoras anotadas" del BACKLOG; la de seguridad, prioritaria.
