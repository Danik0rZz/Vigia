# ADR-0015: Avisos de Telegram con tarjeta en imagen

Estado: aceptado (2026-10-12). Ficha: 0104. Amplía el ADR-0009.

## Contexto

El aviso de Telegram del ADR-0009 es texto plano de 1 500 caracteres como mucho. Dani quiere que el
aviso sea una evolución importante: más información (revisión, verifier, CI, duración, rama, PR) y
resúmenes en Markdown con más detalle, sin recortarlos para que quepan. El formato propio de
Telegram (`parse_mode`) no admite tablas ni bloques de código con colores y exige escapar a mano
cada carácter. Una tarjeta en imagen sí, y se ve igual en cualquier móvil.

La ficha 0104 construye solo el HTML de la tarjeta (`scripts/telegram-card.mjs`, función pura
`buildCardHtml(datos)`); capturarlo y enviarlo es la 0105. El resumen lo escriben los agentes, así
que es texto no fiable que se pinta en HTML.

## Decisión

- **Una tarjeta HTML autónoma:** documento completo con el CSS en línea, fuente del sistema y nada
  externo (ni fuentes, ni imágenes, ni scripts por URL). Lleva su propia CSP
  (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`; las imágenes `data:` son para la
  0108).
- **Markdown y resaltado con lo ya instalado, sin dependencias nuevas:** `react-markdown`,
  `remark-gfm`, `rehype-sanitize` y `lowlight`, pintados con `react-dom/server`. Nada de CDN.
- **Qué se permite en el resumen:** `skipHtml` (el HTML crudo ni se interpreta ni sale como texto,
  sin `rehype-raw`) y `rehype-sanitize` con lista blanca propia: títulos, párrafos, `strong`, `em`,
  `del`, `code`, `pre`, citas, listas, tablas, `br` y `hr`. Atributos solo `language-*` en `code` y
  `start` en `ol`. Sin `a` ni `img`: el enlace deja su texto y la imagen desaparece. Los colores
  (`hljs-*`) y las marcas `data-bloque` se añaden después del saneado, desde `lowlight` y el propio
  módulo, nunca desde el resumen. El resto de campos va como texto de React (el `<title>` con
  escape explícito).
- **Por qué no el formato de Telegram para el resumen:** sin tablas ni colores, escapado frágil y
  un fallo de formato hace que Telegram rechace el mensaje entero.
- **Sin recortar el detalle:** solo un tope de seguridad de 20 000 caracteres contra un JSON roto;
  al pasarlo se corta con «…». Que la imagen sea alta lo resuelve la 0105 partiéndola por las marcas
  `data-bloque` (`cabecera`, `titulo`, `cajitas`, `resumen`, `decision`, `pie`).
- **Campos nuevos y opcionales del JSON:** `duracion`, `rama`, `pr` y `origen`.
- **La cajita del CI se deduce.** `ci` es solo un enlace, sin estado. La regla: sin `ci`, «—»; si
  `ci` trae un estado escrito (`VERDE`, `ROJO`, `sin pasar`), ese; con enlace, `hecha` y `cerrada`
  dan «en verde» (solo se avisan tras «CI ok»), `bloqueada` y `fallida` dan «en rojo» (el bloqueo por
  CI es tras dos intentos sin verde) y el resto «sin pasar» (`parada` al abrir la PR de una ficha
  sola, `en_proceso`). Dos casos sin garantía: `cerrada` (el enlace es la última ejecución de `main`,
  que puede seguir en marcha) y `fallida` por un ROJO del verifier con un enlace de un CI que pasó
  (diría «en rojo»).
- **Origen de `parse5` y `postcss`:** los tests leen el HTML con `parse5` (7.3.0, que llega por
  `rehype-raw`, ADR-0011, vía `hast-util-raw`) y el CSS con `postcss` (8.5.28, que llega por `vite`).
  No están declarados: declararlos sería una dependencia nueva. El lockfile fija sus versiones, solo
  los usan los tests y, si desaparecen, el test falla de forma visible.

## Alternativas descartadas

- `parse_mode` de Telegram (HTML o MarkdownV2): sin tablas ni colores, y un fallo de escapado tumba
  el aviso.
- Markdown y resaltado desde un CDN: contenido remoto y red en la captura, contra el ADR-0008.
- Permitir HTML crudo en el resumen (`rehype-raw`): lo escriben agentes; el riesgo no compensa.
- Dejar los enlaces: en la imagen no se pulsan.
- Recortar el resumen a un tamaño fijo: contradice lo que pidió Dani.
- Declarar `parse5` y `postcss` en `devDependencies`: dependencia nueva sin necesidad.

## Consecuencias

- El aviso puede llevar el detalle completo, y se prueba sin navegador ni red (HTML como texto).
- La lista blanca es una superficie de seguridad: ampliarla es un cambio con la exclusión
  `seguridad`.
- Se pierden las casillas de tareas de GFM y la alineación de columnas de las tablas.
- La cajita del CI puede equivocarse en los dos casos dichos. El arreglo de fondo es que el
  Orquestador escriba el estado en `ci` (ya lo admite `ciLabel`) o en un campo nuevo; cambia el
  contrato de `tarea.md` y `cerrar-version.md`, y está en el BACKLOG como `[ALCANCE]` para Dani.
- `prNumber` no saca el número de una URL como `…/pull/321/files`; hoy no ocurre.
