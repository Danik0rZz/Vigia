---
id: '0043'
titulo: 'Visor de Markdown: interpretar el HTML de formato de las descripciones, con lista blanca'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

**Tests escritos (test-writer, 2026-10-09):** commit `c97a788`. Los nuevos fallan porque el
código aún no existe (HTML sin interpretar, `markdown-color.ts` sin crear, dependencias sin
instalar). Los de lo peligroso de CA3 (elementos y `on*`) y los enlaces no clicables de CA4 ya
pasan hoy, como regresión: el HTML aún se escapa.

| Criterio | Test                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/renderer/src/components/MarkdownText.html.test.ts`, `CA1 (0043)` (span con color, mark, kbd, details/summary, font color; cada etiqueta de la lista, br, hr y tabla con sus partes; title se queda; class, id, srcset y data-* se quitan; una clase `md-alert` escrita no crea un aviso; etiqueta desconocida fuera con su texto)                                          |
| CA2      | `MarkdownText.html.test.ts`, `CA2 (0043)` (color + position + background:url deja solo color; otras propiedades fuera; 12 valores no válidos de color; background-color no válido; válida e inválida juntas; #rgb, #rrggbb, rgb(), rgba() y nombre válidos; font color no válido; font sin face ni size)                                                                        |
| CA3      | `MarkdownText.html.test.ts`, `CA3 (0043)` (35 vectores: script, style, iframe/srcdoc, img/srcset/picture, svg, math y mXSS con mglyph y noscript, form y campos, object, embed, video, audio, link, meta, base, template, dialog, marquee, map/area, frameset; en bloque, título, lista y cita; 10 casos de `on*`; todo junto; ningún `dangerouslySetInnerHTML` en el renderer) |
| CA4      | `MarkdownText.html.test.ts`, `CA4 (0043)` (https y http clicables con `_blank` y `noopener noreferrer`; el HTML no cambia target/rel ni añade ping/download; 14 hrefs no clicables: javascript: con mayúsculas, espacios, entidades, tabulador y salto, data:, vbscript:, file:, relativo, `//`, ancla, app:, mailto:)                                                          |
| CA5      | `src/renderer/src/components/markdown-color.test.ts`, `CA5 (0043)` (`readableColor` y el visor, ≥ 3:1 en claro y en oscuro) y `src/main/env-colors.test.ts`, `CA5 (0043): los fondos del ajuste…` (`THEME_BACKGROUNDS` = `--background` de `main.css`)                                                                                                                          |
| CA6      | `MarkdownText.test.ts`, `CA10 (0001), actualizado por CA6 (0043)` (lo peligroso no crea elementos; `b` se interpreta; `<` y `>` sueltos y el código en línea siguen siendo texto) y `MarkdownText.visual.test.ts`, `CA5 (0038), actualizado por CA6 (0043)` (en aviso y marca: b sí, img y `on*` no, la capa visual sigue; en un bloque de código, texto)                       |
| CA7      | `MarkdownText.html.test.ts`, `CA7 (0043)` (`rehype-raw` y `rehype-sanitize` con versión exacta)                                                                                                                                                                                                                                                                                 |

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
- **`background-color`:** se conserva si es válido; la ficha no dice si se ajusta su contraste ni
  el del texto sobre él (abierto, ver abajo).
- Ayudas compartidas de los tests en `src/test/html-tree.ts` (árbol del HTML estático y colores).

**Abierto para Dani (no cubierto por ningún test):** un `background-color` claro con el texto por
defecto del tema oscuro (claro) puede quedar ilegible; la ficha solo habla del color del texto frente
al fondo del tema.

## Resultado

(pendiente)
