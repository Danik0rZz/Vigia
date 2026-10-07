---
id: '0007'
titulo: 'SERVICE: problemas abiertos y cerrados de la entidad en el rango'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0007-servicio-problemas
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /problems` con `problemSelector` (`affectedEntities("id")` y `status("open")` / `status("closed")`), `from`, `to` y `pageSize`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `problems.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio» (0006 a 0010). De la petición de Dani: en los marcadores de arriba de la página del
servicio, "problemas abiertos y cerrados para esa entidad
(`/api/v2/problems?problemSelector=affectedEntities("<id>")`), ligada al timeframe seleccionado en la
aplicación". La petición completa está en la ficha 0006.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote:** tiempos con **mediana**, p90 y p99 (no la
media); OK = total − KO; marcador de tasa de error del rango (KO / total); la franja de problemas
sobre la tasa de error va en este lote (ficha 0010). Dani autoriza las lecturas de solo lectura del
tenant de pruebas que hagan falta para validar (`npm run test:live`).

**Canal IPC nuevo `entities:problemCounts`** (en `src/shared/ipc.ts`, con Zod):

- Entrada: `environmentId`, `entityId` y `timeRange` (el rango global). `entityId` se valida con
  `^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$` (cualquier tipo estándar; vale para otras páginas de entidad
  más adelante). Main construye el selector; la interfaz no manda selectores.
- Main hace **dos** `GET /problems` con `pageSize=1` y usa `totalCount`:
  `problemSelector=affectedEntities("<id>"),status("open")` y lo mismo con `status("closed")`, con
  el `from`/`to` del rango (como `problems:list`). La OpenAPI dice que los criterios separados por
  comas se combinan y que `status` admite un solo valor. Si la API no diera `totalCount`, el número
  sale como `null` ("—" en la interfaz), no como 0.
- Salida: `{ open: number | null, closed: number | null }`.
- **Prueba en vivo (solo lectura)** en el mismo test del paso 0 de la 0006 o en uno propio
  (`problems-entity-count.live.test.ts`): que `affectedEntities` combinado con `status` da 200, que
  `totalCount` llega con `pageSize=1` y que coincide con contar la lista. Solo comportamientos en el
  informe.
- Errores con `reason` (ADR-0005). Sin refresco solo (ADR-0004).
- El simulador de los e2e responde a estas consultas.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, shared): el esquema acepta ids estándar (`SERVICE-…`, `HOST-…`,
  `PROCESS_GROUP_INSTANCE-…` con 16 hexadecimales) y rechaza minúsculas, tipos personalizados con
  `:` y caracteres como `"`, `)` o `,`.
- CA2 (unitario, main): con `fetch` simulado, dos peticiones a `/problems` con `pageSize=1`,
  `problemSelector` con `affectedEntities("<id>")` y `status("open")` o `status("closed")`, y el
  `from`/`to` del rango pedido (relativo y absoluto).
- CA3 (unitario, main): los `totalCount` llegan como `open` y `closed`; sin `totalCount`, `null`.
- CA4 (unitario, main): un 400 de Dynatrace acaba en error con `reason`.
- CA5 (live, solo lectura): el informe dice si la combinación funciona y si `totalCount` coincide,
  sin ids ni nombres. Se salta sin `.env.live.local`.
- CA6 (e2e): el simulador responde y un test por IPC recibe los recuentos esperados de un id
  inventado.

## Pruebas a mano para Dani

(en la 0008)

## Fuera de alcance

- La lista de esos problemas o ir a Problemas filtrada por la entidad.
- Problemas en los que la entidad es solo causa raíz o impactada (solo `affectedEntities`, como
  pidió Dani).

## Ideas surgidas (fuera de alcance)

(ninguna)

**Decisiones del developer.** Un rechazo de Dynatrace sin motivo (400 y demás códigos HTTP) se
relanza con el motivo nuevo `entityProblemsRejected` (es y en), con el código y el texto de
Dynatrace como parámetros. El id y el selector están en `entityIdSchema` (`src/shared/modules.ts`)
y `entityProblemSelector` (`src/main/modules/problems.ts`). El canal se añade a la lista de
`channel-coverage.test.ts` (inventario de canales de módulos, no es un test de la ficha). Al
pasar a revisión se reparó esta ficha: el commit `1cd5eb5` había metido la ficha entera dentro
de "Verificación" (un dólar de la expresión regular tomado como patrón de reemplazo). En el e2e
completo (2026-10-07) fallan 3 tests de la 0005 con `withContentSize` (contenido de 960×602 en vez
de 960×600); fallan igual compilando `main`, así que vienen de la VPS, no de esta ficha.

## Notas del revisor

(sin revisar)

## Verificación

**Tests (commit `98fc24e`).** Fallan por falta del canal, no por el propio test (vitest: «canal
entities:problemCounts» / «implementación de entities:problemCounts» indefinida; e2e:
`UNKNOWN_CHANNEL`).

- CA1 → `src/shared/ipc-problem-counts.test.ts`, describe «CA1 (0007): entrada de
  entities:problemCounts»; y en main, `src/main/ipc/handlers/entity-problems.test.ts`, «CA1 (0007):
  main solo pide con un id válido» (id malo → `INVALID_INPUT` y ninguna petición).
- CA2 → `entity-problems.test.ts`, describe «CA2 (0007): dos peticiones a /problems con
  pageSize=1, el selector y el rango» (2h, 24h, 7d y absoluto; criterios comparados como conjunto,
  sin orden fijo; solo `affectedEntities` y `status`).
- CA3 → el mismo fichero, «CA3 (0007): los totalCount llegan como open y closed» (0 es 0; sin
  `totalCount`, `null`, también en una sola de las dos).
- CA4 → el mismo fichero, «CA4 (0007): un 400 de Dynatrace acaba en error con reason» (las dos o
  solo una petición con 400; `reason.key` de `errorReasonKeys`, sin fijar cuál).
- CA5 → `src/main/modules/problems-entity-count.live.test.ts`, «CA5 (0007): el informe no
  contiene ningún id ni nombre observado» (se salta sin `.env.live.local`).
- CA6 → `e2e/views.spec.ts`, «CA6 (0007): entities:problemCounts por IPC con un id inventado…»
  (simulador: `entityCountProblems`, ids `SERVICE-00000000000E2E07` con 2 abiertos y 3 cerrados y
  `HOST-00000000000E2E70` sin problemas; con `affectedEntities` respeta `pageSize` y da el
  `totalCount` real).
- Además, `modules.test.ts` («todos los canales de módulos») llama al canal nuevo.

**Nombres que fijan los tests (la ficha no los daba).** El canal se implementa en
`createModuleHandlers` (`src/main/ipc/handlers/modules.ts`), como `entities:serviceMetrics` de
la 0006. Salida exacta `{ open, closed }` (`toEqual`, sin más campos). Un id inválido se
rechaza en la frontera IPC con `INVALID_INPUT`.

**Prueba en vivo (2026-10-07, solo lectura, 14 GET; informe en
`live-reports/problems-entity-count.json`).** Muestra de 3 entidades afectadas por problemas de 7
días (tipos SERVICE, SYNTHETIC_TEST y CLOUD_APPLICATION), con `status("open")` y
`status("closed")`:

- `affectedEntities("<id>"),status("…")` con `pageSize=1` da 200 en los 6 casos; `totalCount`
  llega siempre y la página trae como mucho 1 problema.
- `totalCount` coincide con contar la lista completa con el mismo selector y con filtrar a mano
  la lista de 7 días (estado y entidad afectada) en los 6 casos; todos los devueltos tienen el
  estado pedido y afectan a la entidad (la combinación es AND).
- Todos los ids de entidades afectadas de la lista cumplen el formato del canal
  (`^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$`).

- `tokenEnLog: false`; ningún id ni nombre en el informe.

## Resultado

(pendiente)
