---
id: '0043'
titulo: 'Visor de Markdown: interpretar el HTML de formato de las descripciones, con lista blanca'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: markdown
depende_de: ['0038']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0043-markdown-html-seguro
adrs: [8]
adr_nuevo: HTML de formato en el contenido del tenant con lista blanca (actualiza el ADR-0008)
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «markdown» (0035, 0038 y 0043). A la pregunta de si los colores escritos con HTML dentro de
una descripción (`<span style="color:…">`) se pintan o se siguen enseñando como texto, Dani
(2026-10-09): "La fuente es una fuente fiable, por lo que pondremos los controles correspondientes,
pero hay que interpretarlo para que quede bonito."

## Especificación

**Decisión de Dani (2026-10-09):** el HTML de formato de las descripciones se interpreta, con
controles. Cambia la regla del ADR-0008 ("el HTML en crudo no se interpreta"); el doc-writer
escribe un ADR nuevo que la actualiza (el 0008 no se edita, ver `docs/adr/README.md`).

**Cómo (en `MarkdownText.tsx`, para todas las descripciones):**

- `rehype-raw` (interpreta el HTML dentro del Markdown) seguido de `rehype-sanitize` con una
  **lista blanca propia**, las dos con versión exacta. Ningún `dangerouslySetInnerHTML`.
- **Etiquetas permitidas** (además de las que genera el Markdown): `span`, `mark`, `b`, `strong`,
  `i`, `em`, `u`, `s`, `del`, `sub`, `sup`, `small`, `kbd`, `br`, `hr`, `code`, `pre`, `p`,
  `div`, `ul`, `ol`, `li`, `table` y sus partes, `details` y `summary`, `font` (solo `color`).
- **Atributos permitidos:** `style` solo con `color` y `background-color`, y solo con valores de
  color válidos (`#rgb`, `#rrggbb`, `rgb()`/`rgba()` con números o un nombre de color CSS); el resto
  de declaraciones de `style` se quitan. `color` en `font`, con la misma validación. `title`. Nada
  de `class`, `id`, `on*` ni `srcset`.
- **Siempre fuera:** `script`, `style`, `iframe`, `object`, `embed`, `form` y sus campos, `img`,
  `video`, `audio`, `svg`, `math`, `link`, `meta` y `base`. Los enlaces siguen la regla de la 0001
  (solo `http:`/`https:`, al navegador del sistema) y las imágenes siguen sin cargarse.
- **Legibilidad:** un color que no contraste con el fondo del tema (por debajo de 3:1, en claro o en
  oscuro) se ajusta hacia el más cercano que sí contraste, para que nunca quede texto invisible.
- La CSP no cambia (`style-src 'unsafe-inline'` ya existe; no se añade nada).

## Criterios de aceptación

- CA1 (unitario de componente): `<span style="color:#d00">x</span>` sale como `span` con ese color;
  `<mark>`, `<kbd>`, `<details>`/`<summary>` y `<font color="red">` se interpretan.
- CA2 (unitario de componente): `style="color:red; position:fixed; background:url(…)"` deja solo
  `color`; un valor no válido (`expression(…)`, `url(…)`) quita la declaración.
- CA3 (unitario de componente): `<script>`, `<iframe>`, `<img src=x onerror=…>`, `<svg>`,
  `<form>` y atributos `on*` no crean esos elementos ni atributos en el DOM.
- CA4 (unitario de componente): un enlace `javascript:` dentro de HTML no es clicable; uno
  `https:` sí, con `target="_blank"` y `rel="noopener noreferrer"`.
- CA5 (unitario): un color de bajo contraste se ajusta (contraste ≥ 3:1 en claro y en oscuro).
- CA6 (unitario de componente): los tests de seguridad de las fichas 0001 y 0038 siguen pasando
  (actualizados donde la regla cambia: el HTML de formato ahora se interpreta).
- CA7 (unitario): las dos dependencias van con versión exacta.

## Pruebas a mano para Dani

- Con una descripción real con HTML de formato (si aparece), que se ve bonita y bien en claro y en
  oscuro.

## Fuera de alcance

- HTML fuera de las descripciones de los problemas.
- Clases CSS o estilos que no sean de color.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

**Tests escritos (test-writer, 2026-10-09):** commits `c97a788` y `ea8a0d4` (contraste de
`background-color`, según la decisión del Orquestador de abajo). Los nuevos fallan porque el
código aún no existe (HTML sin interpretar, `markdown-color.ts` sin crear, dependencias sin
instalar). Los de lo peligroso de CA3 (elementos y `on*`) y los enlaces no clicables de CA4 ya
pasan hoy, como regresión: el HTML aún se escapa.

| Criterio | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/renderer/src/components/MarkdownText.html.test.ts`, `CA1 (0043)` (span con color, mark, kbd, details/summary, font color; cada etiqueta de la lista, br, hr y tabla con sus partes; title se queda; class, id, srcset y data-* se quitan; una clase `md-alert` escrita no crea un aviso; etiqueta desconocida fuera con su texto)                                                                                                                                                                                                                                                                                                                                      |
| CA2      | `MarkdownText.html.test.ts`, `CA2 (0043)` (color + position + background:url deja solo color; otras propiedades fuera; 12 valores no válidos de color; background-color no válido; válida e inválida juntas; #rgb, #rrggbb, rgb(), rgba() y nombre válidos; font color no válido; font sin face ni size) y `markdown-color.test.ts`, `CA2 y CA5 (0043): background-color solo si el texto encima se lee en los dos temas`                                                                                                                                                                                                                                                   |
| CA3      | `MarkdownText.html.test.ts`, `CA3 (0043)` (35 vectores: script, style, iframe/srcdoc, img/srcset/picture, svg, math y mXSS con mglyph y noscript, form y campos, object, embed, video, audio, link, meta, base, template, dialog, marquee, map/area, frameset; en bloque, título, lista y cita; 10 casos de `on*`; todo junto; ningún `dangerouslySetInnerHTML` en el renderer)                                                                                                                                                                                                                                                                                             |
| CA4      | `MarkdownText.html.test.ts`, `CA4 (0043)` (https y http clicables con `_blank` y `noopener noreferrer`; el HTML no cambia target/rel ni añade ping/download; 14 hrefs no clicables: javascript: con mayúsculas, espacios, entidades, tabulador y salto, data:, vbscript:, file:, relativo, `//`, ancla, app:, mailto:)                                                                                                                                                                                                                                                                                                                                                      |
| CA5      | `src/renderer/src/components/markdown-color.test.ts`, `CA5 (0043)` (`readableColor` y el visor, ≥ 3:1 en claro y en oscuro) y `src/main/env-colors.test.ts`, `CA5 (0043): los fondos del ajuste…` (`THEME_BACKGROUNDS` y `THEME_FOREGROUNDS` = `--background` y `--foreground` de `main.css`); para `background-color`, `CA2 y CA5 (0043)` de `markdown-color.test.ts`: fondo claro sin color en línea se quita, fondo legible con el texto por defecto se conserva, par legible se conserva, par ilegible se quitan los dos, fondo casi transparente cuenta como el del tema                                                                                               |
| CA6      | `MarkdownText.test.ts`, `CA10 (0001), actualizado por CA6 (0043)` (lo peligroso no crea elementos; `b` se interpreta; `<` y `>` sueltos y el código en línea siguen siendo texto) y `MarkdownText.visual.test.ts`, `CA5 (0038), actualizado por CA6 (0043)` (en aviso y marca: b sí, img y `on*` no, la capa visual sigue; en un bloque de código, texto); e2e en `e2e/views.spec.ts`, actualizados a la regla nueva (b se interpreta y se ve; img, script e iframe no se crean y `__xss` sigue sin definirse): `v0.10.0: desplegar con clic y con Enter…`, `v0.9.1: tarjetas de cambio…` y `CA10 (0001), actualizado por CA6 (0043): el HTML peligroso de la descripción…` |
| CA7      | `MarkdownText.html.test.ts`, `CA7 (0043)` (`rehype-raw` y `rehype-sanitize` con versión exacta)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Contrato elegido al escribir los tests (la ficha no lo fija; decisión delegada por Dani, opción
conservadora y refinable):**

- **Legibilidad con un solo color para los dos temas:** el visor pinta el texto con un único color
  en línea que contrasta ≥ 3:1 con el `--background` claro **y** el oscuro a la vez (los dos fondos
  lo permiten: luminancia entre 0,118 y 0,259), así sigue legible si se cambia de tema sin volver a
  pintar. Pieza: `readableColor(color, backgrounds)` y `THEME_BACKGROUNDS` (`[claro, oscuro]`) en
  `src/renderer/src/components/markdown-color.ts`: `#rrggbb` de entrada, `#rrggbb` en minúsculas
  de salida, igual si ya contrasta; si no, se aclara u oscurece sin cambiar el tono (±5°), cerca del
  límite (≤ 3,5:1 frente al fondo que fallaba). Como Vitest no carga los .css como texto en el
  renderer, `env-colors.test.ts` comprueba que `THEME_BACKGROUNDS` son los de `main.css`.
- **Color casi transparente:** `rgba` con poca opacidad cuenta como bajo contraste (mezclado sobre
  el fondo); tiene que salir legible.
- **Enlaces escritos en HTML:** solo `http:`/`https:` absolutos, como la 0001; también quedan sin
  enlace `#ancla`, `//host` (relativo al protocolo), `app:` y `mailto:`. El HTML no puede cambiar
  `target` ni `rel` ni añadir `ping` o `download`.
- **Atributos:** fuera todo lo que no esté en la lista (también `data-*`, `tabindex`, y `face` y
  `size` de `font`; sobre `open` de `details` no se exige nada); una clase del propio visor (`md-alert`) escrita en el HTML
  no puede imitar un aviso.
- **Valores de color no válidos** (además de `expression()` y `url()`): `javascript:`, `var()`,
  `calc()` dentro de `rgb()`, nombres que no son colores, hexadecimales mal formados, comentarios
  y escapes CSS, y dos valores.
- **`font color`** puede salir como `font` con `color` o convertido a un elemento con `style`;
  cuenta el color con que se pinta.
- **`background-color`:** según la decisión del Orquestador de abajo; `THEME_FOREGROUNDS`
  (`[claro, oscuro]`, el `--foreground` de cada tema) en `markdown-color.ts`.
- Ayudas compartidas de los tests en `src/test/html-tree.ts` (árbol del HTML estático y colores).

**Decisión del Orquestador (delegada por Dani, opción conservadora y refinable), 2026-10-09:** un
`background-color` válido se conserva solo si el texto que queda encima se lee a ≥ 3:1 en los dos
temas: con su `color` en línea si lo trae (ese par se mide tal cual, y si no llega a 3:1 se quitan
los dos), o con el color de texto por defecto de cada tema (`--foreground`) si no lo trae. Si no
llega en alguno de los dos temas, se quita el `background-color` (el texto queda con el fondo del
tema). Un `background-color` casi transparente cuenta como el fondo del tema. Se comprueba con los
mismos `readableColor` y `THEME_BACKGROUNDS` de `markdown-color.ts`, ampliados con el texto por
defecto de cada tema. Ya no queda abierto para Dani; se afina si la prueba a mano lo pide.

**Decisiones del developer (2026-10-09, opción más segura):**

- Dependencias: `rehype-raw` 7.0.0 y `rehype-sanitize` 6.0.0, licencia MIT las dos, en
  `devDependencies` (solo van al bundle del renderer, como `react-markdown`).
- Piezas: `markdown-html.ts` (lista blanca y orden de los plugins) y `markdown-color.ts`
  (validación de colores, `readableColor` y el plugin `rehypeSafeColors`). Orden en `MarkdownText`:
  proteger el Markdown → `rehype-raw` → `rehype-sanitize` → restaurar el Markdown → colores →
  avisos, marcas y resaltado de código (la capa visual va después del saneado, así sus clases no se
  quitan y una clase escrita en el HTML nunca llega).
- **Marca `data-vigia-slot`:** los elementos que genera el propio Markdown (casillas de las listas
  de tareas, notas al pie, clases `language-*`, alineación de tablas, imágenes) no pasan por la
  lista blanca de atributos. Antes de `rehype-raw` sus propiedades se guardan en el `VFile` y se
  dejan con `data-vigia-slot` = un valor aleatorio de la sesión (`crypto.getRandomValues`) y su
  índice; el saneado solo deja pasar ese atributo si encaja con ese valor, y después se les
  devuelven sus propiedades. Una marca escrita en el HTML se quita. Los que no están en la lista
  (`img`, `input`, `section`) viajan como `span` o `div` y recuperan su etiqueta al final.
- **Etiquetas añadidas a la lista blanca:** `h1`–`h6`, `blockquote` y `a` (las genera el Markdown;
  la ficha dice «además de las que genera el Markdown»), y `caption`, `colgroup` y `col` como
  partes de la tabla. Atributos para el HTML escrito: `title` y `style` en todas, `href` en `a`
  (solo http/https, y además el `urlTransform` y el componente de la 0001) y `color` en `font`;
  nada más (ni `open` en `details`, ni `start`, `align`, `colspan` o `rowspan` escritos a mano).
- Se quitan con todo su contenido: `script`, `style`, `template`, `noscript`, `iframe`, `frame`,
  `frameset`, `noframes`, `object`, `embed`, `applet`, `svg`, `math`, `textarea`, `select`,
  `button`, `title`, `xmp`, `noembed`, `plaintext`, `video`, `audio`, `picture` y `map`. El resto
  de etiquetas desconocidas se quita y deja su texto.
- `font color` sale como `span` con `style` (gana el `color` del `style` si lleva los dos, como en
  CSS). Valores válidos: `#rgb`, `#rrggbb`, `rgb()`/`rgba()` con números separados por comas
  (canales ≤ 255, opacidad ≤ 1) y los nombres de CSS Color 4 (sin `transparent` ni
  `currentcolor`); con varias declaraciones válidas de la misma propiedad, gana la última.
- Un texto en `rgba` se conserva tal cual si ya se lee mezclado sobre el fondo; si no, se ajusta
  como color opaco. Un fondo con opacidad ≤ 0,1 cuenta como el del tema y se quita.
- Los colores se miden contra lo heredado del elemento padre (su color y su fondo ya decididos),
  no solo contra el tema: un texto dentro de un fondo en línea se ajusta frente a ese fondo. Si ni
  ajustado se lee, se quita el color.
- Los componentes `p`, `li`, `ol`, `code`, `th` y `td` de `MarkdownText` pasan ahora `style` y
  `title` (ya saneados). Un `pre` escrito en HTML sin `code` copia su texto con «Copiar».
- Pendiente para el doc-writer: la línea de `src/renderer/CLAUDE.md` que dice «nunca `rehype-raw`;
  sin HTML en crudo» (la cambia el ADR nuevo).

## Resultado

(pendiente)
