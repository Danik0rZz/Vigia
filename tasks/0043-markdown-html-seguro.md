---
id: '0043'
titulo: 'Visor de Markdown: interpretar el HTML de formato de las descripciones, con lista blanca'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(pendiente)

## Resultado

(pendiente)
