---
id: '0058'
titulo: 'Páginas de entidad: un solo código para acceso, marcadores, niveles y tablas'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-codigo-comun
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0058-paginas-entidad-codigo-comun
adrs: [4]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Lote «auditoria-codigo-comun» (0057 a 0059), de la revisión de código del 2026-10-09 (hallazgo
M-02). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario.

## Especificación

**El problema.** En `src/renderer/src/pages/entities/`, cuando se hizo la revisión:

- El bloque de acceso y hooks de cada página (unas veinte líneas casi iguales, con la sutileza de
  la ficha 0015: `useConnectionStatusKnown` antes de pedir `entities:get`) estaba copiado en las
  páginas de host, servicio, proceso y monitores.
- Los marcadores de host, proceso y monitores definían cada uno su `LEVEL_CLASS`, `MarkerBody` y
  `BigValue`, con firmas que ya habían divergido; `UsageLevel` (`lib/host-format.ts`) y
  `AvailabilityLevel` (`lib/monitor-format.ts`) eran el mismo tipo.
- Las tablas de host y monitores tenían el mismo `TableCard`, `BAR_CLASS`, `LEVEL_TEXT_CLASS`,
  `NUMBER_CELL`, `compareNullable` y `byNumber`.

Desde entonces se han añadido más páginas (process group, aplicación, disco…): **el developer hace
el inventario de todas** y lo anota.

**Arreglo (sin cambiar nada visible):**

- `pages/entities/entity-access.ts` con `useEntityPageAccess(id, schema)`: entornos, accesos,
  `refresh` y `canFetch`, incluida la espera de la 0015.
- En `EntityMarkers.tsx`: un tipo `Level` compartido, `LEVEL_CLASS` y un solo `MarkerBody`/`BigValue`
  con `testIdPrefix`.
- `EntityTables.tsx` con `TableCard<T>`, las clases comunes y `barWidth`; los comparadores, a
  `@shared/grid-sort.ts` con tests.
- Los `data-testid` (`host-marker-*`, `process-marker-*`, `monitor-marker-*`…) **no cambian**.
- Áreas en `e2e/areas.json` para los ficheros nuevos; `src/renderer/CLAUDE.md` recuerda que un tipo
  nuevo reutiliza estas piezas.

## Criterios de aceptación

- CA1 (unitario): `useEntityPageAccess` (o su lógica pura) da `canFetch` falso hasta conocer el
  estado de la conexión y verdadero después, con y sin scope.
- CA2 (unitario): los comparadores de `@shared/grid-sort.ts` ordenan con `null` al final en los dos
  sentidos.
- CA3 (unitario): un test de guardia falla si una página de entidad vuelve a definir `LEVEL_CLASS`,
  `MarkerBody`, `BigValue` o `TableCard` por su cuenta.
- CA4 (e2e): los e2e de todas las páginas de entidad pasan sin tocar sus expectativas.

## Pruebas a mano para Dani

(ninguna: no cambia nada visible)

## Fuera de alcance

- Cambiar el aspecto de las páginas.

## Ideas surgidas (fuera de alcance)

- (developer) `UsageLevel` (`lib/host-format.ts`), `AvailabilityLevel` (`lib/monitor-format.ts`) y
  `ApdexLevel` (`lib/application-format.ts`) siguen en `lib/`: las páginas ya usan `Level` de
  `EntityMarkers.tsx`, pero unificar los de `lib/` (transversal en `e2e/areas.json`) dispara el e2e
  completo sin cambiar nada; queda para otra ficha pequeña.
- (developer) `ApplicationActions.tsx` y la tabla de instancias del process group pintan su propio
  estado de carga y error: podrían pasar a `TableCard` (con cuidado con sus `data-testid`).
- (developer) `usageBar` (`lib/host-format.ts`) calcula el ancho igual que `barWidth`.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA3 con su test (`3c1dc19`), y fallan sin el código; ningún `*.test.ts(x)` cambia después y
`e2e/` queda intacto (CA4). CA2 fija el orden de antes; `compareNullable` y `byNumber` son el mismo
código que se quitó. `canRefresh` reproduce página por página la condición de antes (host con
`extraEnvs` para los eventos; monitores con `refine` equivalente), sin peticiones nuevas. El HTML de
los marcadores es el mismo salvo `data-level` en `service-marker-value`, que no se ve ni rompe el
e2e. Sin IPC, API, dependencias ni esquema; `src/renderer/CLAUDE.md` al día.

Sugerencias, no bloquean:

1. `canFetch` no lo usa ninguna página todavía: decirlo en el comentario de `EntityPageEnvs` para que
   nadie lo tome por la condición de «Actualizar».
2. Los tres `eslint-disable react-refresh` son los primeros del repo; `BAR_CLASS` y `barWidth`
   podrían ir a un `entity-tables.ts`, como `host-tables.ts` (a "Ideas surgidas").

## Verificación

Tests de los criterios en el commit `3c1dc19` (fallan hasta que exista el código):

- CA1 → `src/renderer/src/pages/entities/entity-access.test.ts` (`CA1 (0058): …`).
- CA2 → `src/shared/grid-sort.test.ts`, `describe` `CA2 (0058): compareNullable y byNumber…`.
- CA3 → `src/renderer/src/pages/entities/entity-shared-pieces.test.ts` (`CA3 (0058): …`).
- CA4 → los e2e existentes de las páginas de entidad, sin tocar.

Inventario comprobado en `main` antes de los tests: siguen las copias del bloque de acceso en host,
servicio, proceso, process group, monitores, disco y aplicación web; `LEVEL_CLASS`, `MarkerBody` y
`BigValue` en los marcadores de host, proceso, process group, disco, monitores y aplicación
(`BigValue` también en servicio y `LEVEL_CLASS` en `ApplicationUserSections.tsx`); `TableCard` en
`HostTables.tsx` y `MonitorTables.tsx`; `compareNullable` en `host-tables.ts`, `monitor-tables.ts`,
`process-group-instances.ts` y `application-actions.ts`.

Decisiones del test-writer (Dani las delegó; refinables):

- **CA1, lógica pura:** `resolveEntityPageAccess({ id, metrics, problems, entities, statusKnown })`
  en `entity-access.ts` → `{ metricsEnv, problemsEnv, entitiesEnv, canFetch }` (el hook
  `useEntityPageAccess(id, schema)` la usa). Siguiendo el criterio al pie de la letra, `canFetch`
  es falso hasta conocer el estado aunque metrics o problems estén disponibles (hoy el botón
  «Actualizar» sale antes); `entitiesEnv` sigue siendo `null` hasta entonces.
- **CA2 contradice «sin cambiar nada visible»:** hoy `compareNullable` pone sin dato por debajo de
  todo y `sortRows` invierte el comparador, así que `null` va al final en descendente y al
  principio en ascendente. Hacerlo «al final en los dos sentidos» cambiaría el orden ascendente de
  las tablas. Se fija el comportamiento de hoy (`compareNullable(a, b)` y `byNumber(value)`
  exportados de `@shared/grid-sort`). Si Dani quiere `null` al final siempre, es otra ficha.
- **CA3:** el guardia exige `export` de `LEVEL_CLASS`, `MarkerBody` y `BigValue` en
  `EntityMarkers.tsx` y de `TableCard` en `EntityTables.tsx`, y que ningún otro `.ts`/`.tsx` de
  `pages/entities/` los defina (incluidos servicio, aplicación y `ApplicationUserSections.tsx`). El
  tipo `Level` común tiene que admitir `success` (Apdex).

## Resultado

Commits del developer: `c349ff1` (comparadores a `@shared/grid-sort`), `e91a399`
(`useEntityPageAccess`), `55a93cf` (marcadores), `c27ca1a` (tablas) y el de la documentación.

Inventario (developer, al empezar): el del test-writer en «Verificación», más `NUMBER_CELL` en
`ProcessGroupInstancesTable.tsx` y `ApplicationActions.tsx`. Las páginas de entorno, genérica,
aplicación cloud y los envoltorios de browser y HTTP monitor (usan `MonitorEntityPage`) no tenían
copia.

Decisiones del developer (Dani las delegó; refinables):

- **«Actualizar» no depende de `canFetch`.** `resolveEntityPageAccess` da además `canRefresh`, la
  condición de antes (id válido y metrics, problems o entities —este, ya con el estado— con acceso),
  y las páginas enseñan el botón con él: sale igual que antes. `canFetch` queda como pide CA1
  (estado de la conexión conocido) y por ahora ninguna página lo usa.
- **El estado de la conexión se espera con el entorno de cualquier módulo con acceso** (entities y,
  si no, metrics o problems): con entities sin scope, `useConnectionStatusKnown(null)` sería
  siempre falso y `canFetch` no llegaría a verdadero. Es la misma consulta `connection:status`
  (misma clave): no hay peticiones nuevas.
- **Host:** los eventos (0042) entran como `extraEnvs` del hook, para «Actualizar» y su entorno,
  como antes.
- **Monitores:** el esquema de cada tipo es `monitorEntityIdSchema.refine(prefijo)`, en
  `MonitorEntityPage.tsx`.
- **Marcadores:** un solo `MarkerBody` con `caption` (opcional, con `captionTestId`: en la
  aplicación la línea bajo el valor era `application-marker-secondary` y se conserva), `levelText` +
  `level`, `secondary` con `secondaryLevel` opcional (solo monitores, que siguen llevando
  `data-level` en todas sus líneas secundarias) y `extra`. El HTML es el de antes salvo
  `service-marker-value`, que ahora lleva `data-level` (`normal` o `error`); color y texto, iguales.
- **`LEVEL_CLASS`, `BAR_CLASS` y `barWidth`** se exportan desde los `.tsx`, como piden la ficha y
  el test de guardia, con `react-refresh/only-export-components` desactivado en esa línea y su
  motivo. El color del texto de las tablas es `LEVEL_CLASS` (el `LEVEL_TEXT_CLASS` de antes tenía
  los mismos valores).
- **`e2e/areas.json` no cambia:** `src/renderer/src/pages/**` (área `views`) ya cubre
  `entity-access.ts` y `EntityTables.tsx`, y `src/shared/grid-sort.ts` ya estaba.
