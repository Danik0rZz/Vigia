---
id: '0037'
titulo: 'Páginas de entidad: etiquetas arriba del todo, como píldoras clave:valor'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: mejoras-entidades
depende_de: ['0036']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0037-entidades-etiquetas-pildoras
adrs: [2]
adr_nuevo:
api: v2, `tags` de `GET /entities/{entityId}` (esquema `EnrichedTagDto`: `context`, `key`, `value` opcional y `stringRepresentation`; `..\API\Dynatrace Environment APIv2\APIv2.json`). Sin endpoints nuevos.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «mejoras-entidades» (0036 y 0037). Dani (2026-10-09): "Los tags me gustaría verlos arriba del
todo, incluso antes de las cajas informativas. Quiero verlas de manera bonita, como píldoras. Hay
que tener en cuenta que las tags son una composición de KEY:VALUE, pero hay casos en los que no
existe VALUE y solo viene KEY."

## Especificación

**Datos.** `entities:get` (0014) manda hoy las etiquetas como texto. Pasa a mandarlas separadas:
`tags: { context, key, value | null }[]` (de `context`, `key` y `value` de la API; `value` falta
en las de solo clave). Las vistas que hoy usan el texto se adaptan.

**Vista.** En todas las páginas de entidad, justo debajo de la cabecera y **antes de los
marcadores**, una fila de píldoras:

- `clave: valor` con la clave en un tono y el valor en otro (o la clave sola si no hay valor), con
  el estilo del tema (claro y oscuro, contraste del test de `check`).
- El contexto, si no es `CONTEXTLESS`, como prefijo pequeño y apagado (`[AWS]`, `[Kubernetes]`…).
- Orden alfabético por clave. Si no caben en dos líneas, «+N» despliega el resto.
- Tooltip con el texto completo (`stringRepresentation`) si se recorta.
- Las etiquetas dejan de salir dentro de la tarjeta «Información» (para no repetirlas).
- Sin etiquetas, la fila no sale. Sin el scope `entities.read`, tampoco (el aviso del scope ya sale
  en la tarjeta).

## Criterios de aceptación

- CA1 (unitario, main): `entities:get` transforma etiquetas de la API (con y sin `value`, con y sin
  contexto) en `{ context, key, value }`.
- CA2 (e2e): en una página de entidad del simulador, las píldoras salen entre la cabecera y los
  marcadores, en orden alfabético; una de solo clave enseña solo la clave y una con contexto lleva
  su prefijo.
- CA3 (e2e): con muchas etiquetas, «+N» despliega el resto.
- CA4 (e2e): la tarjeta «Información» ya no enseña etiquetas.
- CA5 (e2e): sin etiquetas, no hay fila; los e2e de las páginas de entidad siguen pasando.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con entidades reales, que las píldoras se leen bien y se ven bonitas en claro y en oscuro.

## Fuera de alcance

- Filtrar por etiqueta o pulsar una etiqueta para buscar otras entidades.

## Ideas surgidas (fuera de alcance)

- (developer) Las páginas «en construcción» (aplicación web, cloud application, process group,
  entorno, genérica) no piden `entities:get` y no enseñan etiquetas; cuando tengan contenido,
  basta con pasar `EntityTags` a `EntitySections`.
- (developer) Nombres bonitos para los contextos conocidos (`KUBERNETES` → «Kubernetes»); hoy
  sale el código tal cual, `[KUBERNETES]`.

## Notas del revisor

(sin revisar)

## Verificación

Tests: commit 59b55ef (`test(entidades): criterios de la ficha 0037`).

- CA1 → `src/main/ipc/handlers/entity-detail.test.ts`, «CA1 (0037): entities:get transforma las
  etiquetas …» (con y sin `value`, CONTEXTLESS y con contexto, sin el campo `context`, clave y
  valor tal cual, sin clave descartada, lista vacía); y `toEntityData` en
  `src/main/modules/entities.test.ts`.
- CA2 → `e2e/views.spec.ts`, `CA2 (0037): en la página de un servicio …` (TAGS_ID: entre cabecera y
  marcadores en el DOM y en pantalla, orden alfabético, la de solo clave sin «:», prefijo de
  contexto antes de la clave, clave y valor en colores distintos) y «CA2 (0037): en las páginas de
  host, browser monitor y proceso …».
- CA3 → `CA3 (0037): con muchas etiquetas …` (TAGS_MANY_ID, 40 etiquetas: las que se ven, en dos
  líneas como mucho y en orden, más N son todas; tras pulsar «+N», todas en orden).
- CA4 → `CA4 (0037): la tarjeta «Información» ya no enseña etiquetas …` (servicio, host, browser
  monitor y proceso) y, en unitarios, `rows.has('tags')` a false en `pages/entities/*-info.test.ts`.
- CA5 → `CA5 (0037): sin etiquetas, o sin el scope entities.read, no hay fila …` y los e2e de las
  páginas de entidad, adaptados en el mismo commit: sin la fila `tags` en las tarjetas de la 0015,
  0020, 0026 y 0029, y CA2 (0036) admite la fila `entity-tags` antes de los marcadores. CA5 ya
  pasa hoy (comprueba una ausencia); queda como guarda.
- CA6 → `src/renderer/src/locales/entity-tags.test.ts`, `CA6 (0037)`. El «+N» de etiquetas de la
  tarjeta (`entities.service.info.tagsMore`) sale de `info-plurals.test.ts`, y `tags`, de las
  listas de filas de los tests de locales.

Decisiones del test-writer (delegadas por Dani, refinables):

- Nombres: fila `entity-tags` (común a todas las páginas), píldora `entity-tag` con
  `entity-tag-key`, `entity-tag-value` (solo si hay valor) y `entity-tag-context` (solo si no es
  CONTEXTLESS), y «+N» `entity-tags-more`. Del texto del contexto solo se exige que contenga el
  contexto sin distinguir mayúsculas (`AWS`, `Kubernetes`…).
- `entities:get`: sin `context`, `CONTEXTLESS`; sin `key` (o vacía), se descarta; `value` vacío,
  null; se conserva el orden de la API (ordena la vista).
- Textos: `entities.tags.label` («Etiquetas» / «Tags») y `entities.tags.more_one`/`_other` (los
  que tenía el «+N» de la tarjeta).
- El tooltip con `stringRepresentation` no tiene criterio y no se prueba.

Decisiones del developer (delegadas por Dani, refinables):

- Las páginas con fila de píldoras son las que ya piden `entities:get` (servicio, host, browser y
  HTTP monitor, proceso). La fila es la primera pieza de `EntitySections` (prop `tags`
  obligatoria), antes incluso de los avisos de módulos sin acceso; mientras llegan los datos no
  sale (no hay esqueleto).
- Tooltip: `title` nativo en cada píldora, siempre, con el texto completo rehecho como
  `stringRepresentation` (`[CONTEXTO]clave:valor`); el canal no manda `stringRepresentation`
  (CA1 fija `{ context, key, value }`).
- Colores con los tokens que ya hay (sin token nuevo ni test de contraste nuevo): clave en
  `muted-foreground`, valor en `foreground` y en negrita media, contexto pequeño en
  `muted-foreground`; píldora `rounded-full` con `bg-hover` y borde.
- Dos líneas: se miden con una copia invisible (sin alto, `aria-hidden`) y un `ResizeObserver`;
  la cuenta es pura (`entity-tags.ts`, con su test). Orden: `Intl.Collator` del idioma, sin
  distinguir mayúsculas y con los números en su orden. Desplegadas no se vuelven a plegar (como
  el «+N» de la tarjeta).
- La guarda del contrato IPC de secretos (`tenants.test.ts`) marcaba `entities:get.tags[].value`
  por llamarse `value`: se permite solo esa ruta, con su motivo, en un commit propio.
- El e2e «CA8 (0014)» (`entities:get` por IPC) esperaba `tags: ['equipo:pagos']`; el
  test-writer no lo adaptó y CA1 obliga al formato nuevo. Se adapta solo esa línea, en un commit
  propio, a `{ context: 'CONTEXTLESS', key: 'equipo', value: 'pagos' }`.

## Resultado

(pendiente)
