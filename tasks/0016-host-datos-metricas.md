---
id: '0016'
titulo: 'HOST: exploración en vivo de las métricas y canal de series y marcadores (CPU, memoria, red y disco)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0016-host-datos-metricas
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/{metricId}` (descriptor), `GET /metrics` (`text`, para buscar una alternativa si una candidata no existe) y `GET /metrics/query` (`metricSelector`, `entitySelector`, `resolution`, `from`, `to`); `..\API\Dynatrace Environment APIv2\APIv2.json`. Transformaciones en "Metrics selector transformations" (documentación oficial). Scope `metrics.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host» (0016 a 0020). Dani:

"Ahora que tenemos montada parcialmente la página de SERVICE, vamos a ir a por la de HOST. Ten en
cuenta que HOST es un elemento de infraestructura con muchos elementos: disco, red, memoria, CPU,
procesos… Ve planteando la vista y a ver si eres capaz de localizar por ti mismo las métricas
necesarias para poder graficarlo y poner las cajitas igual que tenemos en la vista de SERVICE.
También sería interesante hacer lo mismo que con services: consultar la entidad y sacar la
información relevante."

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

**Vista del lote** (cada parte en su ficha): marcadores arriba y cuatro gráficos (0018), discos y
procesos en tablas (0017 los datos, 0019 la vista) y tarjeta «Información» del host (0020). Todo
ligado al rango global, sin refresco solo (ADR-0004), como el servicio.

**Métricas candidatas** (métricas integradas que documenta Dynatrace; el Planificador no ha podido
comprobarlas en vivo: **el paso 0 las confirma una a una**, y ninguna se usa sin confirmar):

| Para            | Candidata                                                                           | Unidad esperada |
| --------------- | ----------------------------------------------------------------------------------- | --------------- |
| CPU total       | `builtin:host.cpu.usage`                                                            | %               |
| Desglose de CPU | `builtin:host.cpu.user`, `builtin:host.cpu.system`, `builtin:host.cpu.iowait`       | %               |
| Carga           | `builtin:host.cpu.load`                                                             | sin unidad      |
| Memoria         | `builtin:host.mem.usage` (%) y `builtin:host.mem.used`, `builtin:host.mem.total`    | %, bytes        |
| Red             | `builtin:host.net.nic.trafficIn` y `builtin:host.net.nic.trafficOut` (por interfaz) | bits/s          |
| Disco (uso)     | `builtin:host.disk.usedPct` (por disco)                                             | %               |

**Paso 0, exploración en vivo (solo lectura),** con el patrón de
`service-metrics-explore.live.test.ts`: 3 hosts sacados de los problemas de los últimos 7 días
(nunca se guarda un id ni un nombre), con `now-2h` y `now-7d`:

- el descriptor de cada candidata: si existe, `unit`, `defaultAggregation`, `aggregationTypes`,
  `resolutionInfSupported`, dimensiones y si admite `fold`;
- si una candidata no existe (404), se busca con `GET /metrics?text=` la integrada equivalente y se
  anota; si no hay, se quita de la vista y se dice en "Resultado";
- que una consulta con todas las series (≤ 10 expresiones) con `entitySelector=entityId("<id>")`
  da 200, en qué orden vuelven y si red y disco llegan con una serie por interfaz o disco;
- para los marcadores, `resolution=Inf` frente a `:fold(avg)` y `:fold(max)`;
- nulos, `resolution` devuelta y ratios recortados.

El informe guarda solo comportamientos. Lo que salga va a "Resultado" y a
`docs/notas-api-v2.md` (doc-writer).

**Canal `entities:hostMetrics`** (Zod en `src/shared/ipc.ts`), como `entities:serviceMetrics`:

- Entrada: `environmentId`, `entityId` (`^HOST-[0-9A-F]{16}$`) y `timeRange`. Main construye los
  selectores; la interfaz no manda ninguno.
- Dos consultas: **series** (una para todo, con la resolución de la API) y **marcadores** (rango
  completo).
- Series: `cpu` (total) y `cpuBreakdown` (`user`, `system`, `iowait`), `memory` (%), `network`
  (`in` y `out`, sumadas todas las interfaces con `splitBy()`/`fold` según el paso 0) y `disk`
  (el % del disco más lleno en cada punto, `:splitBy():max` o equivalente).
- Marcadores (`totals`): CPU media y máxima del rango; memoria media en % y usada/total en bytes
  (del último punto con dato); red media de entrada y de salida; disco más lleno (máximo del rango,
  en %); carga media si existe.
- Unidades: % en 0–100, bytes y bits/s tal cual (la interfaz los formatea). Fijadas en código y con
  test.
- Errores con `reason` (ADR-0005). Un host sin datos: series vacías y `null`, no error.
- El simulador de los e2e responde con datos inventados.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe del paso 0 sale con los descriptores y comportamientos y sin
  ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta `HOST-` + 16 hexadecimales en mayúsculas y rechaza
  otros tipos, minúsculas y caracteres como `"`, `)` o `,`.
- CA3 (unitario, main): con `fetch` simulado, dos peticiones a `/metrics/query` con las
  expresiones confirmadas, el id del host y el `from`/`to` del rango (relativo y absoluto).
- CA4 (unitario, main): la respuesta simulada se transforma en `series` y `totals` (red sumada,
  disco más lleno, `null` conservados, unidades).
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin resultados → series vacías y `null`.
- CA6 (unitario, main): `warnings` y resultados recortados llegan en `warnings` y `partial`.
- CA7 (e2e): el simulador responde y un test por IPC recibe lo esperado de un id inventado.

## Pruebas a mano para Dani

(en la 0018)

## Fuera de alcance

- Discos y procesos uno a uno (0017 y 0019), la vista (0018) y la información (0020).
- Métricas de tecnologías concretas (JVM, contenedores, Kubernetes) y logs del host.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
