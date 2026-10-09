---
id: '0058'
titulo: 'Páginas de entidad: un solo código para acceso, marcadores, niveles y tablas'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
