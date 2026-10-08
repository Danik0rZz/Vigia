---
id: '0038'
titulo: 'Visor de Markdown: capa visual cuidada (código con colores y números de línea, avisos y marcas)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
