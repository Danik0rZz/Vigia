---
id: '0008'
titulo: 'SERVICE: marcadores arriba de la página (peticiones, tiempos y problemas)'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: ['0006', '0007']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0008-servicio-marcadores
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:serviceMetrics` de la 0006 y `entities:problemCounts` de la 0007)
migracion: no
rondas_revision: 2
---

## Petición original

Lote «servicio» (0006 a 0010). "Para tener un cuadro de mandos chulo, podríamos mostrar arriba de la
página a modo de marcadores el total de peticiones OK, KO, tiempos de respuesta y problemas abiertos
y cerrados para esa entidad", ligados al rango de tiempo de la app. La petición completa está en la
ficha 0006.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote:** tiempos con **mediana**, p90 y p99 (no la
media); OK = total − KO; marcador de tasa de error del rango (KO / total); la franja de problemas
sobre la tasa de error va en este lote (ficha 0010). Dani autoriza las lecturas de solo lectura del
tenant de pruebas que hagan falta para validar (`npm run test:live`).

En `ServiceEntityPage.tsx` se quita «Página en construcción» y, debajo de la cabecera
(`EntityPageFrame`), va una fila de **marcadores** (tarjetas con el estilo de las de Inicio):

| Marcador            | Valor                                                       |
| ------------------- | ----------------------------------------------------------- |
| Peticiones OK       | `totals.ok`, con separador de miles                         |
| Peticiones KO       | `totals.errors`, en color de error si es mayor que 0        |
| Tasa de error       | `totals.errorRate` en %, con un decimal                     |
| Tiempo de respuesta | mediana grande y, debajo, p90 y p99 (ms o s según el valor) |
| Problemas           | abiertos (en color de error si > 0) y cerrados              |

- El color nunca es la única señal: siempre hay texto (como en los SLO de Inicio).
- Cada marcador se carga por su lado: mientras carga, un esqueleto; si falla su canal, un aviso
  compacto con Reintentar en su sitio (`PanelBoundary`/`ModuleState`) y el resto sigue.
- Sin datos: «—», nunca 0 inventado (0 solo si Dynatrace dice 0).
- Ligado al **rango global** de la barra superior: al cambiarlo, se piden datos nuevos. Botón
  «Actualizar» en la cabecera de la página, como en el resto de vistas (ADR-0004); sin refresco
  solo.
- Debajo de los marcadores, una línea pequeña con el rango y la resolución que se ve («Últimas 2 h ·
  datos por minuto»).
- Formato de números y fechas con el idioma de la interfaz (es y en). Textos en es y en.
- Con el teclado: los marcadores no son interactivos; los tooltips de p90/p99 (si los hay) se abren
  con el foco.

**Tasa de error del marcador:** es KO / total del rango (de la 0006), no la media de los puntos de
la serie.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): al abrir la página de un SERVICE (desde «Analizar entidad» de una evidencia del
  simulador) salen los cinco marcadores con los valores del simulador, ya formateados, y no sale
  «Página en construcción».
- CA2 (unitario): el formato de los tiempos (de ms a «850 ms» o «1,2 s»; en inglés «1.2 s»), de los
  recuentos con separador de miles y de la tasa con un decimal, en es y en.
- CA3 (e2e): con KO > 0 y problemas abiertos > 0, esos marcadores llevan la clase de error y
  texto; con 0, no llevan la clase.
- CA4 (e2e): cambiar el rango global vuelve a pedir los dos canales con el rango nuevo; volver a la
  página sin cambiar nada no pide datos; «Actualizar» sí.
- CA5 (e2e): si el canal de métricas falla, los marcadores de métricas enseñan el aviso con
  Reintentar y el de problemas sigue con su dato (y al revés).
- CA6 (e2e): un servicio sin datos enseña «—» en los marcadores de métricas, no 0.
- CA7 (e2e): las páginas de los otros tipos de entidad siguen en construcción (no cambian).
- CA8 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con servicios reales, que los marcadores cuadran con lo que enseña Dynatrace para el mismo rango
  (peticiones, errores, tasa, mediana/p90/p99 y problemas).
- Que se lee bien en claro y en oscuro y con la ventana pequeña.
- Cómo verlos: entorno con token clásico (scopes `metrics.read` y `problems.read`), Problemas →
  un problema que tenga un servicio entre las evidencias → desplegar esa fila → «Analizar
  entidad». Cambiar el rango de la barra superior (2 h, 24 h, 7 d y personalizado) y comprobar
  que cambian los valores y la línea de debajo («Últimas 24 h · datos cada 5 min», por ejemplo);
  pulsar «Actualizar»; con el teclado, Tab hasta «p90» y «p99» abre su explicación.
- Un servicio sin tráfico en el rango: «—» en peticiones, KO, tasa y tiempos; los problemas sí
  enseñan 0.

## Fuera de alcance

- Pulsar un marcador para ir a otra vista (por ejemplo, a Problemas filtrada).
- Comparación con el periodo anterior (variación de los KPI: sin definir, BACKLOG).

## Ideas surgidas (fuera de alcance)

- (developer) Que `entities:serviceMetrics` diga en sus totales si hubo dato (`requests: null`
  sin puntos) en vez de que la interfaz lo deduzca de la serie.

**Decisiones del developer.**

- «—» en OK y KO: main da `totals.ok` y `totals.errors` como suma (0 sin puntos); la interfaz
  enseña «—» si la serie de peticiones no trae ningún punto con dato (`hasRequestData` en
  `ServiceMarkers.tsx`), y 0 solo si Dynatrace dice 0. Sin peticiones, la tasa ya llega `null`.
- Separador de miles: el de `Intl` tal cual; en español no agrupa los de 4 cifras («1234»), que
  es lo normal de es-ES (`service-format.ts`).
- Tiempos: 999,6 ms se redondea a 1000 y pasa a «1,0 s», no «1000 ms». Espacio duro antes de
  la unidad. Test propio en `service-resolution.test.ts` (borde de 1 s y resolución).
- Un id que no cumple `serviceEntityIdSchema` (por ejemplo `SERVICE-AN1` de la 0003) no pide
  nada: la página enseña un aviso (`entities.service.invalidId`) en vez de los marcadores.
- Acceso: los marcadores de métricas usan el acceso del módulo `metrics` y el de problemas el de
  `problems` (`useModuleAccess`); sin acceso, aviso de módulo no disponible (sin repetir el mismo
  texto) y «—» en sus marcadores, sin pedir.
- Claves de consulta `[env, 'entities', …, rango]`; «Actualizar» (`useModuleRefresh(env,
'entities')`) vuelve a pedir solo las dos activas. `EntityPageFrame` admite `actions` junto a
  «Volver».
- Línea bajo los marcadores: rango global («Últimas 2 h», o «Del … al …» con el personalizado) y
  la resolución que devolvió la API (`1m` → «datos por minuto», `5m` → «datos cada 5 min»; lo
  que no reconoce, tal cual). Esqueleto con `motion-safe:animate-pulse`.
- p90 y p99 llevan un tooltip (Radix) con su explicación, que se abre con el foco.
- Ronda 1: el aviso de un canal caído (`MarkerError`) lleva `role="alert"` y, con un `IpcError`,
  el detalle (`errorDetail`: motivo traducido o texto de Dynatrace) en una línea visible `text-xs`
  gris bajo el código, no en `title`/tooltip: así se lee sin ratón ni foco, como en `ModuleError`.
  e2e tras el cambio: 185 en verde y 3 fallos, los de la 0005 con `withContentSize` (VPS).
- e2e (2026-10-07): `service-format.ts` está en `src/renderer/src/lib/**` (transversal), así que
  `test:e2e:affected` corre el e2e completo: 182 en verde y 6 fallos, todos los tests de la 0005
  que usan `withContentSize` (contenido de 960×601/602 o no restaura el tamaño): la geometría de
  la VPS, no esta ficha. Los 17 de las fichas 0003, 0006, 0007 y 0008 pasan.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Arquitectura y reglas] `ServiceMarkers.tsx:288-310` (`MarkerError`): el aviso de un canal caído solo
   enseña el código traducido o «No se pudo cargar.»; no pinta el `reason` ni el texto de Dynatrace
   (ADR-0005) y pierde `role="alert"`. `ModuleError` (`ModuleState.tsx:31-45`) tiene las dos cosas.
   Acción: con un `IpcError`, enseñar también `errorDetail(t, error)` (`lib/error-detail.ts`), en una
   línea `text-xs` o en `title`/tooltip (lo decide el developer), y `role="alert"` en el contenedor.
   Cuidado con `getByRole('button', { name: 'Reintentar' })` de CA5. Sin tocar los tests.

Comprobado y correcto: CA1-CA8 con su test, sin tocar tras `8923a78`; «—» en OK y KO deducido de la
serie (cumple «0 solo si Dynatrace dice 0»; el caso de serie de errores vacía queda como idea);
ADR-0004 (claves, «Actualizar», CA4); accesibilidad (texto siempre, tooltips con foco, esqueleto con
`motion-safe`); `EntityPageFrame` no cambia las otras páginas; sin espacios raros; sin datos del
tenant.

Opcionales: `service-format.ts` en `lib/**` es transversal (podría ir en `pages/entities/`); las
«Decisiones del developer» en su propia sección; el verifier confirma los 6 fallos de la 0005.

### Ronda 2: APROBADO

- Punto 1 resuelto: `MarkerError` con `role="alert"` y `errorDetail` visible con un `IpcError`, como
  `ModuleError` (ADR-0005). La ronda solo cambia `ServiceMarkers.tsx` y la ficha; «Reintentar» sigue
  igual para CA5. Tests sin tocar desde `8923a78`.
- Opcional: si fallan las métricas salen cuatro `role="alert"` a la vez; se podría dejar uno solo.

## Verificación

**Tests (commit `8923a78`).** Fallan porque el código aún no existe, no por el propio test
(vitest: `./service-format` no existe y faltan `entities.service.markers.*`; e2e: no aparece
`service-markers` ni sus valores). CA7 pasa ya: protege lo que no debe cambiar.

- CA1 → `e2e/views.spec.ts`, «CA1 (0008): desde «Analizar entidad», la página del SERVICE
  enseña los cinco marcadores…» (servicio `SERVICE-00000000000E2E02`: «45.000», «0», «0,0 %»,
  «850 ms», «1,2 s», «2,5 s», 0 abiertos y 3 cerrados).
- CA2 → `src/renderer/src/lib/service-format.test.ts`, describes «CA2 (0008)» (tiempos,
  recuentos y tasa, en es y en).
- CA3 → `e2e/views.spec.ts`, «CA3 (0008): con KO > 0 y problemas abiertos > 0…»
  (`SERVICE-00000000000E2E01`, 15 KO y 1 abierto; contra `…E2E02`, 0 y 0).
- CA4 → `e2e/views.spec.ts`, «CA4 (0008): cambiar el rango global vuelve a pedir…» (cuenta
  `sim.serviceMetricQueries`, `sim.entityProblemQueries` y `sim.requests`).
- CA5 → `e2e/views.spec.ts`, dos tests «CA5 (0008)» (falla métricas; falla problemas), con
  `sim.serviceMetricsFail` y `sim.entityProblemsFail` (400) y Reintentar que recupera.
- CA6 → `e2e/views.spec.ts`, «CA6 (0008): un servicio sin datos enseña «—»…»
  (`SERVICE-00000000000E2E03`, sin datos en el simulador; problemas 0 y 0, que sí se enseñan).
- CA7 → `e2e/views.spec.ts`, «CA7 (0008): las páginas de los otros tipos de entidad siguen en
  construcción…» (desde «Analizar entidad» de un HOST y por URL los demás tipos y la genérica,
  sin `service-marker-*` ni peticiones).
- CA8 → `src/renderer/src/locales/service-markers.test.ts`, describe «CA8 (0008)».

**Nombres que fijan los tests (la ficha no los daba).**

- Formato en `src/renderer/src/lib/service-format.ts`: `formatDurationMs`, `formatCount` y
  `formatErrorRate`, con firma `(value: number | null, language: string) => string`; `null` da
  «—». Tiempos: menos de 1000 ms en ms sin decimales (849,6 → «850 ms»); desde 1 s, en s con un
  decimal. La tasa llega en % (0–100). Se admite espacio normal o duro antes de la unidad.
  Recuentos probados con 5 o más cifras (Intl en español no agrupa las de 4).
- Textos en `entities.service.markers` de common: `ok`, `ko`, `errorRate`, `responseTime` y
  `problems` (en es, los nombres de la tabla de la ficha).
- Testids: fila `service-markers`; marcadores `service-marker-ok`, `-ko`, `-error-rate`,
  `-response-time` y `-problems`; valores `service-marker-value` (OK, KO y tasa),
  `service-marker-median`, `-p90` y `-p99` y `service-marker-open` y `-closed`. Color de error:
  clase `text-danger` en el valor de KO y en el de abiertos (no en cerrados).
- Fallo de un canal: cada marcador afectado sigue en su sitio (su testid) con un botón
  «Reintentar» dentro y sin su valor; Reintentar vuelve a pedir y pinta el dato.
- «Actualizar» es `module-refresh` dentro de `entity-page-service`.

**Simulador (`e2e/views.spec.ts`).** `SVC_DATA` (series y marcadores por servicio) sustituye a
la tabla única de la 0006 sin cambiar sus valores; `markerProblems()` añade los problemas de
`…E2E01` (1 abierto, 2 cerrados) y `…E2E02` (3 cerrados); P-791 (solo del detalle) lleva las
evidencias de los tres servicios y de un HOST. CA7 (0006), CA6 (0007) y CA8 (0003) siguen en
verde con el simulador nuevo.

**Notas para el developer.** La línea de rango y resolución («Últimas 2 h · datos por minuto») y
el esqueleto de carga no tienen criterio propio: no los fija ningún test. CA8 (0003) abre
`/entities/SERVICE/SERVICE-AN1` y espera cero peticiones: ese id no cumple el formato del canal,
así que no debería pedir nada, pero si la página enseña su error en consola el `afterEach` lo
pillará. No uso `withContentSize`.

### Verifier, 2026-10-07, commit `225bc52`, rango `main..225bc52`: VERDE

- check: 2072 tests en 100 ficheros, cobertura ok.
- e2e completo (`lib/**` transversal): 185 pasan y 3 fallan, los de la 0005 con `withContentSize` (CA1,
  CA2 y CA4; escalado al 150 % de la VPS). Sobre `main` (`4e2761a`): 178 pasan y fallan los mismos 3.
- `views.spec.ts -g "0008" --repeat-each 3 --workers=1`: 21/21.

## Resultado

(pendiente)
