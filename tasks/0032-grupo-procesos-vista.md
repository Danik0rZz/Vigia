---
id: '0032'
titulo: 'PROCESS_GROUP: página con marcadores, gráficos, instancias e información'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos
depende_de: ['0031', '0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0032-grupo-procesos-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:processGroupMetrics` de la 0031, `entities:get`/`entities:names` de la 0014 y los canales de problemas de las fichas 0007 y 0010)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «grupo-procesos» (0031 y 0032). "Haz lo mismo para process_group". La petición completa está
en la ficha 0031.

## Especificación

En `ProcessGroupEntityPage.tsx` se quita «Página en construcción». Mismos componentes que el
proceso (0028) y el orden de página que dejan las fichas 0036 y 0037 (etiquetas arriba, información
abajo):

- **Marcadores:** Instancias (cuántas), CPU (media del grupo; debajo, máxima), Memoria (media),
  Red (entrada; debajo, salida) y Problemas. Umbrales de CPU como en el host (80/90 %, con texto).
- **Gráficos** (2×2, sin rejilla): CPU (con la franja de problemas), Memoria, Red y CPU por
  instancia (una línea por instancia, como mucho 5, las de más CPU).
- **Tabla «Instancias»:** nombre, host, CPU media (con barra) y memoria; ordenada por CPU; cada
  instancia enlaza a su página de proceso y su host a la del host.
- **Tarjeta «Información»** (al final, como todas tras la 0036): claves vistas en vivo en
  PROCESS_GROUP (`detectedName`, `listenPorts`, `softwareTechnologies` y `metadata`), con el mismo
  filtro de seguridad que la 0029 (nada de línea de comandos, argumentos, variables de entorno ni
  rutas completas); relaciones «Instancias», «Hosts», «Servicios» y «Otras», con «Ver nombres».
- Rango global, «Actualizar», errores por panel. Textos en es y en.

**Nota del Orquestador (2026-10-09, por la revisión de la 0031, refinable):** el canal recorta las
instancias por encima de unas 498 (tope de 1000 series) y lo avisa en `partial`. Si `partial` no
viene vacío, la página enseña el aviso de recorte (como el desglose del host) y el marcador
«Instancias» no presenta `instances.total` como el total real del grupo (por ejemplo, «498+» o el
número con la nota «como mínimo»). Quedarse con las de más CPU queda para Dani (BACKLOG).

## Criterios de aceptación

- CA1 (e2e): la página de un process group del simulador enseña sus marcadores, los cuatro gráficos
  y la tabla de instancias con sus valores; no enseña «Página en construcción».
- CA2 (e2e): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su
  host abre la del host.
- CA3 (e2e): la franja de problemas sale sobre la CPU y abre el problema.
- CA4 (unitario, main): una entidad PROCESS_GROUP inventada con línea de comandos y rutas en
  `metadata` sale de `entities:get` sin esos valores.
- CA5 (e2e): la tarjeta «Información» sale la última y sin el valor de línea de comandos del
  simulador en ningún sitio de la página.
- CA6 (e2e): rango global, «Actualizar» y errores por panel como en el proceso.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con process groups reales, que marcadores, gráficos e instancias cuadran con Dynatrace.

## Fuera de alcance

- Métricas de tecnología.

## Ideas surgidas (fuera de alcance)

- (developer) En «CPU por instancia», dos instancias con el mismo nombre se juntan en la leyenda de
  ECharts; se podría añadir el host al nombre de la serie cuando se repite.
- (developer) El enlace del host en la tabla «Instancias» lleva `tabIndex={-1}` como los de la tabla
  de procesos del host (la fila abre la instancia con el teclado): el host no se alcanza con el
  teclado. Revisar en las dos tablas a la vez.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA7 con su test; los de la 0032 sin tocar tras `8801a71`. Fuera de ellos: entrada nueva de
`data/query-list.ts` en `e2e/areas.json`, tests nuevos de tokens en `env-colors.test.ts` y
`CA7 (0008)` (`8f4351d`), que solo quita PROCESS_GROUP de «en construcción», como la 0018, la 0024
y la 0028. «Abrir en Métricas» con `in(…entitySelector(…isInstanceOf…))` es deducible: une la forma
del live de la 0017 y el selector de la 0031, ambos vistos en vivo; id validado. Las cinco llamadas
a `entities:processMetrics` reutilizan `processMetricsQuery` en `MANUAL` (ADR-0004), y Reintentar
repite solo las fallidas. `--chart-4`/`--chart-5` con test de contraste en claro y oscuro. Sin IPC,
API, dependencias ni esquema nuevos; nada del tenant; `partial` con «N+» y aviso.

Sugerencias, no bloquean:

- Añadir al live de solo lectura una pasada del selector de «Abrir en Métricas» con `isInstanceOf`.
- En `CA6 (0032)`, comprobar también que tras «Actualizar» vuelven a salir las de instancia.

## Verificación

Tests escritos en `8801a71` (`test(grupo-procesos): criterios de la ficha 0032 (#0032)`). Fallan
por lo que falta, no por el test: los 7 e2e de la 0032 porque la página no tiene sus secciones
(`process-group-*`: `element(s) not found`) y los 3 unitarios de CA7 porque no existe
`entities.processGroup` en los locales. **CA4 ya pasa:** el filtro de main de la 0029
(`entity-secrets.ts`, en `toEntityData` para todas las entidades) ya quita `COMMAND_LINE_ARGS` y
`EXE_PATH` de un PROCESS_GROUP; queda como salvaguarda. Con el simulador ampliado siguen en verde
`CA6 (0031)`, `CA3 (0028)`, `CA3 (0029)` y `CA1 (0036)`.

| Criterio | Test                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0032): la página de un process group enseña sus marcadores, sus cuatro gráficos y la tabla de instancias…` y `CA1 (0032), nota del Orquestador: con las instancias recortadas (partial), la tabla avisa…` |
| CA2      | `e2e/views.spec.ts` › `CA2 (0032): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su host abre la del host`                                                                                       |
| CA3      | `e2e/views.spec.ts` › `CA3 (0032): la franja de problemas sale sobre el gráfico de CPU con los problemas del grupo, y pulsar un tramo abre el problema`                                                                               |
| CA4      | `src/main/ipc/handlers/entity-detail.test.ts` › `CA4 (0032): entities:get de un process group sale sin la línea de comandos ni las rutas de metadata`                                                                                 |
| CA5      | `e2e/views.spec.ts` › `CA5 (0032): la tarjeta «Información» del process group sale la última, con sus filas y relaciones, y sin la línea de comandos…`                                                                                |
| CA6      | `e2e/views.spec.ts` › `CA6 (0032): cambiar el rango global vuelve a pedir los datos; …` y `CA6 (0032): si falla el canal de métricas, sus marcadores, cada gráfico y la tabla enseñan el aviso…`                                      |
| CA7      | `src/renderer/src/locales/process-group-page.test.ts` › `CA7 (0032): textos de la página del process group en es y en`                                                                                                                |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Simulador:** un process group nuevo para la página, `PROCESS_GROUP_PAGE_ID`, con siete
  instancias en tres hosts (para «como mucho 5, las de más CPU»), los mismos totales que el de la
  0031 y dos problemas (P-E2E83 abierto y P-E2E84 cerrado). El de la 0031 (dos instancias) no
  cambia. Flags nuevos: `processGroupMetricsFail` (400) y `processGroupTruncated`
  (`dimensionCountRatio` 1.5 en las expresiones por instancia → `partial`).
- **«CPU por instancia»:** el canal de la 0031 no trae series por instancia y la ficha no dice de
  dónde salen. El simulador las da de dos formas: en `entities:processGroupMetrics`, una expresión
  de `cpu.usage` partida por `dt.entity.process_group_instance` sin `resolution=Inf` (de más a
  menos CPU, con nombre si lleva `:names` y recortada si lleva `:limit(N)`), o en
  `entities:processMetrics` de cada instancia. El test solo mira el gráfico: cinco series con el
  nombre de las cinco de más CPU. Ojo: `CA6 (0031)` exige dos consultas al canal y que la de series
  no lleve `:parents:splitBy(…):avg:names`.

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-09:** «CPU por instancia» sale
de `entities:processMetrics` (0027) de las cinco instancias de más CPU media según
`instances.items` del canal de la 0031: cinco llamadas al canal ya existente, con expresiones ya
confirmadas en vivo. No se cambia el canal de la 0031 ni se añade una expresión nueva sin probar en
vivo (regla de no inventar). Se piden después de llegar las instancias, con el mismo rango y solo con
«Actualizar» o un rango nuevo (ADR-0004). Si una falla, ese gráfico enseña su aviso con Reintentar.
Si en el futuro se quiere una sola consulta (`splitBy` por instancia con `:sort`/`:limit`), primero
se prueba en vivo.

- **Marcadores:** los `totals` del canal; la CPU es la media del total del grupo (suma de las
  instancias, 64,5 %) y debajo la máxima (112,5 %); red en bit/s como el proceso.
- **Recorte (nota del Orquestador):** con `partial`, aviso `process-group-instances-partial` (texto
  con «incomplet» o «recort») y el marcador «Instancias» no puede ser «7» a secas: «7+», «como
  mínimo» o «al menos».
- **Relaciones de «Información»** (vistas en vivo en PROCESS_GROUP, informe de
  `entities-explore`): «Instancias» = `isInstanceOf` de to, «Hosts» = `runsOn` de from,
  «Servicios» = `runsOn` de to, «Otras» = el resto (en el simulador, `isNetworkClientOfProcessGroup`).
  Filas exigidas: `technologies`, `listenPorts` y `detectedName`.
- **Nombres** (testids, en el comentario del bloque de la 0032 de `e2e/views.spec.ts`): los del
  proceso con el prefijo `process-group`; gráficos `cpu`, `memory`, `network` y `cpu-instances`;
  tabla `process-group-instances` con columnas `name`, `host`, `cpu` y `memory`. Textos en
  `entities.processGroup` (`markers`, `charts`, `instances`, `info.rows` e `info.groups`).

### Verifier, 2026-10-09, commit `314ed01`, rango `main..feat/0032-grupo-procesos-vista`: VERDE

- check: 2575 tests en 147 ficheros, cobertura ok.
- e2e completo: 287/287 (incluye CA1, la nota del recorte, CA2, CA3, CA5 y CA6 de la 0032).

## Resultado

Commits: `d289705` (tokens), `57d7ca0` (consultas), `bb23367` (página), `8f4351d` (test de la 0008); `main..HEAD` trae también los de tests y fichas. Ficheros principales: `ProcessGroupEntityPage.tsx`, `ProcessGroupMarkers.tsx`, `ProcessGroupCharts.tsx`, `ProcessGroupInstances.tsx`, `ProcessGroupInfo.tsx`, `process-group-*.ts`, `data/query-list.ts` y `data/modules.ts`. Rondas de revisión: 1 (aprobada). ADR nuevo: ninguno. Migraciones: no.

**Decisiones del developer (delegadas por Dani, refinables), 2026-10-09:**

- **«CPU por instancia»**, como dice la decisión del Orquestador: `topInstances`
  (`process-group-charts.ts`) toma las cinco primeras de `instances.items` con CPU y con id de
  PROCESS_GROUP_INSTANCE válido, y la página pide `entities:processMetrics` de cada una
  (`useProcessMetricsList`, con la misma clave que la página del proceso: abrir una de esas
  instancias con el mismo rango no la vuelve a pedir). Se piden al llegar las instancias; con
  «Actualizar» se repiten junto con la del grupo (las dos cuelgan del módulo `entities`). Si falla la
  del grupo, el panel enseña su aviso; si falla una instancia, el de esa, y Reintentar repite solo
  las fallidas (`combineQueries`, `data/query-list.ts`).
- **Colores:** cinco líneas necesitan cinco colores: tokens nuevos `--chart-4` y `--chart-5` (claro y
  oscuro), `series4`/`series5` en `ChartColors` y su contraste en `env-colors.test.ts`.
- **Eje de la CPU** del grupo y de «CPU por instancia», desde 0 y sin tope de 100 % (la del grupo es la
  suma de sus instancias).
- **«Abrir en Métricas»** de CPU, memoria y red del total: la expresión de main (`:splitBy():sum`) con
  `:filter(in("dt.entity.process_group_instance",entitySelector("type(PROCESS_GROUP_INSTANCE),fromRelationships.isInstanceOf(entityId(<id>))")))`:
  Métricas solo recibe el selector. El filtro `in(entitySelector(…))` lo probó en vivo la 0017 con
  `isProcessOf`; con `isInstanceOf` no está probado (solo afecta al enlace, no a lo que pide la
  página). La de «CPU por instancia», la de la CPU del proceso (0028) de cada instancia, separadas por
  comas.
- **Recorte:** con `partial` no vacío, el marcador enseña «N+» y debajo «Como mínimo: Dynatrace ha
  recortado la consulta», y la tabla, el aviso `process-group-instances-partial`.
- **Marcadores:** debajo de la CPU y la memoria, «Total del grupo, media del rango»; la memoria sin
  máxima (el canal no la trae). Umbrales de la CPU, los del host sobre la media del total.
- **Información:** filas del proceso (las mismas claves en vivo), con `buildProcessRows` y
  `buildRelationGroups` sacados de `process-info.ts`; «Otras» se titula «Otras relaciones», como en el
  proceso.
- **Textos:** «Process group» con mayúscula en los textos en es que lo nombran (el test del glosario
  exige que el término se escriba igual en los dos idiomas).
- **Test de otra ficha:** `CA7 (0008)` aún contaba PROCESS_GROUP entre los tipos en construcción; sale
  de la lista en un commit propio (`8f4351d`), como hicieron la 0018, la 0024 y la 0028.
