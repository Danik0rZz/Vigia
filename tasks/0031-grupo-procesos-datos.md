---
id: '0031'
titulo: 'PROCESS_GROUP: análisis de métricas en vivo y canal de series, marcadores e instancias'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0031-grupo-procesos-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:tech.generic.*`), `GET /metrics/{metricId}`, `GET /metrics/query` (`entitySelector` con `fromRelationships`/`toRelationships`) y `GET /entities`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lotes «grupo-procesos» (0031 y 0032) y «aplicacion» (0033 y 0034). Dani (2026-10-09): "Haz lo
mismo para process_group, Application", como con SERVICE, HOST, los monitores y el proceso.

## Especificación

**Qué es:** un process group agrupa las instancias de un mismo proceso (`PROCESS_GROUP_INSTANCE`)
en uno o varios hosts. Su página enseña el conjunto y deja ir a cada instancia.

**Paso 0, en vivo y solo lectura** (patrón de `process-metrics-explore.live.test.ts`, 3 grupos de
los procesos de los hosts de los problemas de los últimos 7 días; informe sin ids ni nombres):

- qué métricas que ya usa la página del proceso (0027) se pueden pedir para el grupo: con
  `entitySelector=type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<id>"))`
  (o la relación que confirme la exploración) y `splitBy()` para el total del grupo, y con
  `splitBy("dt.entity.process_group_instance")` por instancia;
- si `dimensionMap` trae el nombre de la instancia y cómo saber su host (relación de la entidad o
  dimensión `dt.entity.host`);
- tramos de número de instancias por grupo.

**Canal `entities:processGroupMetrics`** (Zod), con el patrón de `entities:processMetrics`:

- Entrada: `environmentId`, `entityId` (`^PROCESS_GROUP-[0-9A-F]{16}$`) y `timeRange`.
- Salida: `series` del grupo (CPU total de las instancias en %, memoria total en bytes, red de
  entrada y salida) y `totals` (CPU media y máxima, memoria media, red media); más `instances`:
  por instancia, `id`, `name`, `hostId`/`hostName` si los da la exploración, CPU media y memoria
  media, ordenadas por CPU, con `total`.
- Los papeles sin métrica, `null`. Errores con `reason`. El simulador de los e2e responde.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice qué selector funciona para el grupo y por instancia y si
  llegan nombres y hosts, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de PROCESS_GROUP y rechaza otros.
- CA3 (unitario, main): con `fetch` simulado, las consultas llevan las métricas, el selector
  confirmado, el id y el rango.
- CA4 (unitario, main): transformación de series, totales e instancias (ordenadas por CPU, `total`,
  papeles `null`).
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin datos → series e instancias vacías.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0032)

## Fuera de alcance

- La vista (0032). Métricas de tecnología (JVM, .NET…).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
