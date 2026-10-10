---
id: '0053'
titulo: 'APPLICATION (RUM): marcadores nuevos y secciones «Actividad» y «Errores»'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion-rum
depende_de: ['0052']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0053-aplicacion-rum-actividad-errores
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:applicationRum` de la 0052 y lo que ya usa la página)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion-rum» (0052 a 0054). "Actividad de acciones (loads y XHR), errores HTTP y
JavaScript, sesiones de usuario, usuarios activos…". La petición completa está en la ficha 0052.

## Especificación

**Fuente de los datos (Dani, 2026-10-10):** Dynatrace tiene dos fuentes para RUM y Core Web Vitals:
Grail (DQL, plataforma) y la API clásica con métricas. Vigía y sus pruebas en vivo están limitadas a
la **API clásica**, así que solo se pintan **métricas de RUM** (`builtin:apps.web.*` por
`GET /api/v2/metrics/query`). Nada de Grail ni DQL en este lote.

La página de la aplicación (`WebApplicationEntityPage.tsx`) pasa a organizarse por secciones con
título, en este orden (etiquetas arriba e «Información» al final, como todas):

**Marcadores** (seis, centrados; en la ventana estrecha, en dos filas):

| Marcador         | Principal                     | Debajo                                   |
| ---------------- | ----------------------------- | ---------------------------------------- |
| Apdex            | como hoy, con su categoría    | —                                        |
| Usuarios activos | estimación del rango          | «estimado» (tooltip que lo explica)      |
| Sesiones         | iniciadas                     | duración media · rebote %                |
| Acciones         | total                         | load · XHR (· custom si hay)             |
| Errores          | total (color de error si > 0) | JavaScript · HTTP (si se pueden separar) |
| Problemas        | abiertos                      | cerrados                                 |

**Sección «Actividad»** (2 gráficos lado a lado):

- **Acciones por tipo:** barras apiladas load, XHR y custom (colores del tema, leyenda).
- **Duración por tipo:** líneas de load y XHR (y custom si hay), en ms o s, con la franja de
  problemas encima.

**Sección «Errores»** (2 gráficos):

- **Errores por tipo:** barras apiladas JavaScript, HTTP y otros (o un solo color si no se pueden
  separar, con una nota).
- **Acciones afectadas por errores:** línea en %.

El gráfico de Apdex se queda; la tabla de acciones clave también (en su sección «Acciones clave»).
Sin líneas de rejilla, tooltip, «Abrir en Métricas», exportar y errores por panel, como el resto.
Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de una aplicación del simulador enseña los seis marcadores con sus valores
  formateados (separador de miles) y sus líneas de debajo.
- CA2 (e2e): la sección «Actividad» enseña los dos gráficos con sus series (`data-series`): load,
  XHR, custom; y la sección «Errores», los suyos.
- CA3 (e2e): con los errores HTTP sin separar (`null` en el simulador), el gráfico de errores lleva
  una sola serie y la nota, y el marcador no enseña la línea JavaScript · HTTP.
- CA4 (e2e): con un papel `null`, su marcador o gráfico no sale y el resto sí.
- CA5 (e2e): rango global, «Actualizar» y errores por panel como en las demás páginas.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con aplicaciones reales, que actividad y errores cuadran con Dynatrace en el mismo rango.

## Fuera de alcance

- Grail y DQL (RUM y Web Vitals de la plataforma): solo API clásica, decisión de Dani.
- Usuarios, sesiones y experiencia en gráficos (0054).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `bb216f9` (`test(aplicacion): criterios de la ficha 0053 (#0053)`). Fallan porque
la vista aún no existe (testids `application-marker-users`, `application-section`… no
encontrados; claves de `entities.application` sin definir), no por el test: 11 e2e nuevos y 5 de la
0034 ajustados. Los 2 e2e de la 0052 siguen en verde con los valores nuevos del simulador.

| Criterio | Test                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0053): la página de una aplicación enseña los seis marcadores, en su orden, …` y `CA1 (0053): con acciones custom, el marcador de acciones las suma …`                                  |
| CA2      | `e2e/views.spec.ts` › `CA2 (0053): las secciones «Actividad» y «Errores» enseñan sus dos gráficos con sus series, …` y `CA2 (0053): con acciones custom, los dos gráficos de «Actividad» llevan load, XHR y custom` |
| CA3      | `e2e/views.spec.ts` › `CA3 (0053): con los errores sin separar por tipo, el gráfico de errores lleva una sola serie y la nota, …`                                                                                   |
| CA4      | `e2e/views.spec.ts` › `CA4 (0053): con papeles sin datos (usuarios, acciones por tipo y acciones afectadas), …`                                                                                                     |
| CA5      | `e2e/views.spec.ts` › `CA5 (0053): cambiar el rango global vuelve a pedir los datos de RUM; …` y `CA5 (0053): si falla el canal de RUM, …`                                                                          |
| CA6      | `src/renderer/src/locales/application-rum-page.test.ts` › `CA6 (0053): textos nuevos de la página de la aplicación en es y en`                                                                                      |

**Tests de la 0034 ajustados** (la página cambia): CA1 (solo Apdex, problemas, el gráfico del Apdex
y la tabla, ya en «Acciones clave»; los gráficos de acciones, duración y errores totales ya no
están), la nota del Orquestador de CA1 (seis marcadores y cinco gráficos), CA3 (Apdex y errores sin
datos, con los marcadores y gráficos nuevos), CA4 (la franja sale en el Apdex y en la duración por
tipo) y CA5 (secciones encima de «Información»). En `application-page.test.ts` (CA6 de la 0034)
salen `markers.duration`, `charts.actions`, `charts.duration` y `charts.errors`, y
`actions.title` admite «Acciones clave».

**Simulador** (`e2e/views.spec.ts`): valores de RUM con separador de miles (usuarios 1.234, load
9.640, XHR 21.400; duración de sesión 45,6 s, rebote 28,4 %), y tres interruptores:
`sim.applicationRumFail` (400 solo en las consultas de RUM), `sim.applicationRumCustom` (custom con
datos) y `sim.applicationRumErrorsUntyped` (errores en una sola serie sin «Error type»).
`sim.applicationEmpty` admite prefijos de métrica de RUM.

**Decisiones del test-writer (delegadas por el Orquestador en nombre de Dani, refinables):**

- **«`null` en el simulador» (CA3 y CA4).** El canal de la 0052 nunca da un papel `null`: sin datos,
  serie vacía y total `null`. Así que «papel `null`» es un papel sin datos, como en la 0034.
  «Errores HTTP sin separar» es: `javascript` y `http` sin datos y los errores en `other` (llegan
  sin «Error type»). Que solo falte HTTP no es «sin separar» (sería que no hubo errores HTTP).
- **Marcadores**, en este orden: `apdex`, `users`, `sessions`, `actions`, `errors` y `problems`;
  lo de debajo, en `application-marker-secondary`. Usuarios, sesiones, acciones y errores salen del
  canal de RUM (si falla, los cuatro enseñan el aviso). El total de acciones y el de errores son la
  **suma de sus tipos** (no `actionCount.summary` ni `countOfErrors` de la 0033), para que cuadre con
  lo de debajo. Duración de sesión de µs a `formatDurationMs`; rebote con un decimal y «%».
  El marcador de duración de la 0034 desaparece.
- **Secciones**: `application-section` con `data-section`, en este orden: `activity` («Actividad»),
  `errors` («Errores»), `apdex` («Apdex», con el gráfico que se queda) y `key-actions` («Acciones
  clave», con la tabla); marcadores arriba e «Información» al final. Los gráficos de la 0034 de
  acciones, duración y errores totales desaparecen (los sustituyen los de tipo).
- **Gráficos** (`application-chart-panel` con `data-kind`): `actionsByType`, `durationByType`,
  `errorsByType` y `affectedActions`, con los títulos de la ficha. **Custom y «otros» solo si
  traen datos** (en vivo nunca): CA2 mira load, XHR y custom con `sim.applicationRumCustom`, y load y
  XHR sin él. La franja de problemas, en la duración por tipo **y** en el Apdex. Nota de errores sin
  separar, `application-errors-note`.
- **Textos**: en `entities.application`, `sections.*`, `markers.users`, `markers.usersEstimated`
  y `markers.usersEstimatedHint` (el tooltip), `markers.sessions`, `charts.<gráfico>`,
  `charts.errorsNotSeparated` y `charts.series.{load,xhr,custom,javascript,http,other}`.
- No se prueban (no están en los criterios): la geometría de los marcadores (centrados, dos filas en
  la ventana estrecha), los gráficos lado a lado, la leyenda y el texto del tooltip de «estimado».

## Resultado

(pendiente)
