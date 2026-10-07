---
id: '0023'
titulo: 'Monitores: canal con el desglose por localización y por paso o petición'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0022']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0023-monitores-desglose-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/query` con las métricas por localización y por paso o petición que eligió la 0022; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «monitores» (0022 a 0026). "SYNTHETIC_TEST tiene disponibilidad, rendimiento, localizaciones,
pasos…". La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

**Canal `entities:monitorBreakdown`** (Zod), con las métricas que la 0022 dejó en su tabla para
"Por localización" y "Por paso / petición":

- Entrada: `environmentId`, `entityId` (mismo patrón que la 0022) y `timeRange`.
- Salida:
  - `locations`: por localización, `id`, `name` (del `dimensionMap`; si no viene, el id),
    `availability` (% del rango), `duration` (media, ms) y `failed` (ejecuciones fallidas, si hay
    métrica). Ordenadas de peor a mejor disponibilidad.
  - `steps`: por paso (browser) o petición (HTTP), `id`, `name`, `duration` (media, ms) y su peso en
    la duración total (%), en el orden del monitor si la dimensión lo da (número de secuencia) o por
    duración. Si la 0022 no encontró métrica por paso, `null`.
- Main construye los selectores con el id validado. Errores con `reason`. El simulador responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, main): con `fetch` simulado, las consultas llevan las métricas de la 0022 con su
  `splitBy` por localización y por paso, el id y el rango.
- CA2 (unitario, main): de una respuesta con 4 localizaciones y 5 pasos salen ordenadas por
  disponibilidad y por secuencia (o duración), con el peso de cada paso.
- CA3 (unitario, main): nombres de `dimensionMap`; si faltan, el id. Sin métrica de pasos, `steps`
  es `null`.
- CA4 (unitario, main): 400 o 404 → error con `reason`.
- CA5 (e2e): el simulador responde y un test por IPC recibe lo esperado de los dos tipos.

## Pruebas a mano para Dani

(en la 0025)

## Fuera de alcance

- Mapas de localizaciones o gráficos por localización.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
