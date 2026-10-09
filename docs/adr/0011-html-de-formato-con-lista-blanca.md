# ADR-0011: HTML de formato en el contenido del tenant, con lista blanca

Estado: aceptado (2026-10-09). Sustituye la regla del HTML en crudo del ADR-0008. Ficha: 0043

## Contexto

El ADR-0008 decidió que el HTML en crudo dentro del Markdown del tenant se ve como texto. Las
descripciones reales traen HTML de formato (`<span style="color:…">`, `<b>`, `<mark>`…) y salía
escrito tal cual, feo e ilegible. Dani decidió el 2026-10-09: "La fuente es una fuente fiable, por lo
que pondremos los controles correspondientes, pero hay que interpretarlo para que quede bonito."
Sigue siendo contenido que llega de fuera: la CSP estricta, los permisos web denegados y las ventanas
nuevas desviadas al navegador no cambian.

## Decisión

El HTML de formato se interpreta, pero solo lo que está en una lista blanca. Se sigue sin
`dangerouslySetInnerHTML`: React crea el DOM a partir del árbol saneado. Las demás reglas del
ADR-0008 (enlaces, sin recursos remotos, tope en main, «Copiar») siguen vigentes.

- **Plugins:** `rehype-raw` 7.0.0 interpreta el HTML y `rehype-sanitize` 6.0.0 aplica una lista
  blanca propia (`markdown-html.ts`), las dos con versión exacta y licencia MIT. Orden en
  `MarkdownText`: proteger el Markdown, `rehype-raw`, `rehype-sanitize`, restaurar, colores
  (`markdown-color.ts`) y, al final, avisos, marcas y resaltado de código. Nada de lo posterior
  reintroduce HTML, y una clase escrita en el HTML nunca llega a la capa visual.
- **Etiquetas permitidas:** las de formato (`span`, `mark`, `b`, `strong`, `i`, `em`, `u`, `s`,
  `del`, `sub`, `sup`, `small`, `kbd`, `br`, `hr`, `code`, `pre`), de estructura (`p`, `div`, listas,
  tablas con sus partes, `details`, `summary`, `h1` a `h6`, `blockquote`), `a` y `font` (solo
  `color`).
- **Atributos:** `title`; `href` solo en `a`; `color` en `font`; y `style` reconstruido, no
  filtrado: solo `color` y `background-color` con valores válidos (`#rgb`, `#rrggbb`, `rgb()` y
  `rgba()` con números, o un nombre de color CSS). El `style` que llega al DOM se genera desde el
  color ya analizado (`#rrggbb` o `rgba` numérico), así que no pasa ningún carácter del original.
  Fuera `class`, `id`, `on*`, `srcset`, `data-*` y cualquier otra declaración.
- **Lo que se quita, y cómo:** `script`, `style`, `template`, `noscript`, `iframe`, `object`,
  `embed`, `svg`, `math`, `textarea`, `select`, `button`, `video`, `audio`, `picture`, `map` y
  similares se quitan **con su contenido**; `img`, `form`, `link`, `meta` y `base` tampoco se crean.
  Cualquier otra etiqueta desconocida se quita y deja su texto.
- **Enlaces:** solo `http:` y `https:` son clicables, con `target="_blank"` y
  `rel="noopener noreferrer"`; el HTML no puede cambiar `target` ni `rel`. Los demás esquemas
  (`javascript:`, `data:`, relativos, `//`, anclas, `mailto:`) quedan como texto.
- **Marca `data-vigia-slot`:** los elementos que genera el propio Markdown (casillas de tareas,
  notas al pie, clases `language-*`, alineación de tablas) no pasan por la lista de atributos. Antes
  de `rehype-raw` se guardan sus propiedades y se marcan con `data-vigia-slot` = un valor aleatorio
  de la sesión (128 bits) y un índice; el saneado solo admite la marca con ese valor exacto, se
  quita de todos los nodos antes del DOM y una marca escrita en el HTML se descarta.
- **Legibilidad:** el color de texto se ajusta, sin cambiar el tono, hasta un contraste de al menos
  3:1 con el fondo del tema, en claro y en oscuro a la vez, para que nunca quede texto invisible. Un
  `background-color` solo se conserva si el texto que queda encima se lee a 3:1 en los dos temas; si
  no, se quita. Los colores se miden contra lo heredado del elemento padre.
- **La CSP y `harden.ts` no cambian** (`style-src 'unsafe-inline'` ya existía).

## Alternativas descartadas

- Seguir mostrando el HTML como texto (ADR-0008): es lo que Dani rechazó por ilegible.
- Pasar a HTML y sanearlo con DOMPurify: obliga a `dangerouslySetInnerHTML` y deja la seguridad en
  la configuración del saneador.
- Admitir `style` completo o con más propiedades: abre `position`, `background:url()` y fugas hacia
  fuera. Se reconstruye solo con color.
- Admitir `class` e `id`: permitirían imitar los avisos y marcas del propio visor.
- Confiar en la fuente sin lista blanca: la fuente es fiable, pero los controles son baratos y el
  texto lo escribe gente.

## Consecuencias

El contenido del tenant con formato sigue pasando por `MarkdownText`. Ampliar la lista (más
etiquetas, otras propiedades de `style`, imágenes) necesita un ADR que sustituya a este. Dos
dependencias nuevas en devDependencies (solo al bundle del renderer). Un test mantiene cero
`dangerouslySetInnerHTML` en el renderer. El ADR-0008 sigue vigente salvo en el HTML en crudo.
