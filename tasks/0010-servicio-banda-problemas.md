---
id: '0010'
titulo: 'SERVICE: franja de los problemas de la entidad sobre el gráfico de tasa de error'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: ['0007', '0009']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0010-servicio-banda-problemas
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /problems` con `problemSelector=affectedEntities("id")`, `from`, `to`, `pageSize` y `sort`; campos `problemId`, `displayId`, `title`, `status`, `severityLevel`, `startTime` y `endTime` del esquema `Problem`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `problems.read` (ya en uso).
migracion: no
rondas_revision: 1
---

## Petición original

Lote «servicio» (0006 a 0010). En el ejemplo de Dynatrace que pasó Dani, el gráfico de tasa de error
lleva encima una franja roja con el periodo del problema. A la pregunta de si iba en este lote o en
una ficha aparte, Dani: "Lo quiero en este lote" (2026-10-07). La petición completa está en la ficha 0006.

## Especificación

**Canal IPC nuevo `entities:problems`** (en `src/shared/ipc.ts`, con Zod):

- Entrada: `environmentId`, `entityId` (misma validación que `entities:problemCounts` de la 0007)
  y `timeRange` (el rango global).
- Main hace un `GET /problems` con `problemSelector=affectedEntities("<id>")`, el `from`/`to` del
  rango, `pageSize=100` y `sort=-startTime`. Si `totalCount` es mayor que lo recibido, la salida lo
  dice (`truncated`), como `problems:list`.
- Salida: lista de `{ problemId, displayId, title, status, severityLevel, startTime, endTime }`
  (`endTime` `null` o `-1` si sigue abierto, normalizado a `null`), `totalCount`, `truncated` e
  `invalid` (elementos que no cumplen el esquema).
- La prueba en vivo de la 0007 se amplía (solo lectura, solo comportamientos): que la lista con
  `affectedEntities` y rango da 200 y que los `startTime`/`endTime` cuadran con el estado.
- Errores con `reason` (ADR-0005). Sin refresco solo (ADR-0004). El simulador de los e2e responde.

**Franja en el gráfico «Tasa de error»** (0009), como en el ejemplo de Dynatrace:

- Encima del área del gráfico, una franja con un tramo por problema, del inicio al fin (los
  abiertos, hasta el final del rango), recortado al rango visible. Abiertos en el color de error del
  tema y cerrados en un tono apagado; siempre con un icono o texto además del color.
- Si se solapan, se dibujan en filas (como mucho 3; si hay más, la última dice «+N»).
- Tooltip con ratón y con foco: id visible (P-…), título, estado, inicio y fin (o «Activo»).
- Al pulsar un tramo (o Enter con el foco), se abre el detalle del problema (`/problems/<id>`), y
  «Volver» regresa a la página del servicio.
- Sin problemas en el rango, no hay franja (ni hueco). Si el canal falla, la franja enseña un aviso
  compacto con Reintentar y el gráfico sigue.
- Si la lista viene recortada (`truncated`), una nota pequeña lo dice.
- Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, main): con `fetch` simulado, una petición a `/problems` con
  `affectedEntities("<id>")`, el `from`/`to` del rango, `pageSize=100` y `sort=-startTime`; la
  salida normaliza `endTime` (`-1` → `null`) y marca `truncated` si `totalCount` es mayor.
- CA2 (unitario, main): un elemento que no cumple el esquema cuenta en `invalid` y no rompe la
  lista; un 400 acaba en error con `reason`.
- CA3 (unitario): el cálculo de tramos recorta al rango, lleva los abiertos hasta el final y reparte
  los solapados en filas (máximo 3 y «+N»).
- CA4 (e2e): en la página de un SERVICE del simulador con un problema abierto y uno cerrado, salen
  dos tramos con su estado (atributo y texto), y el tooltip enseña id, título, estado, inicio y fin.
- CA5 (e2e): pulsar un tramo (y Enter con el foco) abre el detalle de ese problema; «Volver» vuelve
  a la página del servicio sin pedir otra vez sus datos.
- CA6 (e2e): sin problemas no hay franja; si el canal falla, aviso con Reintentar y el gráfico de
  tasa de error sigue visible.
- CA7 (live, solo lectura): el informe dice si la consulta funciona y si las fechas cuadran con el
  estado, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA8 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un servicio real que haya tenido un problema en el rango, que la franja cae donde sube la tasa
  de error y coincide con lo que enseña Dynatrace; que al pulsarla abre el problema.

## Fuera de alcance

- La franja en los otros tres gráficos.
- Eventos que no son problemas (despliegues, cambios de configuración).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1-CA8 con su test; ninguno pasaría sin el código; tests sin tocar desde `e78dae2`.
- Canal `entities:problems`: Zod en las dos direcciones; id validado antes del selector (sin petición con
  un id inválido); `endTime` -1 → `null`; `invalid` y `truncated` (también por `nextPageKey`);
  `entityProblemListRejected` (ADR-0005). Todo existe en `APIv2.json`.
- «Volver»: `back()` no cambia, la vuelta a Problemas (v0.9.0) sigue igual; CA5 se cumple (`MANUAL`, y el
  e2e cuenta las consultas de los tres canales).
- Franja: tramos como `<button>` (Tab y Enter), tooltip con foco, color nunca solo, aviso con
  `MarkerError`; tramos recortados, abiertos hasta el final, 3 filas y «+N». Sin datos del tenant.
- Opcionales: no pedir la lista sin acceso a Métricas (`ServiceEntityPage.tsx:34`); un texto propio de
  la franja en el aviso de error (`ProblemBand.tsx:46-58`).

## Verificación

**Tests (commit `e78dae2`).** Fallan porque el código aún no existe, no por el propio test
(vitest: no hay implementación de `entities:problems` en `createModuleHandlers`, no existe
`./problem-band` y faltan `entities.service.problemBand.*`; e2e: no aparece
`service-problem-band` ni se pide la lista). Los e2e de la 0006 a la 0009 siguen en verde (15/15)
con el simulador ampliado.

- CA1 → `src/main/ipc/handlers/entity-problem-list.test.ts`, describe «CA1 (0010)» (una sola
  petición con `affectedEntities("<id>")` como único criterio, `pageSize=100`, `sort=-startTime`;
  rangos relativos y absoluto; id no válido sin petición; los siete campos exactos, `-1` y `null`
  → `null`; `truncated` con `totalCount` mayor, sin pedir más páginas; lista vacía).
- CA2 → mismo fichero, describe «CA2 (0010)» (dos elementos rotos en `invalid` y el resto llega;
  un 400 con `reason` de `errorReasonKeys`).
- CA3 → `src/renderer/src/pages/entities/problem-band.test.ts`, describes «CA3 (0010)» (recorte
  por los dos lados, fuera del rango sin tramo, abiertos hasta el final, filas sin solapes, como
  mucho 3, «+N» = los que no caben).
- CA4 → `e2e/views.spec.ts`, «CA4 (0010): en la página de un SERVICE con un problema abierto y
  uno cerrado…» (consulta del simulador, `data-status` y nombre accesible, posición en la franja,
  tooltip con ratón y con foco).
- CA5 → `e2e/views.spec.ts`, «CA5 (0010): pulsar un tramo (y Enter con el foco)…» (clic en el
  cerrado y Enter en el abierto; «Volver» (`problem-back`) a `/entities/SERVICE/<id>` sin consultas
  nuevas de los tres canales).
- CA6 → `e2e/views.spec.ts`, «CA6 (0010): sin problemas en el rango no hay franja ni hueco…» y
  «CA6 (0010): si el canal de la lista falla…» (`sim.entityProblemListFail`; aviso y Reintentar en
  la franja, el gráfico con su serie, los marcadores de problemas siguen; Reintentar recupera).
- CA7 → `src/main/modules/problems-entity-count.live.test.ts`, «CA7 (0010): la lista con
  affectedEntities y rango…» (y el de fugas pasa a «CA5 (0007) y CA7 (0010)»). Ejecutada el
  2026-10-07: 4/4 en verde, 17 peticiones de lectura, sin token en el log ni valores del tenant
  en el informe. Con tres entidades de la muestra (SERVICE, ENVIRONMENT y
  PROCESS_GROUP_INSTANCE): 200, `totalCount` llega, sin recortes ni elementos fuera del esquema,
  orden de más nuevo a más antiguo, todos afectan a la entidad, abiertos con `endTime` `-1`
  (ninguno `null`) y cerrados con fin no anterior al inicio.
- CA8 → `src/renderer/src/locales/problem-band.test.ts`, describe «CA8 (0010)».

**Nombres que fijan los tests (la ficha no los daba).**

- Canal `entities:problems` en `createModuleHandlers` (añadido a `channel-coverage.test.ts` y a
  «todos los canales» de `modules.test.ts`). Salida `{ problems, totalCount, truncated, invalid }`,
  cada problema con exactamente los siete campos de la ficha.
- `src/renderer/src/pages/entities/problem-band.ts`: `problemBandLayout(problems, { from, to })`
  (ms) → `{ segments, overflow }`; cada tramo con `problemId`, `start`, `end` (recortados) y
  `row` (0-2); `overflow` = problemas del rango sin dibujar (el «+N»).
- Textos en `entities.service.problemBand` de common: `active` («Activo»), `more` (con
  `+{{count}}`) y `truncated`.
- Testids: franja `service-problem-band` dentro del panel `error-rate`; tramos
  `service-problem-segment` con `data-problem-id` y `data-status` (`open`/`closed`), enfocables y
  con «Abierto»/«Cerrado» en el nombre accesible; tooltip `service-problem-tooltip` con id visible,
  título, estado, horas de inicio y fin (HH:MM, `es-ES`) o «Activo». Con el canal caído, la franja
  sigue con `role="alert"` y «Reintentar».
- «Ni hueco» (CA6): el gráfico de tasa de error empieza a la misma altura en su panel y mide lo
  mismo que el de Errores.
- Simulador: las consultas con `affectedEntities` y sin `status` van a
  `sim.entityProblemListQueries` (las de recuentos siguen en `entityProblemQueries`);
  `SVC_BAND_ID` (`…E2E04`, un abierto y un cerrado contados desde `sim.bandNow`) y
  `SVC_QUIET_ID` (`…E2E05`, sin problemas), con las métricas de `SVC_ID`.

**Decisiones del developer.**

- Error: un rechazo de Dynatrace (400, por ejemplo) sale con el motivo nuevo
  `entityProblemListRejected` (`src/shared/error-reasons.ts`, es y en), como el de los recuentos.
- `truncated`: la página trae `nextPageKey` o `totalCount` es mayor que lo recibido (válidos más
  `invalid`); una sola petición (`paginate` con `maxPages: 1`). El esquema de cada elemento
  (`entityProblemItemSchema`, `src/main/modules/problems.ts`) valida solo los siete campos y acepta
  `endTime` `null`.
- Filas: en orden de inicio (a igual inicio, el más largo arriba), cada tramo en la primera fila
  libre; tocarse en el borde no es solaparse. Un problema sin duración cuenta si cae en el rango.
- Franja (`pages/entities/ProblemBand.tsx`): alineada con el área de dibujo del gráfico (márgenes
  64 y 16 px del `grid` de `serviceChartOption`); el «+N» va en el hueco del eje Y de la última
  fila. Abiertos en `bg-danger` y cerrados en gris con borde, y siempre icono, id visible y estado
  en el nombre accesible. Mientras carga no ocupa sitio. Fechas del tooltip con `formatDateTime`
  (las de toda la app, que incluyen HH:MM).
- El tramo abre el detalle con el estado `fromList` de `ProblemDetailPage`: así «Volver» va atrás
  en el historial, a la página del servicio, sin pedir otra vez sus datos.
- La franja usa el rango del gráfico (contado desde que llegaron las métricas); sin datos del
  gráfico, el de cuando llegó la lista. «Actualizar» de la página también pide la lista.

### Verifier, 2026-10-07, commit `07e7a49`, rango `main..07e7a49`: VERDE

- check: 2125 tests en 105 ficheros, cobertura ok.
- e2e completo (`ipc.ts` transversal), dos pasadas: 194 pasan y 3 fallan en las dos, los de la 0005 con
  `withContentSize` (CA1, CA2 y CA4; escalado al 150 % de la VPS), que fallan igual en `main`.
- `views.spec.ts -g "0010" --repeat-each 3 --workers=1`: 12/12.

## Resultado

- Commits: `e78dae2` (tests), `8007aea` (canal `entities:problems`), `03ba518` (cálculo de tramos) y
  `7a5e00a` (franja), más los de la ficha y el cierre.
- Ficheros principales: `src/shared/ipc.ts` y `modules.ts`, `src/main/ipc/handlers/modules.ts`,
  `src/main/modules/problems.ts`, `pages/entities/ProblemBand.tsx`, `problem-band.ts`,
  `ServiceCharts.tsx` y `ServiceEntityPage.tsx`, `ProblemDetailPage.tsx`, locales es y en.
- Rondas de revisión: 1 (APROBADO). Verifier en verde. ADR nuevo: ninguno. Sin migraciones.
- Pendiente de Dani: la prueba a mano con un servicio real (ver arriba).
- Con esta ficha queda completo el lote «servicio» (0006 a 0010).
