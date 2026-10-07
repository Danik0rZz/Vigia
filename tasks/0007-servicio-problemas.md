---
id: '0007'
titulo: 'SERVICE: problemas abiertos y cerrados de la entidad en el rango'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
