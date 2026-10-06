---
id: '0001'
titulo: Descripción del evento con formato Markdown en el detalle del problema
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0001-descripcion-evento-markdown
adrs: [2, 4, 5]
adr_nuevo: Contenido del tenant con formato (Markdown) en la interfaz — sin HTML, sin recursos remotos
api: v2 (sin endpoints nuevos; `GET /problems` y `GET /problems/{problemId}?fields=evidenceDetails`, ya en uso; `evidenceDetails.details[].data.properties[]`; `docs/notas-api-v2.md`, "Eventos con dt.event.metric_selector")
migracion: no
rondas_revision: 0
---

## Petición original

"Dentro de problemas, cuando se consulta el detalle de uno, cuando se hace el desglose por cada
entidad afectada, hay un property de `dt.event.description` que estaría guay mostrarla con un lector
de markdown, ya que vienen en ese formato y hay veces que verlo bonito es una mejora chula."

Después, sobre el límite de longitud: "Mídelo". Y sobre el conmutador entre formato y texto
original: que vaya en esa parte del desplegable que se abre al pulsar la fila.

## Especificación

**Dónde.** Tabla de evidencias del detalle del problema (v0.10.0), fila desplegada (al pulsarla) de
una evidencia `EVENT` (`EventDetail` en `src/renderer/src/components/EvidenceSection.tsx`).

**Qué llega hoy.** Main manda como mucho 8 propiedades de `data.properties`, cada una recortada a 300
caracteres (`MAX_EVENT_PROPERTIES` y `MAX_PROPERTY_LENGTH` en `src/main/modules/problems.ts`), y la
interfaz las pinta siempre como texto. `dt.event.description` no está en la OpenAPI como clave fija:
es una propiedad observada (`docs/notas-api-v2.md`), con `value` de texto. Con el recorte actual una
descripción larga llega cortada (Markdown roto) o ni llega si va después de la octava propiedad.

**0. Medir primero (lo pidió Dani).** Antes de fijar el tope, el test-writer escribe
`src/main/modules/problems-event-description.live.test.ts` con el mismo patrón que
`problems-event-metric.live.test.ts`: solo lectura, `GET /problems` (`from: now-7d`) y como mucho 10
`GET /problems/{problemId}?fields=evidenceDetails`. El informe (`live-reports/`, ignorado) guarda
**solo comportamientos, nunca el texto ni un id**:

- proporción de evidencias `EVENT` con `dt.event.description` y si su `value` es siempre texto;
- su posición en `data.properties` (proporción de las que quedan después de la octava);
- longitudes: mínima, mediana, máxima y tramos (≤300, ≤1 000, ≤5 000, ≤10 000, ≤20 000, más);
- proporción con rasgos de Markdown (títulos, listas, negrita, código, tablas, enlaces, imágenes)
  y con HTML en crudo (`<etiqueta`);
- esquemas de los enlaces que aparezcan (`http`, `https`, otros), solo el esquema;
- si la descripción sale en alguna línea del log del cliente.

El developer lo lanza con `npm run test:live` y fija `MAX_DESCRIPTION_LENGTH` así: **el doble de la
máxima observada, redondeado hacia arriba al millar, con un mínimo de 5 000 y un máximo de 20 000**
(el límite del canal `app:copyText`, que no se amplía). Si la máxima observada pasa de 20 000, se
para y se escala a Dani. El valor elegido y su porqué quedan en "Resultado" y en una sección nueva
de `docs/notas-api-v2.md` (lo escribe el doc-writer, sin datos del tenant).

**1. Main extrae la descripción aparte**, igual que ya se hace con `dt.event.metric_selector`: sobre
las propiedades en crudo, el primer `dt.event.description` cuyo `value` sea texto no vacío (sin
contar espacios), recortado a `MAX_DESCRIPTION_LENGTH` y marcado `truncated: true` si se recorta. Va
en un campo nuevo de la evidencia (por ejemplo `description: { text, truncated } | null`), con su
esquema Zod en `src/shared/problem-evidence.ts` (el campo no puede llamarse `value`: la guarda del
IPC lo bloquea). La clave deja de ocupar sitio en las 8 propiedades genéricas.

**2. Sección «Descripción» dentro del desplegable**, la primera del detalle del evento:

- Por defecto, **con formato**: Markdown CommonMark + GFM (títulos, listas, negrita y cursiva,
  código en línea y en bloque, tablas, citas y enlaces).
- Un conmutador **«Con formato · Texto original»** en la cabecera de la sección. «Texto original»
  enseña el Markdown tal cual (monoespaciado, respetando saltos de línea). La elección es por
  evento y no se guarda: al plegar y volver a desplegar, o en otro evento, vuelve a «Con formato».
- Un botón **«Copiar»** que copia el texto original (el que llegó de main) por `app:copyText`, con
  el mismo aviso de copiado que «Copiar detalles» de las pantallas de error.
- Con el teclado: el conmutador y «Copiar» son alcanzables con Tab dentro del detalle y no rompen
  Enter (desplegar) ni Escape (plegar) de la fila.
- Si viene recortada, una nota debajo lo dice.
- Ya no se repite en la lista de propiedades. Textos nuevos en es y en.

**3. Seguridad (contenido del tenant, no fiable):**

- El HTML en crudo dentro del Markdown no se interpreta: se muestra como texto (nunca
  `dangerouslySetInnerHTML` ni `rehype-raw`).
- Enlaces: solo `http:` y `https:` son clicables y se abren en el navegador del sistema
  (`target="_blank"` + `rel="noopener noreferrer"`, que ya recoge `setWindowOpenHandler` de
  `src/main/security/harden.ts`). Otros esquemas (`javascript:`, `file:`, `data:`…) se muestran
  como texto, sin enlace.
- Imágenes: no se cargan nunca; se muestra su texto alternativo o, si no tiene, la URL como texto.
- La CSP y `harden.ts` no cambian.

**4. Librería propuesta:** `react-markdown` + `remark-gfm`, con versión exacta y como dependencias
de desarrollo (van al bundle del renderer, como el resto de librerías de interfaz). Motivo: construye
elementos de React sin pasar por HTML, escapa el HTML por defecto y deja sustituir los componentes
de enlace e imagen. Si el developer ve un problema con el React Compiler o con el tamaño, lo anota y
lo plantea en revisión.

**5. Estilos:** los del tema actual (`text-xs` como el resto del detalle, colores del tema para que
pase el test de contraste), sin plugin de tipografía nuevo. Tablas y bloques de código con scroll
horizontal propio para no romper el ancho de la fila.

**ADR nuevo** (lo escribe el doc-writer): regla general para pintar contenido del tenant con
formato: sin HTML en crudo, solo enlaces http/https al navegador del sistema, sin recursos remotos y
sin tocar la CSP.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
`MAX_DESCRIPTION_LENGTH` es la constante fijada en el paso 0.

- CA1 (live, solo lectura): `problems-event-description.live.test.ts` genera su informe con los
  campos del paso 0 y sin texto de descripciones, ids ni nombres (el test comprueba que ningún
  valor del informe contiene una descripción observada). Se salta sin `.env.live.local`, como los
  demás.
- CA2 (unitario, main): de unas propiedades en crudo con `dt.event.description` en cualquier
  posición (también después de la octava), la evidencia trae la descripción entera en su campo
  propio, y esa clave no aparece en la lista de propiedades genéricas.
- CA3 (unitario, main): una descripción de más de `MAX_DESCRIPTION_LENGTH` caracteres llega
  recortada a esa longitud con `truncated: true`; una de esa longitud o menos llega entera con
  `truncated: false`. `MAX_DESCRIPTION_LENGTH` está entre 5 000 y 20 000.
- CA4 (unitario, main): sin la clave, con `value` que no es texto o con texto vacío o solo
  espacios, el campo es `null`.
- CA5 (unitario, shared): el esquema Zod de la evidencia acepta el campo nuevo y rechaza un texto
  de más de `MAX_DESCRIPTION_LENGTH` caracteres.
- CA6 (e2e): al desplegar un evento con descripción en Markdown (fixture con título, lista,
  negrita, código y tabla), la sección «Descripción» sale la primera y contiene los elementos
  renderizados (`h*`, `li`, `strong`, `code`, `table`), no los símbolos de Markdown.
- CA7 (e2e): «Texto original» enseña el Markdown tal cual (con sus `#`, `-`, `**`) y sin esos
  elementos; «Con formato» vuelve a renderizarlo. Al plegar y volver a desplegar la fila, sale
  otra vez «Con formato».
- CA8 (e2e): «Copiar» llama a `app:copyText` con el texto original exacto (también estando en «Con
  formato») y se ve el aviso de copiado.
- CA9 (e2e): con el teclado, Tab llega al conmutador y a «Copiar» dentro del detalle, se activan
  con Enter o Espacio, y Escape sigue plegando la fila.
- CA10 (e2e o unitario de componente): el HTML en crudo de la descripción (por ejemplo
  `<img src=x onerror=…>` o `<script>`) se ve como texto y no crea esos elementos en el DOM.
- CA11 (unitario de componente): un enlace `https:` se pinta con `target="_blank"` y
  `rel="noopener noreferrer"`; uno `javascript:` o `file:` se pinta como texto sin `a`.
- CA12 (unitario de componente): una imagen de Markdown no crea ningún `img`; se ve su texto
  alternativo o, si no tiene, la URL.
- CA13 (e2e): con una descripción recortada se ve la nota de recorte; sin recorte, no.
- CA14 (e2e): un evento sin descripción no muestra la sección «Descripción» y el resto del detalle
  (propiedades, zonas, etiquetas, mini gráfico) sigue igual.
- CA15 (unitario): los textos nuevos existen en es y en (lo cubre el test de paridad de `check`).

## Pruebas a mano para Dani

- Con problemas reales del tenant, que las descripciones se ven bien (listas, tablas, enlaces), que
  los enlaces abren el navegador del sistema y que «Copiar» pega el texto original.
- Que ninguna descripción real sale con la nota de recorte (si alguna sale, avisar).

## Fuera de alcance

- Otras propiedades en Markdown (solo `dt.event.description`).
- Descripción en otros sitios (lista de Problemas, Eventos, exportación a Excel: la exportación no
  lleva propiedades y no cambia).
- Recordar la elección «Con formato / Texto original» entre eventos o sesiones.
- Resaltado de sintaxis en los bloques de código.
- Cambios en la CSP, en `harden.ts` o en el límite de `app:copyText`.

## Ideas surgidas (fuera de alcance)

- (developer) La nota de recorte podría ofrecer pedir la descripción entera a main bajo demanda si
  algún día aparecen descripciones de más de 5 000 caracteres.

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `ea0fcf2` (test-writer, antes del código; fallan por falta de implementación):

- CA1: `src/main/modules/problems-event-description.live.test.ts` (`CA1 (0001)`). Se ejecutó en
  esta máquina (solo lectura, 11 peticiones) y dejó su informe en `live-reports/`.
- CA2, CA3 y CA4: `src/main/modules/problems-event-description.test.ts` (un `describe` por
  criterio). Esperan `MAX_DESCRIPTION_LENGTH` exportada de `src/shared/problem-evidence.ts` y el
  campo `description: { text, truncated } | null` en la evidencia.
- CA5: `src/shared/problem-evidence-description.test.ts`.
- CA10, CA11 y CA12 (y un apoyo unitario de CA6): `src/renderer/src/components/MarkdownText.test.ts`.
  Contrato que fija el test: `export function MarkdownText({ text }: { text: string })` en
  `src/renderer/src/components/MarkdownText.tsx`, sin proveedores (se pinta con
  `renderToStaticMarkup`).
- CA6, CA7, CA8, CA9, CA10, CA13, CA14 y CA15: `e2e/views.spec.ts`, tests `CAn (0001)` sobre el
  problema simulado P-785 (`pd-desc`). data-testid que esperan: `evidence-description`,
  `evidence-description-mode-formatted` y `evidence-description-mode-original` (con
  `aria-pressed`), `evidence-description-copy`, `evidence-description-copy-status` (texto de
  `errorScreen.copied`) y `evidence-description-truncated`. CA14 ya pasa: comprueba que sin
  descripción no cambia nada. CA15 lo cubre además la paridad de `locales.test.ts` en `check`.
- Corrección en `3f07bf8` (sin cambiar criterios): el detector del test live no veía tablas GFM
  compactas (`|a|b|` con `|:--|`) ni contaba los escapes con barra invertida; ahora sí. Medido de
  nuevo: 25 % de las descripciones con rasgos de Markdown (tablas y escapes), máxima de 245
  caracteres. CA6, CA7 y `MarkdownText.test.ts` prueban esa forma: tabla compacta con fila de
  alineación y escapes `\.` y `\(9\)`, que con formato se ven sin la barra invertida y en «Texto
  original» con ella.
- Ajustados a la ficha: los e2e «v0.10.0: desplegar con clic…» y «v0.9.1: tarjetas de cambio…»
  esperan `dt.event.description` en su sección y no en las propiedades.

## Resultado

Implementado por el developer en `c141bcb`, `c28b7e7` y `a4fe8e8`.

- **MAX_DESCRIPTION_LENGTH = 5 000** (`src/shared/problem-evidence.ts`). Medición del paso 0
  (informe en `live-reports/`, 10 detalles, 11 peticiones): máxima observada de 245 caracteres;
  el doble redondeado al millar es 1 000, así que queda en el mínimo de la regla, 5 000. Ninguna
  descripción salió en el log del cliente ni había HTML en crudo.
- Main (`eventDescription` en `src/main/modules/problems.ts`): la primera
  `dt.event.description` con texto no vacío, tal cual (sin quitar espacios) y recortada a 5 000.
  En un EVENT, **todas** las apariciones de la clave salen de las 8 propiedades genéricas (también
  las que no son texto o están vacías: así nunca se repite la clave). Las evidencias que no son
  EVENT llevan `description: null`, como `eventMetric`, y no se les quita la clave.
- Campo nuevo obligatorio (`.nullable()`, no `.optional()`) en `evidenceWireSchema` y
  `event.description` en `EvidenceView`. Los fixtures de tests anteriores que construyen la
  evidencia completa solo añaden `description: null` (`problems.test.ts` en `emptyWire` y en el
  `toEqual` de METRIC, `problem-evidence.test.ts` en `wire()` y en el `toEqual` de EVENT,
  `evidence-table.test.ts` y `problem-workbook.test.ts`).
- Interfaz: `MarkdownText.tsx` (react-markdown 10.1.0 + remark-gfm 4.0.1, exactas y en
  devDependencies; unos 157 kB minificados, 48 kB gzip, sobre un bundle de 4,2 MB; sin avisos del
  React Compiler) y `EvidenceDescription.tsx`. El título de la sección es `role="heading"`
  `aria-level=4` y no un `h4`: los `h*` de la sección son solo los del Markdown (CA6 y CA10 los
  cuentan). Los enlaces no web pierden el href en `urlTransform` y se pintan como texto; el
  `src` de las imágenes nunca llega a un `img`. Si la copia falla se ve `errorScreen.copyFailed`,
  como en las pantallas de error. La nota de recorte dice el tope y que «Copiar» copia lo recortado.
- **Conflicto de tests para el Orquestador:** `src/test/live-usage.test.ts` (guarda existente de
  las pruebas en vivo) falla con `problems-event-description.live.test.ts`: su patrón
  `['"](https?|net|tls|http2)['"]` toma los literales `'http'` y `'https'` de `KNOWN_SCHEMES`
  por un import de red. No es del código de la ficha (falla igual en `cb83914`) y no he tocado
  ninguno de los dos. Opciones: escribir los esquemas en el test live sin ese literal suelto (por
  ejemplo `'http:'`) o ceñir el patrón de la guarda a `from`/`import(`/`require(`.
- `npm run check`: lint, tipos y formato en verde; 1873 de 1874 tests (el de arriba); cobertura
  91,15 / 90,54 / 87,22 / 91,58 sin ese test. e2e (completo, por `package*.json` y
  `areas.json`): 168 de 169; falla solo `views.spec.ts:1721` (el `:1605` de `main` en
  BACKLOG.md, 140 en vez de 150). Los diez e2e de la ficha y los dos ajustados, en verde.
