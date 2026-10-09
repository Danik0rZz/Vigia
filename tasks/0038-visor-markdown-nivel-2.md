---
id: '0038'
titulo: 'Visor de Markdown: capa visual cuidada (código con colores y números de línea, avisos y marcas)'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: markdown
depende_de: ['0035']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0038-visor-markdown-nivel-2
adrs: [8]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Lote «markdown» (0035, 0038 y 0043). Dani (2026-10-09): "Es interesante tener también los decoradores
bonitos para que se pueda ver, por ejemplo, colores según cómo esté marcado el dato o el tipo de la
anotación. … La idea es que el visor de markdowns tenga una capa visual bonita y cuidada. Creo que
es el siguiente nivel." Pasó una captura de su ejemplo: títulos grandes, listas con ✓, código en
línea resaltado en un tono morado y un bloque de código YAML con números de línea y un botón de
copiar.

## Especificación

**Decisiones de Dani (2026-10-09), al aprobar:** el HTML de formato de las descripciones se
interpreta con lista blanca (ficha 0043, "la fuente es fiable, pondremos los controles"); Dani ha
añadido `VIGIA_LIVE_PROBLEM_ID` en los dos `.env.live.local` (checkout principal y worktree del
Orquestador) con el problema de su ejemplo.

Todo en `MarkdownText.tsx`, así que vale para todas las descripciones. Con lo que diga la medición
de la 0035:

- **Bloques de código:** caja con borde y fondo propios, **números de línea** en una columna
  apagada, **colores por lenguaje** (resaltado de sintaxis) y botón **«Copiar»** arriba a la
  derecha (copia el bloque por `app:copyText`, con aviso). Si el bloque no dice lenguaje, sin
  colores.
  - Librería propuesta: `rehype-highlight` (usa highlight.js; genera clases, no HTML ni
    `eval`, así que cabe en la CSP actual), con versión exacta y **solo los lenguajes que
    encuentre la 0035** más `yaml`, `json`, `bash`, `sql`, `javascript`, `typescript`, `python`,
    `java` y `xml`, para no cargar todos. Colores del tema (claro y oscuro) en CSS propio.
- **Código en línea:** píldora con fondo de acento suave y texto en el color de acento (como el
  morado de la captura), monoespaciado.
- **Avisos de GitHub** (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`): caja con
  borde izquierdo de color, icono y título del tipo (información, consejo, importante, aviso,
  peligro), en es y en. Sin librería: se reconoce el primer párrafo de la cita.
- **Marcas al principio de un elemento de lista o párrafo:** ✓ ✔ ✅ en verde, ✗ ✘ ❌ en rojo y ⚠ en
  ámbar (con el color del tema; el símbolo ya es la señal, el color la refuerza).
- **Tipografía:** títulos con su jerarquía de tamaños y separación, separadores (`---`) finos,
  tablas con cabecera marcada y filas alternas, citas con borde, listas con aire.
- **Seguridad sin cambios en esta ficha (ADR-0008):** el HTML en crudo sigue sin interpretarse aquí.
  Dani decidió (2026-10-09) interpretar el HTML de formato con lista blanca: lo hace la ficha 0043,
  que va justo después.

## Criterios de aceptación

- CA1 (unitario de componente): un bloque ` ```yaml ` sale con números de línea (uno por línea) y
  con clases de resaltado en sus tokens; uno sin lenguaje, con números y sin clases.
- CA2 (e2e): «Copiar» de un bloque deja en el portapapeles el código exacto del bloque (sin los
  números) y enseña el aviso.
- CA3 (unitario de componente): los cinco avisos de GitHub salen como caja con su título del tipo
  (es y en) y su clase de color; una cita normal sigue siendo una cita.
- CA4 (unitario de componente): un elemento de lista que empieza por ✓ lleva la clase de éxito, uno
  por ✗ la de error y uno por ⚠ la de aviso.
- CA5 (unitario de componente): el HTML en crudo sigue saliendo como texto (los tests de la 0001
  siguen pasando).
- CA6 (unitario): solo se registran los lenguajes de la lista (un lenguaje fuera de ella sale sin
  colores) y la dependencia va con versión exacta.
- CA7 (unitario): contraste de los colores nuevos en claro y oscuro (test de contraste de `check`).
- CA8 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Abrir el problema del ejemplo y comprobar que se ve como la captura o mejor, en claro y en oscuro.

## Fuera de alcance

- El HTML de formato (ficha 0043).
- Diagramas (Mermaid) y fórmulas.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA8 con su test, sin tocar tests tras `08d7c38`. `lowlight` 3.3.0 y `highlight.js` 11.11.2
con versión exacta en devDependencies, como el resto de librerías solo del renderer (Vite las mete
en el bundle); `highlight.js` una sola vez en el lockfile. El plugin propio en lugar de
`rehype-highlight` está justificado (9 lenguajes, no 37). Los plugins solo cambian el árbol: sin
HTML crudo, `rehype-raw`, `style` en línea ni cambios de CSP o `harden.ts` (ADR-0008). «Copiar» por
`app:copyText`. Colores en `:root` y oscuro; `.hljs-*` solo con `var(--md-hl-*)`.

Sugerencias, no bloquean:

1. Contraste: el título del aviso va sobre `bg-hover` encima de la fila de detalle y la tarjeta;
   en claro, `--md-alert-caution` y `--md-alert-important` rondan 4,3–4,6:1. Quitar el fondo de
   `.md-alert` u oscurecer esos dos tokens.
2. `li` con marca pierde también el número en un `ol`: limitar `list-style: none` a `ul > li`.
3. Doc-writer: lowlight y highlight.js a «Versiones fijadas» de `docs/ARCHITECTURE.md` (el
   ADR-0008 no se edita; lo sustituye el ADR nuevo de la 0043).

## Verificación

**Tests escritos (test-writer, 2026-10-09):** commit `08d7c38`. Todos los nuevos fallan porque la
capa visual aún no existe; los de CA5, la cita normal, `[!INFO]`, la marca en medio del texto y los
dos de guarda de CSS (mismos `--md-hl-*` en los dos temas, sin hojas de highlight.js) ya pasan, como
regresión.

| Criterio | Test                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `src/renderer/src/components/MarkdownText.visual.test.ts`, `CA1 (0038): bloques de código…` (yaml con números y `hljs-*`; sin lenguaje, con números y sin `hljs-*`; una línea, un número)     |
| CA2      | `e2e/views.spec.ts`, `CA2 (0038): «Copiar» de un bloque copia su código exacto…` (bloque YAML de P-835, fixture de la 0035)                                                                   |
| CA3      | `MarkdownText.visual.test.ts`, `CA3 (0038): avisos de GitHub` (los cinco en es y en, minúsculas, cita normal y `[!INFO]` siguen siendo cita)                                                  |
| CA4      | `MarkdownText.visual.test.ts`, `CA4 (0038): marcas…` (✓ ✔ ✅ / ✗ ✘ ❌ / ⚠ en `li` y en `p`; en medio del texto, ninguna)                                                                      |
| CA5      | `MarkdownText.test.ts` (0001, sin cambios) y `MarkdownText.visual.test.ts`, `CA5 (0038)` (HTML en crudo dentro de aviso, elemento con marca y bloque de código)                               |
| CA6      | `MarkdownText.visual.test.ts`, `CA6 (0038)` (los 9 lenguajes con colores; rust, go, ruby y cpp sin colores y con números; `rehype-highlight`, `highlight.js` o `lowlight` con versión exacta) |
| CA7      | `src/main/env-colors.test.ts`, `CA7 (0038): contraste del visor de Markdown` (claro y oscuro) y `CA7 (0038): los colores de sintaxis salen del tema`                                          |
| CA8      | `src/renderer/src/locales/markdown-viewer.test.ts`, `CA8 (0038)` (más la paridad de `locales.test.ts`)                                                                                        |

**Contrato elegido al escribir los tests (la ficha no fija nombres; decisión delegada por Dani,
refinable):**

- Números de línea: un elemento por línea con `data-line-number="N"`, fuera del `code`, cuyo texto
  es exactamente el código (sin salto final). Tokens con las clases `hljs-*` de highlight.js.
- Bloque en la interfaz: `data-testid="md-code-block"`, botón `md-code-copy` con el texto «Copiar»
  (`markdown.copyCode`) y aviso `md-code-copy-status` con `errorScreen.copied` («Copiado»), como el
  «Copiar» de la descripción. Copia el código sin salto final.
- Avisos: caja con clases `md-alert` y `md-alert-<tipo>` (`note`, `tip`, `important`, `warning`,
  `caution`), título delante del cuerpo y sin el marcador `[!TIPO]`; el marcador en minúsculas
  también vale (como GitHub) y un tipo desconocido (`[!INFO]`) sigue siendo cita. Títulos:
  `markdown.alerts.<tipo>`: es Información, Consejo, Importante, Aviso, Peligro; en Note, Tip,
  Important, Warning, Caution (los de GitHub; la ficha no daba los ingleses).
- Marcas: el `li` o el `p` que empieza por la marca lleva `md-mark-success`, `md-mark-error` o
  `md-mark-warning`; el símbolo se sigue viendo.
- Colores: tokens `--md-*` en `main.css`, #rrggbb, en `:root` y en el bloque oscuro:
  `--md-code-bg`, `--md-line-number`, al menos cuatro `--md-hl-*` (distintos entre sí),
  `--md-inline-code` y `--md-inline-code-bg`, `--md-mark-success|error|warning` y
  `--md-alert-note|tip|important|warning|caution`. Texto ≥ 4.5 frente a su fondo (el del bloque, la
  píldora o `--background`). Las reglas `.hljs*` de `main.css` usan `var(--md-hl-*)`, sin colores
  fijos, y no se importa ninguna hoja de `highlight.js/styles`.
- La 0035 solo vio `yaml` en vivo (`docs/notas-api-v2.md`), así que la lista es la de la ficha.

**Decisiones del developer (2026-10-09, delegadas por Dani, refinables):**

- **Librería:** `lowlight` 3.3.0 (MIT) y `highlight.js` 11.11.2 (BSD-3-Clause), en
  devDependencies como `react-markdown` (solo van al bundle del renderer), con versión exacta. No
  `rehype-highlight`: importa el conjunto `common` de lowlight (37 lenguajes) y lo metería en el
  bundle aunque solo se registren nueve. En su lugar, un plugin de rehype propio de pocas líneas
  (`markdown-plugins.ts`) que llama a lowlight con los nueve lenguajes registrados uno a uno (sus
  alias, como `yml`, `sh`, `js` o `ts`, vienen con cada gramática). Genera nodos del árbol, no
  HTML ni `eval`: el ADR-0008 y la CSP no cambian.
- **Avisos y marcas** también son plugins de rehype en `markdown-plugins.ts`. El marcador
  `[!TIPO]` solo cuenta si va solo en su línea (como GitHub). La marca se separa en un `span`
  (`md-mark-glyph`) para colorear solo el símbolo; el elemento de lista con marca pierde la viñeta.
- **Cabecera del bloque:** el lenguaje a la izquierda y «Copiar» a la derecha (en una cabecera, no
  encima del código, para no tapar la primera línea). El botón lleva `aria-label` «Copiar el bloque
  de código» (`markdown.copyCodeLabel`), que contiene el texto visible.
- **Estilos:** clases `md-*` en `@layer components` de `main.css` (el contenido lo genera
  react-markdown) y tokens `--md-*` en los dos temas; colores de sintaxis inspirados en los de
  GitHub, ajustados a 4,5:1.

### Verifier, 2026-10-09, commit `d5306d8`, rango `main..feat/0038-visor-markdown-nivel-2`: VERDE

- `npm ci --ignore-scripts` con las dependencias nuevas: bien.
- check: 2735 tests en 156 ficheros, cobertura ok.
- e2e completo: 304/304.

## Resultado

(pendiente)
