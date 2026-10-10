---
id: '0047'
titulo: 'SERVICE: la página se adapta al conjunto de métricas del serviceType'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-tipos
depende_de: ['0046']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0047-servicio-vista-por-tipo
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `serviceType`, `metricSet` y `metricKeys` que añade la 0046 a `entities:serviceMetrics`)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «servicio-tipos» (0046 a 0048). Dani (2026-10-10): según el `serviceType` del servicio aplican
unas métricas u otras. La petición completa está en la ficha 0046.

## Especificación

En la página del servicio (`ServiceMarkers.tsx`, `ServiceCharts.tsx` y `service-charts.ts`):

- **Solo actividad** (`QUEUE_LISTENER_SERVICE`): no salen los marcadores ni los gráficos de tiempos,
  errores y tasa; quedan Peticiones, Problemas y el gráfico de actividad (sin la parte KO). Una nota
  pequeña lo explica («Este tipo de servicio solo mide actividad»).
- **Cliente** y **Unificadas**: los mismos marcadores y gráficos; una nota pequeña bajo los
  marcadores dice de dónde salen («Medido desde los clientes» / «Métricas unificadas»), con un
  tooltip que lo explica en es y en.
- **Tipo de servicio** visible: el `serviceType` en la cabecera, junto al tipo de entidad (por
  ejemplo «Servicio · Base de datos»), con un nombre legible en es y en para los tipos de la tabla
  de la 0046 y el código tal cual para los demás.
- **«Abrir en Métricas»** de cada gráfico usa las claves de `metricKeys` (no las `.server` fijas
  de hoy).
- Si llega el aviso de la 0046 (sin `entities.read`), una nota discreta dice que se usan las
  métricas de servidor por defecto.

## Criterios de aceptación

- CA1 (e2e): un servicio `QUEUE_LISTENER_SERVICE` del simulador enseña solo Peticiones y Problemas,
  el gráfico de actividad y la nota; no enseña tiempos, errores ni tasa.
- CA2 (e2e): un servicio `DATABASE_SERVICE` enseña los marcadores y gráficos completos, la nota de
  cliente y «Base de datos» en la cabecera.
- CA3 (e2e): «Abrir en Métricas» del gráfico de tiempos de un servicio de cliente abre Métricas con
  `builtin:service.response.client`; el de uno unificado, con su métrica unificada.
- CA4 (e2e): un servicio `WEB_SERVICE` se ve como hoy (los e2e del servicio siguen pasando).
- CA5 (unitario): nombres legibles de los tipos de la tabla en es y en; un tipo desconocido sale
  tal cual.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con servicios reales de varios tipos (web, base de datos, cola…), que los números cuadran con
  Dynatrace.

## Fuera de alcance

- Cambiar los papeles de la página o sus umbrales.

## Ideas surgidas (fuera de alcance)

- (developer) El texto de `warnings` de la 0046 sigue en español fijo y llega así a los metadatos de
  «Exportar» con la interfaz en inglés. La nota de esta ficha ya no depende de él; quitarlo del
  aviso o darle una `reason` traducible toca main y los tests de la 0046 (CA5), así que queda para
  otra ficha.

## Notas del revisor

### Ronda 1: APROBADO

Ficha ligera: los tests del developer cubren CA1 a CA6 tal como están escritos (Solo actividad con
un panel y una serie; «Servicio · Base de datos» con sus cinco marcadores y cuatro gráficos y la nota
de cliente; las claves de Cliente y Unificadas; nombres en es y en, y un tipo desconocido tal cual),
y fallarían sin el código. Sin tocar tests tras `2dc0b18`. Solo renderer, textos y tests: nada de
main, shared, preload, esquema ni `areas.json`; sin consultas nuevas (ADR-0004). «Abrir en Métricas»
genera las mismas expresiones que main y el paso 0 de la 0046 (tasa de Unificadas con fallidas y
total, con `splitBy`; Solo actividad con `:count`). La nota «por defecto» sale de `serviceType`, no
de `warnings`; la deuda de `warnings` en «Exportar» queda anotada. Ids inventados.

Sugerencias, no bloquean:

- Un test de `serviceChartSelector` para la tasa de Unificadas y el `:count` de Solo actividad.
- Un `expect` de la nota «Métricas de servidor por defecto» en el e2e «sin entities.read» de la 0046.

## Verificación

Ficha ligera: tests escritos por el developer en `2dc0b18` (`test(servicio): criterios de la ficha
0047`), antes del código. Fallaban por falta de código (`./service-type` no existía, textos sin
claves, cabecera «Servicio» sola, selector `.server` fijo), no por el test.

| Criterio | Test                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0047): un QUEUE_LISTENER_SERVICE enseña solo Peticiones y Problemas…`; lógica de la nota en `src/renderer/src/pages/entities/service-type.test.ts` › `CA1 y CA2 (0047)…` |
| CA2      | `e2e/views.spec.ts` › `CA2 (0047): un DATABASE_SERVICE enseña los marcadores y gráficos completos…`                                                                                                  |
| CA3      | `e2e/views.spec.ts` › `CA3 (0047): «Abrir en Métricas» de los tiempos…` (DATABASE_SERVICE y UNIFIED)                                                                                                 |
| CA4      | `e2e/views.spec.ts` › `CA4 (0047): un WEB_SERVICE se ve como hoy…` y los e2e del servicio de 0008, 0009, 0010 y 0046                                                                                 |
| CA5      | `src/renderer/src/pages/entities/service-type.test.ts` › `CA5 (0047): nombres legibles…`                                                                                                             |
| CA6      | `src/renderer/src/locales/service-type-view.test.ts` › `CA6 (0047): textos nuevos…`                                                                                                                  |

En el simulador, un DATABASE_SERVICE nuevo (`SVC_DB_ID`, con los datos del de Cliente) aparte de
`SVC_SET_IDS`, para no cambiar el recorrido de los cuatro conjuntos de la CA7 de la 0046.

### Verifier, 2026-10-10, commit `6469def`, rango `main..feat/0047-servicio-vista-por-tipo`: VERDE

- check: 3098 tests en 172 ficheros, cobertura ok.
- e2e afectados: 265/265, sin intermitentes.

## Resultado

Commits: `2dc0b18` (tests), `0452da5` (código), `2ddd4b6`, `6469def` y `6e9d5a4` (fichas). Una ronda de revisión (aprobada a la primera). ADR nuevo: ninguno. Sugerencias del revisor y la deuda de `warnings` pasadas a «Mejoras anotadas» del BACKLOG.

**Developer (2026-10-10):** commit `0452da5`. `service-type.ts` (nombres legibles y nota),
`ServiceMarkers.tsx` (marcador «Peticiones» y nota con tooltip), `ServiceCharts.tsx` y
`service-charts.ts` (gráficos por conjunto, serie única de peticiones y selector con
`metricKeys`) y `ServiceEntityPage.tsx` (cabecera). Sin cambios en main, IPC ni esquema.

Decisiones del developer (delegadas por Dani, refinables):

- **Nota «por defecto»** (sugerencia de la revisión de la 0046): sale de los campos estructurados,
  no de `warnings`. Servidor con `serviceType` `null` (la entidad falló, por ejemplo sin
  `entities.read`) o con un tipo fuera de la tabla → «Métricas de servidor por defecto». No hizo
  falta un campo nuevo (`metricSetFallback`) en el canal: `serviceType: null` ya lo dice, y la
  ficha es ligera (sin IPC). El texto en español de `warnings` en «Exportar» queda anotado en
  «Ideas surgidas».
- **Nombres legibles:** Servicio web, Servicio personalizado, Actividad en segundo plano, Span,
  Mensajería, Externo, Peticiones web, RPC, Base de datos, Unificado y Escucha de colas (en
  inglés, los equivalentes). La lista vive en el renderer (`SERVICE_TYPE_NAMES`), igual que la
  tabla de main.
- **Cabecera:** «Servicio · <tipo>» cuando llega `entities:serviceMetrics`; mientras carga, sin
  acceso a Métricas o si falla, «Servicio» solo.
- **Mientras carga:** marcadores y gráficos de siempre y sin nota; al llegar Solo actividad, se
  quedan Peticiones (suma del recuento) y Problemas, y el gráfico de actividad a todo el ancho con
  una serie «Peticiones».
- **«Abrir en Métricas»:** Solo actividad abre `response.server…:count`; en Unificadas, la tasa
  (que no tiene métrica) abre las fallidas y el total con los que se calcula. Sin datos todavía,
  las claves de Servidor de siempre.
- La nota de Servidor con un tipo de la tabla no sale (CA4: se ve como hoy).
