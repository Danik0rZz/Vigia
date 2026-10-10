---
id: '0054'
titulo: 'APPLICATION (RUM): secciones «Usuarios y sesiones» y «Experiencia» (Core Web Vitals)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion-rum
depende_de: ['0052', '0053']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0054-aplicacion-rum-usuarios-experiencia
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:applicationRum` de la 0052)
migracion: no
rondas_revision: 1
---

## Petición original

Lote «aplicacion-rum» (0052 a 0054). "Sesiones de usuario, usuarios activos, etc." Y sobre Core Web Vitals: "Sí, core vitals también" (2026-10-10). La petición
completa está en la ficha 0052.

## Especificación

**Fuente de los datos (Dani, 2026-10-10):** Dynatrace tiene dos fuentes para RUM y Core Web Vitals:
Grail (DQL, plataforma) y la API clásica con métricas. Vigía y sus pruebas en vivo están limitadas a
la **API clásica**, así que solo se pintan **métricas de RUM** (`builtin:apps.web.*` por
`GET /api/v2/metrics/query`). Nada de Grail ni DQL en este lote.

Dos secciones nuevas en la página de la aplicación, después de «Errores» y antes de «Acciones
clave»:

**Usuarios y sesiones** (2 gráficos):

- **Usuarios activos:** línea (estimación, con la nota).
- **Sesiones:** iniciadas y terminadas (barras) y, en un segundo eje, la duración media de sesión
  (línea). Debajo del gráfico, tres datos pequeños del rango: acciones por sesión, tasa de rebote y
  clics de frustración (rage clicks) si hay datos.

**Experiencia** (Core Web Vitals, tres tarjetas y un gráfico):

- Tarjetas **LCP**, **CLS** e **INP** con el valor del rango y su calificación con los umbrales
  públicos de Google (LCP: bueno ≤ 2,5 s, mejorable ≤ 4 s; CLS: ≤ 0,1 y ≤ 0,25; INP: ≤ 200 ms y ≤
  500 ms): «Bueno», «Mejorable» o «Pobre», con color y texto. Un tooltip explica cada métrica en
  una frase.
- Gráfico con las tres a lo largo del rango (LCP e INP en tiempo; CLS en su propio eje), con líneas
  discontinuas en el umbral de «bueno».

Lo que no tenga datos según la 0052 no se pinta. Sin líneas de rejilla, tooltip, «Abrir en
Métricas», exportar y errores por panel, como el resto. Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de una aplicación del simulador enseña la sección «Usuarios y sesiones» con
  sus dos gráficos (`data-series`) y los tres datos pequeños.
- CA2 (unitario): calificación de LCP, CLS e INP en los cortes (2,5 s y 4 s; 0,1 y 0,25; 200 ms y 500
  ms), con texto además del color.
- CA3 (e2e): la sección «Experiencia» enseña las tres tarjetas con su calificación y el gráfico con
  sus tres series y las líneas de umbral.
- CA4 (e2e): con experiencia `null` en el simulador, la sección no sale; con rage clicks `null`, su
  dato no sale.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con aplicaciones reales, que usuarios, sesiones y Web Vitals cuadran con Dynatrace.

## Fuera de alcance

- Grail y DQL (RUM y Web Vitals de la plataforma): solo API clásica, decisión de Dani.
- Desglose de Web Vitals por página, navegador o país.

## Ideas surgidas (fuera de alcance)

Las dos sugerencias del revisor (`LEVEL_CLASS` repetido y JSDoc largos) pasaron a «Mejoras anotadas» del BACKLOG.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA5 con su test. Umbrales de Google (LCP 2500/4000 ms, CLS 0,1/0,25, INP 200/500 ms; el corte
cuenta en el tramo mejor), probados por los dos lados; la calificación sale siempre con texto. Tras
`ef36826` solo cambia `0fe0a40`, que devuelve las barras invertidas perdidas a tres regex de CA3:
sin él el test no podía pasar con ninguna app correcta; no cambia ni debilita el criterio. Los 5 e2e
de 0034 y 0053 solo amplían listas que siguen comparándose exactas. `EntityChartPanel` (`footer`,
`unit` por serie) y `axisTooltip` (`formatOf`) con parámetros opcionales: nada cambia por defecto.
Sin IPC, consultas nuevas, main, CSP ni permisos; reutiliza el `rum` de la 0052 (ADR-0004); nada del
tenant.

Sugerencias, no bloquean:

- `LEVEL_CLASS` de `ApplicationUserSections.tsx` repite el de `ApplicationMarkers.tsx`: sacarlo a
  `application-format.ts`.
- Reajustar el JSDoc de `WebApplicationEntityPage.tsx:31` (más de 100 columnas) y el de
  `ApplicationSection.tsx:8-11`.

## Verificación

Tests escritos en `ef36826` (`test(aplicacion): criterios de la ficha 0054 (#0054)`). Fallan porque
el código aún no existe (`webVitalRating is not a function`, claves de `entities.application` sin
definir, secciones `users` y `experience` no encontradas), no por el test: 15 unitarios de CA2, 4 de
CA5, 4 e2e nuevos y 5 de la 0034 y la 0053 ajustados. Los de la 0052 siguen en verde con los valores
nuevos del simulador.

| Criterio | Test                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA1      | `e2e/views.spec.ts` › `CA1 (0054): la página de una aplicación enseña «Usuarios y sesiones» con sus dos gráficos y los tres datos pequeños bajo el de sesiones`                                        |
| CA2      | `src/renderer/src/lib/application-vitals.test.ts` › `CA2 (0054): calificación de LCP, CLS e INP en los cortes (2,5 s y 4 s; 0,1 y 0,25; 200 ms y 500 ms), con texto además del color`                  |
| CA3      | `e2e/views.spec.ts` › `CA3 (0054): la sección «Experiencia» enseña las tarjetas de LCP, CLS e INP con su calificación y el gráfico con sus tres series y las líneas de umbral`                         |
| CA4      | `e2e/views.spec.ts` › `CA4 (0054): sin datos de experiencia (LCP, CLS e INP), la sección «Experiencia» no sale y el resto sí` y `CA4 (0054): sin rage clicks (lo habitual en vivo), su dato no sale …` |
| CA5      | `src/renderer/src/locales/application-rum-experience.test.ts` › `CA5 (0054): textos nuevos de la página de la aplicación en es y en`                                                                   |

**Tests de la 0034 y la 0053 ajustados** (la página gana dos secciones): CA1 (0034), nota del
Orquestador (8 paneles de gráfico, no 5); CA3 (0034) y CA4 (0053) (la lista de gráficos incluye
`activeUsers`, `sessions` y `vitals`; en CA4 (0053) sin `activeUsers`, que no trae datos); CA2
(0053) y CA5 (0034) recorren las seis secciones.

**Simulador** (`e2e/views.spec.ts`): totales de Core Web Vitals en las tres calificaciones (LCP
2310 ms, CLS 0,18 e INP 640 ms); rage clicks (37) solo con `sim.applicationRumRageClicks`, que por
defecto está apagado como en vivo.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Orden de las secciones:** `activity`, `errors`, `users` («Usuarios y sesiones»), `experience`
  («Experiencia»), `apdex` y `key-actions`. La ficha dice «después de Errores y antes de Acciones
  clave»; se ponen justo tras «Errores», antes del Apdex.
- **«`null` en el simulador» (CA4):** como en la 0053, el canal nunca da un papel `null`; es un
  papel sin datos (serie vacía y total `null`). Experiencia sin datos: LCP, CLS e INP vacíos (con
  `sim.applicationEmpty`); rage clicks sin datos: lo de por defecto.
- **Gráficos** (`application-chart-panel` con `data-kind`): `activeUsers` (una serie, con la nota
  de estimación `application-users-note` en el panel), `sessions` (iniciadas, terminadas y
  duración media, en ese orden) y `vitals` (LCP, CLS e INP, con `data-thresholds` en 2500, 0,1 y
  200). Ninguno lleva la franja de problemas: la ficha no la pide y CA4 (0034) sigue contando dos.
- **Datos pequeños:** `application-session-stat` con `data-stat` (`actionsPerSession`,
  `bounceRate` y `rageClicks`), dentro del panel de sesiones y debajo del gráfico, con el valor en
  `application-session-stat-value`: «5,9», «28,4 %» y «37».
- **Tarjetas:** `application-vital` con `data-vital` (`lcp`, `cls`, `inp`), valor en
  `application-vital-value` (LCP e INP con `formatDurationMs`, CLS con dos decimales) y
  calificación en `application-vital-rating` con `data-rating` (`good`, `needsImprovement`,
  `poor`), `data-level` (`success`, `warning`, `error`) y el texto «Bueno», «Mejorable» o «Pobre».
- **Calificación (CA2):** `webVitalRating(vital, valor)` y `webVitalLevel(vital, valor)` en
  `lib/application-format.ts`, con el valor en la unidad del canal (ms y CLS sin unidad); los
  cortes incluidos en el tramo mejor; sin dato, `null` y `normal`.
- **Textos (CA5),** en `entities.application`: `sections.users` y `sections.experience`;
  `charts.activeUsers`, `charts.sessions`, `charts.vitals` y, en `charts.series`,
  `startedSessions`, `endedSessions`, `sessionDuration`, `lcp`, `cls` e `inp`; en
  `sessionStats`, `actionsPerSession`, `bounceRate` y `rageClicks`; `vitals.{lcp,cls,inp}`,
  `vitals.<vital>Hint` (el tooltip) y `vitals.rating.{good,needsImprovement,poor}`.
- No se prueban (no están en los criterios): el tooltip de las tarjetas abierto, las líneas
  discontinuas, el segundo eje de la duración y el de CLS, «Abrir en Métricas», exportar y los
  errores por panel de las secciones nuevas.

### Verifier, 2026-10-10, commit `bedf03d`, rango `main..feat/0054-aplicacion-rum-usuarios-experiencia`: VERDE

- check: 3228 tests en 180 ficheros, cobertura ok.
- e2e completo (toca `lib` y `chart-time.ts`): 353/353, sin intermitentes.

## Resultado

Commits de código: `86407cf` (calificación y textos) y `1b9cb2c` (secciones), con tests en `ef36826` y la corrección de regex en `0fe0a40`. Ficheros principales: `ApplicationUserSections.tsx`, `application-rum-users.ts`, `lib/application-format.ts`, `EntityChartPanel.tsx`, `chart-time.ts` y los textos es/en. Una ronda de revisión (aprobada); verifier en verde (3228 unitarios, 353 e2e). Sin ADR nuevo ni migraciones. El aviso del developer sobre las regex de CA3 quedó resuelto en `0fe0a40`.

**Aviso del developer al Orquestador: test de CA3 (0054) mal escrito, sin tocar.** En
`e2e/views.spec.ts` (`APP_VITAL_EXPECTED`, líneas 16277, 16284 y 16291) los patrones perdieron
las barras invertidas al escribirlos: `/(^|[^d,.])2,3ss/` y `/(^|[^d,.])640sms/` piden el texto
literal «2,3ss» y «640sms», y `[^d,.]` es «ni la letra d». La app enseña «2,3 s» y «640 ms», así que
CA3 falla por el test. Lo que se quiso escribir: `/(^|[^\d,.])2,3\ss/`,
`/(^|[^\d,.])0,18([^\d,.]|$)/` y `/(^|[^\d,.])640\sms/`. Con ese cambio en local (no commiteado),
CA3 (0054) pasa. Lo decide el Orquestador.

**Decisiones del developer (delegadas por Dani, refinables):**

- **Piezas:** `application-rum-users.ts` (puro, con sus tests: series, opción, unidades, consultas
  de «Abrir en Métricas» y datos pequeños) y `ApplicationUserSections.tsx` (las dos secciones, las
  tarjetas y los datos pequeños), entre las secciones de la 0053 y la del Apdex.
  `webVitalRating`, `webVitalLevel`, `WEB_VITAL_THRESHOLDS` y `formatCls` en
  `lib/application-format.ts`.
- **`EntityChartPanel`** admite `footer` (bajo el gráfico; los datos pequeños de sesiones) y cada
  serie puede llevar su `unit` en la exportación (sesiones y ms en el de sesiones; ms y CLS sin
  unidad en el de Core Web Vitals). `axisTooltip` admite un formato por serie: en el tooltip, la
  duración sale en tiempo y CLS con dos decimales.
- **Sesiones:** iniciadas y terminadas en barras una al lado de la otra (no apiladas: no se
  suman) y la duración media en línea en el eje derecho, pasada de µs a ms. Datos pequeños:
  acciones por sesión con un decimal, rebote con un decimal y «%», rage clicks como recuento; cada
  uno solo si trae dato.
- **Usuarios activos:** la nota de estimación reutiliza el texto del tooltip del marcador
  (`markers.usersEstimatedHint`).
- **Experiencia:** las tarjetas salen solo con los datos cargados (mientras carga o si falla, el
  gráfico enseña su estado y Reintentar; no se repite el aviso en tres tarjetas). Una tarjeta por
  vital con datos. El valor lleva el color de su calificación y la calificación va siempre con su
  texto. El nombre (LCP, CLS, INP) abre el tooltip con ratón y foco. En el gráfico, LCP e INP en el
  eje izquierdo (tiempo) y CLS en el derecho; la línea discontinua de cada umbral, en el color de
  su serie y sin etiqueta.
- **Textos nuevos además de los de la ficha:** `charts.series.activeUsers`,
  `charts.units.{users,sessions}` (exportación), `sessionStats.label` y `vitals.label` (nombres
  accesibles de los grupos). En: «Good», «Needs improvement» y «Poor».
