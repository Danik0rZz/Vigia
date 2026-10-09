---
id: '0039'
titulo: 'HOST: memoria total y memoria recuperable en el marcador y el gráfico de memoria'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0039-host-memoria-total-recuperable
adrs: [2, 4]
adr_nuevo:
api: v2, `GET /metrics/{metricId}` y `GET /metrics/query` con `builtin:host.mem.total` (confirmada en vivo en la 0016) y `builtin:host.mem.recl` (confirmada en vivo en el paso 0 de la 0039); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host-2» (0039 a 0042). Dani (2026-10-09), sobre la página del host: "Tenemos la de la memoria
en uso, pero creo que es interesante plasmar además la memoria total (`builtin:host.mem.total`) y
`builtin:host.mem.recl` (lee la descripción)", filtradas por el host.

## Especificación

- **Paso 0 (en vivo, solo lectura):** descriptor de `builtin:host.mem.recl` (si existe, unidad,
  agregaciones y su `description`) y que tiene datos en los hosts de muestra de la 0016. Si no
  existe, se busca con `GET /metrics?text=reclaimable` y se anota.
- **Canal `entities:hostMetrics`:** añade a las series `memoryBytes` con `used`, `reclaimable` y
  `total` (bytes), y a los totales la memoria total y la recuperable (último dato).
- **Marcador «Memoria»:** valor principal, el % usado (como hoy); debajo, «usada / total» y
  «recuperable».
- **Gráfico «Memoria»:** pasa a bytes (GB adaptados): usada y recuperable apiladas en área y la
  total como línea discontinua. El % sigue en el tooltip.
- **Qué es la recuperable:** un icono de ayuda junto a la palabra con un tooltip, en es y en,
  redactado a partir de la `description` del descriptor (la memoria que el sistema puede liberar si
  hace falta, como cachés), sin copiarla tal cual si está en inglés.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice si `builtin:host.mem.recl` existe, su unidad y si hay
  datos. Se salta sin `.env.live.local`.
- CA2 (unitario, main): las consultas llevan `builtin:host.mem.total` y la recuperable confirmada,
  y la salida trae `memoryBytes` y los totales nuevos.
- CA3 (e2e): el marcador enseña usada / total y recuperable; el gráfico de memoria tiene las series
  usada, recuperable y total (`data-series`).
- CA4 (e2e): el tooltip de ayuda de «recuperable» sale con el ratón y con el foco.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un host real, que total, usada y recuperable cuadran con Dynatrace.

## Fuera de alcance

- Swap y memoria por proceso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

**Paso 0 (en vivo, solo lectura, 2026-10-09; `src/main/modules/host-memory-explore.live.test.ts`):**
`builtin:host.mem.recl` existe («Memory reclaimable»), unidad `Byte`, agregaciones auto, avg, max
y min (por defecto avg), `resolutionInfSupported`, entidad HOST y una dimensión
`dt.entity.host`. Con datos en los 3 hosts de muestra (una serie por host, el último punto a null,
los mismos puntos que la usada). En los 3: usada + recuperable < total, y usada / total ≈
`mem.usage` (la usada no incluye la recuperable: apilarlas tiene sentido). Las 10 expresiones de
series de la 0016 más la recuperable (11) caben en una consulta (200, 11 resultados), aunque la
OpenAPI dice «up to 10 metrics». La `description` del descriptor: la recuperable es la memoria
disponible (la que se puede usar sin swap) menos la libre.

**Decisiones del test-writer (delegadas, refinables):**

- Salida: `series.memoryBytes = { used, reclaimable, total }` (series en bytes) y
  `totals.memory.reclaimable` (último punto con dato, como `used` y `total`). `series.memory`
  (%) se queda.
- La recuperable va con las series (sustituido por la decisión del Orquestador de abajo: como
  mucho 10 expresiones por consulta).
- Testids: `host-marker-reclaimable` (palabra y valor, dentro de `host-marker-memory`),
  `host-marker-reclaimable-help` (icono enfocable) y `host-marker-reclaimable-tooltip`.
- Orden de las series del gráfico: usada, recuperable, total (`data-series`, en es: «usad…»,
  «…recuperable…» y «…total…»).
- Las claves de i18n no se fijan; CA5 busca por contenido (es: «recuperable», «liberar» y «caché»;
  en: «reclaimable», distinto de es y sin copiar la `description`).
- «Abrir en Métricas» de la memoria no se toca (la ficha no lo dice; sigue con `mem.usage`).

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-09:** se respeta el límite
documentado de la OpenAPI («up to 10 metrics» por consulta), aunque hoy el entorno acepte 11: una
API que tolera más de lo documentado puede dejar de hacerlo sin aviso. Ninguna consulta del canal
lleva más de 10 expresiones; si las series pasan de 10, se parten en dos consultas (tres en total,
en paralelo, casadas por posición). Los tests de CA2 fijan que ninguna petición lleva más de 10
expresiones en `metricSelector`, no el número exacto de consultas.

- No hay criterio para «el % sigue en el tooltip»: no lo cubre ningún test.

**Tests (commits ee987a9 y 6840f0c, este con el límite de 10 expresiones):**

- CA1 → `src/main/modules/host-memory-explore.live.test.ts`, «CA1 (0039): el informe dice si la
  recuperable existe, su unidad y si hay datos…» (se salta sin `.env.live.local`; pasa). La
  prueba de 11 expresiones juntas queda marcada como «exploración», no como la consulta del canal.
- CA2 → `src/main/ipc/handlers/host-metrics.test.ts`, describe «CA2 (0039)» (5 tests): total y
  recuperable una vez cada una entre las consultas de series y acotadas al host; «ninguna
  petición lleva más de 10 expresiones en `metricSelector`»; `memoryBytes` bien casadas aunque
  las series vayan en varias consultas; totales y vacíos. El simulador unitario y el del e2e
  responden 400 con más de 10 expresiones. CA3 (0016) ya no exige dos peticiones: junta las
  expresiones de todas las consultas de series (las 11, una vez cada una) y de marcadores, y
  comprueba el límite; CA4 y CA5 de la 0016 piden la recuperable en los totales.
- e2e que contaban consultas (CA7 de la 0016, CA2 y CA6 de la 0018, CA3 de la 0039): cuentan
  llamadas al canal por la única consulta de marcadores (`resolution=Inf`) y comprueban el límite
  de 10 (`expectHostQueriesWithinLimit`); CA6 (0018) mide las consultas de una llamada y espera
  el doble y el triple.
- CA3 → `e2e/views.spec.ts`, «CA3 (0039): el marcador de memoria enseña usada / total y
  recuperable…»; `HOST_CHART_SERIES.memory` (CA2 y CA7 de la 0018) pasa a tres series; y
  `src/renderer/src/pages/entities/host-charts.test.ts`, describe «CA3 (0039)» (apiladas, total
  discontinua y eje en bytes; los tests de la 0018 de apilado, eje 0–100 y nombres, ajustados).
- CA4 → `e2e/views.spec.ts`, «CA4 (0039): el tooltip de ayuda de «recuperable» sale con el ratón
  y con el foco».
- CA5 → `src/renderer/src/locales/host-page.test.ts`, describe «CA5 (0039)» (3 tests).

Ejecución sin el código: 18 unitarios fallan (faltan `memRecl`, `memoryBytes`, `reclaimable`,
las tres series y los textos; el del límite de 10 pasa hoy, con 10 expresiones, y es la guarda
para cuando se añada la recuperable) y 5 e2e (CA2 y CA7 de la 0018 y CA6 de la 0019: «Memoria
usada» sola; CA3 y CA4 de la 0039: no existen `host-marker-reclaimable` ni su ayuda). CA7 (0016)
y CA6 (0018) pasan con el código actual.

## Resultado

(pendiente)
