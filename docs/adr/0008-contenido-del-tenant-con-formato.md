# ADR-0008: Contenido del tenant con formato (Markdown) en la interfaz

Estado: aceptado (2026-10-06). Ficha: 0001

## Contexto

Algunos textos que llegan de Dynatrace vienen en Markdown (el primero, `dt.event.description` en
las evidencias de un problema) y se leen mejor con formato. Es contenido del tenant: no es de
confianza, puede traer HTML en crudo, enlaces con cualquier esquema (`javascript:`, `file:`,
`data:`…) e imágenes remotas. La app tiene una CSP estricta sin orígenes remotos (`csp.ts`), todos
los permisos web denegados y las ventanas nuevas desviadas al navegador del sistema
(`setWindowOpenHandler` en `harden.ts`).

## Decisión

Regla general para pintar contenido del tenant con formato:

- Se pinta con `react-markdown` + `remark-gfm` (CommonMark + GFM), que construye elementos de React
  sin pasar por HTML. Componente común: `src/renderer/src/components/MarkdownText.tsx`.
- **Sin HTML en crudo:** se ve como texto. Nunca `dangerouslySetInnerHTML` ni `rehype-raw`.
- **Enlaces:** solo `http:` y `https:` son clicables, con `target="_blank"` y
  `rel="noopener noreferrer"`, y se abren en el navegador del sistema. Los demás esquemas pierden
  el `href` (`urlTransform`) y se pintan como texto.
- **Sin recursos remotos:** las imágenes nunca crean un `img`; se ve su texto alternativo o, si no
  tiene, la URL como texto.
- **La CSP y `harden.ts` no cambian** para esto.
- Main recorta el texto a un tope (con `.max()` en el esquema Zod del IPC) y no lo escribe en el log.
- Siempre hay forma de ver y copiar el texto original («Texto original» y «Copiar»).

## Alternativas descartadas

- Pasar el Markdown a HTML (marked, markdown-it) y sanearlo con DOMPurify: obliga a
  `dangerouslySetInnerHTML` y deja la seguridad en la configuración del saneador.
- Mostrar solo el texto original: es lo que había y se lee peor (tablas y listas).
- Permitir imágenes ampliando la CSP: abre orígenes remotos y filtra al tenant que se ha leído.

## Consecuencias

Cualquier otro contenido del tenant con formato reutiliza `MarkdownText` y estas reglas; ampliarlas
(imágenes, otros esquemas, HTML) necesita un ADR que sustituya a este. Las dos librerías van en
devDependencies (solo al bundle del renderer, unos 48 kB gzip). `remark-gfm` trae textos fijos en
inglés para las notas al pie.

## Actualización (2026-10-06, ficha 0002)

A petición de Dani se quitó el conmutador «Con formato · Texto original»: la descripción se pinta
siempre con `MarkdownText`. El texto original se obtiene con «Copiar», que copia el Markdown tal
cual. Las reglas de seguridad de este ADR no cambian.
