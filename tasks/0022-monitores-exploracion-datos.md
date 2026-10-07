---
id: '0022'
titulo: 'Monitores (browser y HTTP): análisis de métricas en vivo y canal de series y marcadores'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0022-monitores-exploracion-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector` con comodín `builtin:synthetic.browser.*` y `builtin:synthetic.http.*`, `fields`), `GET /metrics/{metricId}` y `GET /metrics/query`; `GET /entities/{entityId}` (de la 0014) para SYNTHETIC_TEST y HTTP_CHECK; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read` (ya en uso) y `entities.read` (0014).
migracion: no
rondas_revision: 0
---

## Petición original

Lotes «monitores» (0022 a 0026) y «proceso» (0027 a 0029). Dani:

"Haz lo mismo ahora con PROCESS_INSTANCE, SYNTHETIC_TEST y HTTP. Ten en cuenta que cada entidad tiene
sus métricas «clave». Por ejemplo, SYNTHETIC_TEST tiene disponibilidad, rendimiento, localizaciones,
pasos… Haz un análisis de las métricas y determina cuáles son las idóneas para mostrar en su página
principal."

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

**Las dos páginas de monitor van juntas.** Browser monitor (`SYNTHETIC_TEST`) y HTTP monitor
(`HTTP_CHECK`) tienen la misma forma (disponibilidad, duración, ejecuciones, localizaciones y pasos o
peticiones), así que comparten canal y componentes; cambia el catálogo de métricas de cada uno.

**Análisis de métricas (lo que pidió Dani).** El Planificador no puede consultar el catálogo de
métricas del tenant: el análisis es el **paso 0** de esta ficha, con una regla fija para elegir y el
resultado anotado en la ficha.

1. **Catálogo:** `GET /metrics?metricSelector=builtin:synthetic.browser.*` y
   `…=builtin:synthetic.http.*` (la OpenAPI admite el comodín final), con `fields` de unidad,
   dimensiones y agregaciones. Son métricas integradas de Dynatrace: sus claves pueden ir al
   informe y a la ficha.
2. **Con datos:** para 3 monitores de cada tipo sacados de los problemas de los últimos 7 días (o de
   `GET /entities?entitySelector=type("SYNTHETIC_TEST")` / `type("HTTP_CHECK")` con `pageSize` 3),
   qué métricas del catálogo tienen datos en `now-24h` y con qué dimensiones
   (`dt.entity.synthetic_location`, pasos o peticiones) y si `dimensionMap` trae sus nombres.
3. **Elección**, por papel y en este orden de preferencia (la primera del catálogo que tenga datos):

| Papel                      | Qué se busca (browser / HTTP)                                                     |
| -------------------------- | --------------------------------------------------------------------------------- |
| Disponibilidad             | disponibilidad total por localización (%), sin y con ventanas de mantenimiento    |
| Duración                   | duración total de la ejecución (ms)                                               |
| Ejecuciones                | ejecuciones correctas y fallidas (recuento)                                       |
| Por localización           | disponibilidad y duración con la dimensión de localización                        |
| Por paso / petición        | duración por paso (browser) o por petición (HTTP)                                 |
| Rendimiento (solo browser) | métricas de experiencia: LCP, visually complete, CLS o speed index (las que haya) |
| Respuesta HTTP (solo HTTP) | código de estado o tiempos de DNS/TCP/TLS, si existen                             |

Una métrica sin datos en los monitores de muestra no se usa. Si un papel se queda sin métrica,
ese marcador o gráfico no se pinta y se anota. La tabla final (papel → clave de métrica, unidad,
agregación) va a "Resultado" y a `docs/notas-api-v2.md`.

4. **Entidad (la fuente de los datos del monitor, decisión de Dani):** con
   `GET /entities/{entityId}` de los monitores de muestra y `fields` con `+properties`, relaciones,
   `+firstSeenTms` y `+lastSeenTms`, qué `properties` y relaciones traen (nombres de clave, nunca
   valores): en especial, si vienen frecuencia, si está activo, tipo de monitor, localizaciones,
   pasos o peticiones y la aplicación monitorizada. Es lo que usa la tarjeta de la 0026.

Informe solo de comportamientos, sin ids ni nombres de monitores, localizaciones o pasos.

**Canal `entities:monitorMetrics`** (Zod en `src/shared/ipc.ts`), con el patrón de
`entities:serviceMetrics`:

- Entrada: `environmentId`, `entityId` (`^(SYNTHETIC_TEST|HTTP_CHECK)-[0-9A-F]{16}$`) y
  `timeRange`. El tipo sale del id; main elige el catálogo y construye los selectores.
- Dos consultas: series y marcadores (rango completo), como el servicio.
- Salida: `kind` (`browser` | `http`), `series` por papel (`availability`, `duration`,
  `executions` con `ok` y `failed`, y `performance` o `httpTimings` si hay) y `totals`
  (disponibilidad del rango, duración media y mediana, ejecuciones correctas y fallidas). Los papeles
  sin métrica llegan como `null`.
- Errores con `reason`; sin datos, series vacías. El simulador de los e2e responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe trae el catálogo de cada tipo, qué métricas tienen datos y
  con qué dimensiones, y las claves de la entidad, sin ids ni nombres. Se salta sin
  `.env.live.local`.
- CA2 (unitario, shared): el esquema acepta ids de SYNTHETIC_TEST y HTTP_CHECK y rechaza otros tipos
  y caracteres como `"`, `)` o `,`.
- CA3 (unitario, main): con `fetch` simulado, un id de cada tipo produce las consultas de su
  catálogo, con el id y el rango.
- CA4 (unitario, main): la transformación por papel, con un papel sin métrica (`null`) y `null`
  conservados en las series.
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin datos → series vacías.
- CA6 (e2e): el simulador responde a los dos tipos y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0024)

## Fuera de alcance

- La API v1 de sintéticos (`GET /synthetic/monitors/{monitorId}`): Dani prefiere los datos de
  `/entities` (2026-10-07). El script del monitor no se enseña.
- Ejecuciones a demanda y el detalle de la última ejecución.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
