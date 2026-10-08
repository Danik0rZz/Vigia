---
id: '0025'
titulo: 'Monitores: tablas de localizaciones y de pasos o peticiones'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0023', '0024', '0019']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0025-monitores-localizaciones-pasos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:monitorBreakdown` de la 0023)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «monitores» (0022 a 0026): "localizaciones, pasos…". La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

Debajo de los gráficos (0024), dos tarjetas (una columna si es estrecha), con las tablas de la app
(como discos y procesos del host, 0019):

- **Localizaciones:** nombre, barra de disponibilidad con su % (mismos colores que el marcador, con
  texto), duración media y ejecuciones fallidas. Ordenada de peor a mejor disponibilidad; orden por
  columna. Al pulsar una localización, los gráficos de arriba **no** cambian (fuera de alcance).
- **Pasos** (browser) o **Peticiones** (HTTP): en su orden, nombre, duración media y una barra con
  su peso en la duración total; el paso más lento resaltado (con texto). Orden por columna.
- Sin métrica de pasos (`steps: null`), la tarjeta no sale. Estados de carga y error por tarjeta.
  Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con 4 localizaciones del simulador, la tabla las enseña de peor a mejor, con su %,
  duración y fallidas.
- CA2 (e2e): con 5 pasos, la tabla de un browser monitor los enseña en orden, con su peso, y marca
  el más lento; en un HTTP monitor la tarjeta se llama «Peticiones».
- CA3 (e2e): con `steps: null`, no sale la tarjeta de pasos y la de localizaciones sí.
- CA4 (e2e): ordenar por otra columna reordena; error del canal → aviso con Reintentar y los
  gráficos siguen.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con monitores reales, que localizaciones y pasos cuadran con Dynatrace y se leen de un vistazo.

## Fuera de alcance

- Filtrar los gráficos por localización o por paso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `fec2154` (`test(monitores): criterios de la ficha 0025 (#0025)`). Al escribirlos
fallan los 4 e2e nuevos (no hay `monitor-locations` ni `monitor-steps` en la página) y los 3
unitarios (no existen `entities.monitor.locations` ni `entities.monitor.steps` en los locales). Los
e2e de la 0023 y la 0024 pasan con el simulador ampliado (8/8).

Tests de CA3 (decisión del Orquestador) en el commit siguiente, `test(monitores): CA3 de la ficha 0025 (#0025)`: e2e con `sim.monitorStepsEmpty` (el desglose sin series de pasos ni de peticiones) en los dos monitores, y unitario de `monitorStepsShown(data)` en `src/renderer/src/pages/entities/monitor-tables.ts` (nombre que fija el test: `false` con `steps: null` o `[]`, `true` con algún paso y con `undefined`, para que la tarjeta enseñe su carga o su error de CA4). Al escribirlos fallan los dos: no hay `monitor-locations` en la página y no existe `./monitor-tables`.

| Criterio | Test                                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0025): con 4 localizaciones, la tabla las enseña de peor a mejor disponibilidad, con su %, su nivel, la duración media y las fallidas`                                                                                                                                                                        |
| CA2      | `e2e/views.spec.ts` › `CA2 (0025): con 5 pasos, la tabla del browser monitor los enseña en su orden, con su duración y su peso, y marca el más lento; en un HTTP monitor la tarjeta se llama «Peticiones»`                                                                                                                                |
| CA3      | `e2e/views.spec.ts` › `CA3 (0025): sin pasos que enseñar (lista vacía del canal), no sale la tarjeta de pasos y la de localizaciones sí` y `src/renderer/src/pages/entities/monitor-tables.test.ts` › `CA3 (0025): la tarjeta de pasos solo sale si hay pasos que enseñar` (`monitorStepsShown`, con `null`, `[]`, un paso y `undefined`) |
| CA4      | `e2e/views.spec.ts` › `CA4 (0025): ordenar por otra columna (nombre en pasos, duración en localizaciones) reordena las filas` y `CA4 (0025): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos siguen`                                                                                                   |
| CA5      | `src/renderer/src/locales/monitor-tables.test.ts` › `CA5 (0025): textos de las tablas de localizaciones y de pasos o peticiones en es y en`                                                                                                                                                                                               |

**Nota sobre CA3 (`steps: null`), a decidir por el Orquestador:** con la decisión de la 0023, el
canal devuelve `steps` siempre como lista (los dos tipos tienen métrica de pasos) y el esquema solo
admite `null` para un tipo que hoy no existe. Desde el simulador (que responde HTTP a main) no hay
forma de que la interfaz reciba `steps: null`, así que el e2e de CA3 no se puede escribir sin
reinterpretarlo. Alternativas: (a) e2e con la lista de pasos vacía (¿tarjeta oculta o «Sin
pasos»?, que la ficha no dice); (b) un unitario del renderer sobre la función que decide si sale la
tarjeta con `steps: null`; (c) dejar CA3 sin test, como la rama `null` de la 0023, hasta que haya un
tipo sin métrica de pasos.

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-08:** (a)+(b). Sin pasos que
enseñar, con `steps: null` o con la lista vacía, la tarjeta de pasos no sale y la de localizaciones
sí. Un e2e con la lista vacía desde el simulador, y un unitario de la función que decide si sale la
tarjeta, con `null` y con `[]`. Ocultarla es lo coherente con el resto de páginas: lo que no tiene
datos no ocupa sitio.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Nombres que fijan los tests:** tarjetas `monitor-locations` y `monitor-steps`, debajo de
  `monitor-charts`, con su título en un encabezado; grids `monitor-locations-grid` y
  `monitor-steps-grid`; filas `monitor-location-row` (`data-location-id`) y `monitor-step-row`
  (`data-step-id`). Columnas: localizaciones `name`, `availability`, `duration` y `failed`; pasos
  `name`, `duration` y `share` (`col-<id>`, `sort-<id>` y `aria-sort`, como en la 0019). Barra de
  disponibilidad `monitor-location-availability` con `data-level` (umbrales de la 0024) y, si no es
  `normal`, texto en `monitor-location-level` (distinto para aviso y error). Barra del peso
  `monitor-step-share`. El más lento: `data-slowest="true"` en su fila y texto en
  `monitor-step-slowest` (solo ahí; sigue tras reordenar).
- **Orden:** localizaciones por disponibilidad ascendente por defecto (`aria-sort` ascending);
  pasos «en su orden» = el que da el canal (por duración, de mayor a menor: la dimensión no trae
  secuencia, 0023); su `aria-sort` por defecto no se fija.
- **Formatos (es):** % con o sin un decimal («90 %» o «90,0 %», «97,5 %»), duración en ms o en s
  con un decimal («1,5 s», «310 ms»), fallidas como número (0 si no hay serie de FAILURE).
- **Textos:** `entities.monitor.locations.{title,columns.*}` y
  `entities.monitor.steps.{titleBrowser,titleHttp,slowest,columns.*}`; títulos «Localizaciones»,
  «Pasos» y «Peticiones».
- **Simulador:** `sim.monitorTables` hace que las páginas de los monitores de la 0024 respondan al
  desglose con `MONITOR_TABLE_DATA`: el HTTP con 4 localizaciones (90, 97,5, 99,5 y 100 %; una sin
  serie de FAILURE) y 2 peticiones (25 y 75 %); el browser con las 3 localizaciones de la 0023 y 5
  pasos (2500, 1200, 800, 300 y 200 ms; pesos 50, 24, 16, 6 y 4 %). Sin la bandera, nada cambia.

## Resultado

(pendiente)
