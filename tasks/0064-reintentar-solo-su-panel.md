---
id: '0064'
titulo: '«Reintentar» de un panel solo vuelve a pedir lo suyo (y arreglos pequeños de la interfaz)'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-interfaz
depende_de: ['0058']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0064-reintentar-solo-su-panel
adrs: [4]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 2
---

## Petición original

Lote «auditoria-interfaz», de la revisión de código del 2026-10-09 (hallazgos C-03, C-08, C-09, C-10,
C-13 y C-14). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario. El
principal es C-03.

## Especificación

**1. «Reintentar» (C-03, el importante).** `components/PanelBoundary.tsx` hace
`queryClient.refetchQueries({ type: 'active' })`: un panel que falla y un clic en «Reintentar»
vuelven a pedir **todas** las consultas activas de la app (en un problema con quince evidencias con
métrica, el detalle y quince consultas de métricas; en un host, todos sus canales). Gasta cuota del
cliente en contra del ADR-0004, justo cuando algo falla.

- `PanelBoundary` recibe `onRetry` opcional. Por defecto, «Reintentar» solo limpia el error y vuelve
  a pintar con la caché. Quien deba recargar datos pasa su `refetch`: el gráfico de entidad, el de
  Métricas, el mini gráfico de cada evidencia, la línea de tiempo y la tabla de Problemas.
  `app/RouteError.tsx` igual.

**2. Arreglos pequeños:**

- **C-08:** `settings/SecretsPanel.tsx`: el efecto que avisa al formulario de que un secreto está
  «sucio» no se limpia al desmontarse; al pasar un entorno a Managed y guardar, sale «Hay secretos
  sin guardar» por un campo que ya no existe. Añadir la limpieza
  (`return () => onDirtyChange?.(kind, false)`).
- **C-09:** el token guardado con `secrets:set` se queda unos minutos en la caché de mutaciones de
  TanStack Query (`reset()` no la borra). `useTenantMutation` acepta `gcTime` y la fila del secreto
  pasa `0`.
- **C-10:** `main.tsx` espera a `app:getInfo` sin tiempo máximo antes del primer render. Un
  `Promise.race` con unos 2 s y valores por defecto; y sembrar la caché para que la barra lateral no
  repita la llamada.
- **C-13:** `DataGrid.tsx`: el `requestAnimationFrame` del scroll no se cancela al desmontar; añadir
  la limpieza.
- **C-14:** `MarkdownText.tsx`: los títulos del Markdown del tenant salen como `h1`…`h6` reales y
  entran en la jerarquía de la página (lectores de pantalla). Comprobar si las fichas 0038 y 0043 ya
  lo resolvieron; si no, pintarlos como `p` con `role="heading"` y `aria-level` de 5 o 6
  (`Math.min(6, 4 + nivel)`), con las mismas clases.

## Criterios de aceptación

- CA1 (e2e): en un problema del simulador con varias evidencias con métrica, se provoca el fallo de
  un panel y, al pulsar «Reintentar», el simulador no recibe ninguna `GET /api/v2/metrics/query`
  nueva (comportamiento por defecto).
- CA2 (e2e): en un gráfico de entidad cuyo canal falló, «Reintentar» pide solo ese canal una vez.
- CA3 (e2e): escribir en un secreto de plataforma, pasar el entorno a Managed, guardar y confirmar no
  muestra «Hay secretos sin guardar».
- CA4 (unitario): tras guardar un secreto y `reset()`, la caché de mutaciones no contiene ninguna con
  el valor.
- CA5 (unitario): sin respuesta de `app:getInfo`, el primer render ocurre a los ~2 s con los valores
  por defecto.
- CA6 (unitario de componente): `# a` sale con nivel 5 y `###### b` con nivel 6, sin `h1`…`h6` (si
  no lo resolvió ya la 0038).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Otros cambios de la interfaz.

## Ideas surgidas (fuera de alcance)

- (developer) Notas al pie del Markdown del tenant. Las referencias `[^1]` y la vuelta `↩` salen en
  texto, porque sus enlaces internos no son http/https. El título oculto de la sección sale con el
  texto por defecto de remark-rehype («Footnotes»), sin traducir. Se podrían admitir los anclajes
  internos `#user-content-…` y poner el título en es y en.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Accesibilidad] `src/renderer/src/components/MarkdownText.tsx:181-199` (`MarkdownHeading`) solo
   reenvía `children`, `className`, `style` y `title`, y pierde el `id` del título `footnote-label`
   que genera GFM: las referencias de las notas al pie (`aria-describedby="footnote-label"`) apuntan
   a un `id` que ya no existe. No es riesgo de lista blanca (el saneado ya quita `id` del HTML del
   tenant). Reenviar también `id` (o todas las props menos `node`) y un unitario con
   `texto[^1]\n\n[^1]: nota` que compruebe que el `aria-describedby` apunta a un `id` existente.

Bien: «Reintentar» solo ejecuta el `refetch` de su panel (`PanelBoundary`, `EntityChartPanel`,
`MetricChartPanel`, `ProblemsPage`, `EvidenceMetricChart`); los límites de fuera sin `onRetry` se
recuperan al repintar o con «Actualizar». Tests tocados legítimos: `c680e67` (siguen contando un
título), `a73b351` (error del propio test) y `aec8b83` (8 e2e: mismo texto y un solo título; el
nivel lo cubre CA6). Sin choque con el ADR-0011. CA3 y CA4 correctos; C-10 solo en el renderer;
C-13 con `cancelAnimationFrame`. Sin endpoints, textos, dependencias ni esquema; nada del tenant.

Opcional: `main.tsx:575` sobra `request.catch(() => undefined)`.

### Ronda 2: APROBADO

El CAMBIO de la ronda 1, resuelto en `90d5423`: `MarkdownHeading` reenvía `id` y `footnote-label` lo
conserva. Como el `a` de `MarkdownText` deja en texto los enlaces que no son http/https (0001,
ADR-0008), la referencia `[^1]` no lleva `aria-describedby`; el unitario nuevo exige
`id="footnote-label"` en el `p` con `role="heading"` (fallaría sin el arreglo), que ningún
`aria-describedby` apunte a un `id` inexistente y que el título no salga como `h2`. `ea23061`
(quita el `catch` sobrante) es seguro: `Promise.race` ya recoge el rechazo. Tests tocados tras
`c680e67`: solo `a73b351` (ya valorado) y el bloque nuevo; nada más cambia.

Opcional: el título oculto de las notas sale como «Footnotes» sin traducir (ya en "Ideas surgidas").

## Verificación

Tests escritos en c680e67 (fallan con el código de main, por el motivo esperado). Antes se comprobó
en main: `PanelBoundary` y `RouteError` siguen con `refetchQueries({ type: 'active' })`, el efecto de
`SecretRow` va sin limpieza, `main.tsx` sin tiempo máximo y el `requestAnimationFrame` de `DataGrid`
sin cancelar al desmontar. C-14 no lo resolvieron ni la 0038 ni la 0043: los títulos siguen saliendo
como `h1`…`h6`.

| Criterio       | Test                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1            | `e2e/views.spec.ts`, `CA1 (0064)`: en P-780, con dos mini gráficos pintados, se rompe el panel de la tabla de evidencias (sin `onRetry`); tras «Reintentar», ninguna `GET /api/v2/metrics/query` ni ninguna otra petición |
| CA1 (Espec. 1) | `e2e/views.spec.ts`, `Espec. 1 (0064)`: se rompe el mini gráfico de una evidencia; «Reintentar» pide solo su selector, una vez; el otro gráfico y el detalle, nada                                                        |
| CA2            | `e2e/views.spec.ts`, `CA2 (0064)`: en el host se rompe el gráfico de memoria; «Reintentar» hace una llamada más a `entities:hostMetrics` (sus consultas) y ninguna a los demás canales                                    |
| CA3            | `e2e/tenants.spec.ts`, `CA3 (0064)`                                                                                                                                                                                       |
| CA4            | `src/renderer/src/data/tenants-mutation-cache.test.ts` y `src/renderer/src/settings/SecretsPanel.test.ts`, `CA4 (0064)`                                                                                                   |
| CA5            | `src/renderer/src/main.test.ts`, `CA5 (0064)`                                                                                                                                                                             |
| CA6            | `src/renderer/src/components/MarkdownText.test.ts`, `CA6 (0064)`                                                                                                                                                          |

Decisiones del test-writer (la cola está delegada; se pueden afinar):

- **Cómo se rompe un panel en e2e:** sin tocar la app, se hace fallar una vez una llamada del DOM
  que el panel hace dentro de un efecto: `ResizeObserver.observe` del contenedor del gráfico
  (`Chart`) o `scrollIntoView` de la tabla de evidencias al desplegar una fila (helpers
  `failChartMountOnce` y `failEvidenceGridOnce`). Si `Chart` o `DataGrid` dejan de usar esas
  llamadas, se cambia el helper, no la app.
- **CA1:** en un problema, el panel con el comportamiento por defecto es la tabla de evidencias
  (según la especificación, el mini gráfico pasa su `refetch`). Con el código de antes tampoco salía
  ninguna métrica, porque los mini gráficos ya están desmontados al reintentar, así que el test exige
  además que no salga ninguna petición: por defecto «solo limpia el error y vuelve a pintar con la
  caché». El caso del mini gráfico va aparte (Espec. 1) y cuenta las peticiones de los dos lados:
  las suyas suben y las de los demás no.
- **CA2:** «cuyo canal falló» se lee como «cuyo panel falló». Cuando el canal devuelve error, el
  aviso es `MarkerError` con su `query.refetch()`, que ya pedía solo ese canal: no habría nada que
  probar.
- **CA4:** `useTenantMutation(channel, { gcTime })` (las opciones van en un segundo argumento) y la
  fila del secreto pasa `{ gcTime: 0 }` a `secrets:set`.
- **CA6:** los tests antiguos que contaban un `h1` (`CA6 (0001)` y, en `CA3 (0043)`, «todo junto»)
  cuentan ahora el `p` con `role="heading"`.
- **Aviso para el developer (CA3):** `requestClose` de `EnvironmentForm` lee `dirtySecrets` del render
  en el que se pulsó Guardar. Si ese valor se queda viejo, la limpieza del efecto puede no bastar.

Decisiones del developer (la cola está delegada; se pueden afinar):

- **Mini gráfico de evidencia:** su `PanelBoundary` con `refetch` va dentro de `EvidenceMetricChart`,
  alrededor del `Chart`: ahí la consulta sigue montada y `query.refetch()` pide solo su clave. El
  límite de fuera (en `EvidenceDetail`) se queda con el comportamiento por defecto.
- **Problemas:** la línea de tiempo y la tabla reintentan con `query.refetch()` de la lista. Métricas
  pasa `onRetry` a `MetricChartPanel` solo si hay consulta lanzada. `RouteError` ya no pide datos:
  navega a la misma ruta y pinta con la caché.
- **CA3:** además de la limpieza del efecto, `requestClose` recibe los secretos cuyo campo desaparece
  (`PLATFORM_KINDS` al guardar en Managed) y no los cuenta: tras el `await`, el `dirtySecrets` del
  cierre es el de antes de desmontar las filas. Un ref no valía (el lint `react-hooks/refs` lo
  rechaza dentro de `handleSubmit`).
- **C-10:** `main.tsx` siembra `['appInfo']` en la caché al llegar la respuesta (aunque llegue tarde)
  y la consulta de `Sidebar` lleva `staleTime: Infinity` para no repetirla al montarse.
- **C-14:** los títulos llevan la clase `md-h<nivel>` y `main.css` pasa de `.md-text h1` a
  `.md-text .md-h1` (mismo aspecto).
- **e2e de las fichas 0001 y 0035 (aec8b83):** buscaban `h1…h6` en la descripción y C-14 deja de
  pintar los títulos del Markdown del tenant como títulos reales, así que ahora buscan
  `p[role="heading"]`. Lo que verifican no se debilita: el texto exacto y que haya un único título
  siguen igual. El nivel no lo comprobaban antes y lo cubre `CA6 (0064)` en unitario. Un título que
  volviera a salir como `h1` lo detecta ese mismo unitario.
- **CA6:** el test exigía `'ab'` y react-markdown deja un `\n` entre bloques con cualquier
  implementación. Lo corrigió el test-writer en a73b351 (compara `['a', 'b']`).
- **Ronda 1 (90d5423):** `MarkdownHeading` reenvía `id`, y el título de las notas al pie conserva
  `id="footnote-label"`. Matiz del unitario: en Vigía la referencia `[^1]` no lleva
  `aria-describedby`, porque apunta a `#user-content-fn-1`. Ese destino no es http/https, y el `a` de
  `MarkdownText` (ficha 0001, ADR-0008) la deja en texto desde antes de esta ficha. El unitario
  comprueba entonces que el título conserva su `id` (falla sin el arreglo) y que ningún
  `aria-describedby` que quede apunta a un `id` ausente. El opcional (el `catch` sobrante de
  `main.tsx`) va en ea23061.

### Verifier, 2026-10-10, commit `ff2d973`, rango `main..feat/0064-reintentar-solo-su-panel`: VERDE

- check: 3446 tests en 200 ficheros, cobertura ok.
- e2e completo, dos pasadas: 359/359 las dos; el fallo suelto del developer no se repitió.
- e2e «0064» de `views.spec.ts` ×3 con `--workers=1`: 9/9. El de `tenants.spec.ts` (CA3) depende
  del estado de los tests anteriores del fichero (suite serial): aislado no vale; con el fichero
  entero pasa 26/26 y 78/78 ×3.
- Inestabilidad que ya está en `main` (no de esta ficha): `tenants.spec.ts` ×3 falla a veces en
  AUD-03 (confirmación al cerrar con un secreto sin guardar) y AUD-21 (paleta por encima de un
  diálogo); reproducido en `main` (35af419). Anotado en el BACKLOG.

## Resultado

(pendiente)
