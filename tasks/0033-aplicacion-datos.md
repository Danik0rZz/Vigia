---
id: '0033'
titulo: 'APPLICATION: análisis de métricas en vivo y canal de series y marcadores'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0033-aplicacion-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:apps.web.*`), `GET /metrics/{metricId}` y `GET /metrics/query`; `GET /entities/{entityId}` (0014); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion» (0033 a 0035). Dani (2026-10-09): "Haz lo mismo para … Application". La
petición completa está en la ficha 0031.

## Especificación

**Qué es:** `APPLICATION` es una aplicación web con monitorización de usuario real (RUM). Sus
métricas clave son las de experiencia: Apdex, acciones de usuario y su duración, errores y
sesiones.

**Análisis de métricas (paso 0, en vivo y solo lectura),** con la regla de la 0022: catálogo
`GET /metrics?metricSelector=builtin:apps.web.*` (unidad, dimensiones y agregaciones), cuáles tienen
datos en `now-24h` para 3 aplicaciones (de los problemas de 7 días o `type("APPLICATION")` con
`pageSize` 3) y elección por papel, la primera con datos:

| Papel               | Qué se busca                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| Apdex               | Apdex de la aplicación                                                  |
| Acciones            | número de acciones de usuario                                           |
| Duración            | duración de las acciones (mediana o media; visually complete si existe) |
| Errores             | errores de JavaScript y de peticiones (recuento o tasa)                 |
| Sesiones o usuarios | sesiones o usuarios activos, si existen                                 |
| Por acción          | duración y recuento con la dimensión de acción de usuario               |

Lo que no tenga métrica no se pinta y se anota. Tabla final en "Resultado" y en
`docs/notas-api-v2.md`; claves de `properties` y relaciones de la entidad (solo nombres) para la
tarjeta.

**Canal `entities:applicationMetrics`** (Zod):

- Entrada: `environmentId`, `entityId` (`^APPLICATION-[0-9A-F]{16}$`) y `timeRange`.
- Salida: `series` por papel (`apdex`, `actions`, `duration`, `errors`, `sessions`), `totals` del
  rango y `topActions`: las 10 acciones con más volumen, con `id`, `name`, recuento y duración
  media (los papeles sin métrica, `null`).
- Errores con `reason`. El simulador de los e2e responde.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe trae el catálogo, qué métricas tienen datos y con qué
  dimensiones, y las claves de la entidad, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de APPLICATION y rechaza otros.
- CA3 (unitario, main): con `fetch` simulado, las consultas llevan las métricas elegidas, el id y
  el rango.
- CA4 (unitario, main): transformación por papel y de las 10 acciones, con papeles `null`.
- CA5 (unitario, main): 400 o 404 → error con `reason`.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0035)

## Fuera de alcance

- Aplicaciones móviles y personalizadas, y sesiones de usuario una a una (session replay).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
