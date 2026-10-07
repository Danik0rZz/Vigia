---
id: '0027'
titulo: 'PROCESS_GROUP_INSTANCE: análisis de métricas en vivo y canal de series y marcadores'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: proceso
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0027-proceso-exploracion-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:tech.generic.*` y `builtin:pgi.*`, `fields`), `GET /metrics/{metricId}` y `GET /metrics/query`; `GET /entities/{entityId}` (de la 0014) para PROCESS_GROUP_INSTANCE; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read` y `entities.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «proceso» (0027 a 0029). Dani pidió la página de PROCESS_INSTANCE (en Vigía,
`PROCESS_GROUP_INSTANCE`, «Proceso») con sus métricas clave, después de analizarlas. La petición
completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

**Análisis de métricas (paso 0, en vivo y solo lectura),** con la misma regla que la 0022:

1. **Catálogo:** `GET /metrics?metricSelector=builtin:tech.generic.*` y `builtin:pgi.*`, con unidad,
   dimensiones y agregaciones.
2. **Con datos:** para 3 procesos de los hosts de los problemas de los últimos 7 días (o
   `type("PROCESS_GROUP_INSTANCE")` con `pageSize` 3), qué métricas tienen datos en `now-24h` con
   `entitySelector=entityId("<id>")`.
3. **Elección por papel** (la primera del catálogo con datos):

| Papel          | Qué se busca                                             |
| -------------- | -------------------------------------------------------- |
| CPU            | uso de CPU del proceso (%)                               |
| Memoria        | memoria del proceso (working set o residente, bytes)     |
| Red            | bytes recibidos y enviados (o tráfico) del proceso       |
| Salud de red   | retransmisiones o tiempo de respuesta de red, si existen |
| Disponibilidad | estado o disponibilidad del proceso, si existe           |
| Recursos       | hilos, handles o descriptores de fichero, si existen     |

Lo que no tenga métrica no se pinta y se anota. Métricas de tecnologías concretas (JVM, .NET,
Node…) quedan fuera (ver "Fuera de alcance"). 4. **Entidad:** claves de `properties` y relaciones de los procesos de muestra (solo nombres). **Se
comprueba si alguna clave lleva la línea de comandos o argumentos** (por ejemplo, dentro de
`metadata`): pueden llevar contraseñas y no se enseñan (0029).

Informe solo de comportamientos; la tabla final va a "Resultado" y a `docs/notas-api-v2.md`.

**Canal `entities:processMetrics`** (Zod), con el patrón de `entities:hostMetrics`:

- Entrada: `environmentId`, `entityId` (`^PROCESS_GROUP_INSTANCE-[0-9A-F]{16}$`) y `timeRange`.
- Series y marcadores por papel (`cpu`, `memory`, `network` con `in`/`out`, `networkHealth`,
  `availability`, `resources`); los papeles sin métrica, `null`. Marcadores: CPU media y máxima,
  memoria media y máxima, red media de entrada y salida, y el del papel de disponibilidad o
  recursos si hay.
- Errores con `reason`; sin datos, series vacías. El simulador responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe trae el catálogo, qué métricas tienen datos, las claves de la
  entidad y si alguna lleva línea de comandos, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de PROCESS_GROUP_INSTANCE y rechaza otros.
- CA3 (unitario, main): con `fetch` simulado, las consultas llevan las métricas elegidas, el id y
  el rango.
- CA4 (unitario, main): transformación por papel, con papeles `null`.
- CA5 (unitario, main): 400 o 404 → error con `reason`.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0028)

## Fuera de alcance

- Métricas de tecnología (JVM: heap y GC; .NET; Node.js…): cada una, su ficha si Dani las quiere.
- Logs del proceso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
