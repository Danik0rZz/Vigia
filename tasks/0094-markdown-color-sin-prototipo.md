---
id: '0094'
titulo: 'Visor de Markdown: los colores con nombre no se buscan en el prototipo'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0094-markdown-color-sin-prototipo
adrs: [11] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la R-07: robustez del visor que pinta contenido
del tenant (ADR-0011).

## Especificación

**Hoy.** `src/renderer/src/components/markdown-color.ts` busca un color con nombre en un objeto
literal (`NAMED_COLORS[text]`). Con `constructor`, `__proto__`, `toString`, `valueOf` o
`hasOwnProperty`, encuentra algo heredado del prototipo, `hexToRgba` devuelve canales `NaN` y
`parseColor` no cumple su contrato («cualquier otra cosa da null»). Hoy no llega nada al DOM (las
comparaciones de contraste con `NaN` descartan el `style`), pero una refactorización que confíe en
`parseColor` podría escribir un color roto.

**Qué se hace.**

1. Buscar solo nombres propios del mapa (`Object.hasOwn` o un `Map`), como `registry.ts` con los
   tipos de entidad.
2. `hexToRgba` rechaza lo que no cumple el patrón `HEX` (no devuelve canales `NaN`).

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (saneado del contenido del tenant, ADR-0011): va
sola en su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se cumple del todo; el developer añadió el helper interno `knownHex` (ver «Resultado»).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia la lógica del saneado de colores.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: `parseColor('constructor')`, `parseColor('__proto__')`, `parseColor('toString')`,
  `parseColor('valueOf')` y `parseColor('hasOwnProperty')` devuelven `null`; los nombres válidos de
  hoy siguen igual. Test unitario con «CA1 (0094)».
- CA2: una descripción con `<span style="color:constructor">` se pinta sin `style`. Test con «CA2
  (0094)» junto a los de `MarkdownText`.
- CA3: los tests del visor (ADR-0011) siguen en verde sin cambiar lo que esperan.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Los comentarios del visor que ya no son ciertos (R-06 de la revisión): no son de seguridad.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios:** CA1 (`markdown-color.test.ts`) y CA2 (`MarkdownText.html.test.ts`) con su número; CA1 fallaba con `constructor` y `__proto__`; CA2 es guarda de regresión. CA3: los tests del visor sin cambios; los tests no se tocan desde 5c2c452.
- **Especificación:** punto 1 con `Object.hasOwn(NAMED_COLORS, text)` (`markdown-color.ts:210`); punto 2, `hexToRgba` comprueba `HEX` y devuelve `null` (líneas 183-185). Sin IPC, API, dependencias, esquema, secretos ni datos del tenant.
- **`knownHex` (líneas 194-199):** con datos reales no puede lanzar: sus cuatro llamadas reciben siempre un `#rrggbb` válido (constantes del tema; en `paintElement`, `toHex` de canales finitos de 0 a 255). El único cambio de contrato es que `readableColor` lanza con algo que no es `#rgb`/`#rrggbb` en vez de devolver basura; su JSDoc ya pedía `#rrggbb` y solo la usan los tests y `paintElement`. Si lanzara por una regresión, lo recogen `PanelBoundary`/`AppErrorBoundary` (se rompe el panel, no la app). No es `[ALCANCE]` ni `[CARRIL]`.

Opcional: anotar en la ficha `knownHex` y el `TypeError` de `readableColor`, y corregir «Carril» punto 1; más conservador, en `paintElement` usar `hexToRgba` y quitar el `style` si da `null` (una regresión perdería el color, no el panel), dejando `knownHex` para `THEME_PAINT`; tests de la rama que lanza y del `null` de `hexToRgba`.

## Verificación

Tests escritos en 5c2c452 (test-writer):

- CA1 → `markdown-color.test.ts`, «CA1 (0094): los colores con nombre no se buscan en el prototipo» (cinco nombres del prototipo dan `null`; red, green, navy, orange, gray, white y black siguen igual que su hexadecimal y sin `NaN`). Hoy fallan `constructor` y `__proto__` (canales `NaN`).
- CA2 → `MarkdownText.html.test.ts`, «CA2 (0094): un color con nombre del prototipo no se pinta». Ya pasa hoy (el contraste con `NaN` descarta el `style`, como dice la especificación): es una guarda de regresión.
- CA3 → los tests del visor sin cambios: `MarkdownText.test.ts`, `MarkdownText.html.test.ts`, `MarkdownText.visual.test.ts` y `markdown-color.test.ts` (262 en verde).

Verificación 2026-10-12, commit e622e25, rango `integra/20261012-5..fix/0094-markdown-color-sin-prototipo`: **VERDE**

- `npm run check`: 4179 tests (226 ficheros), cobertura ok (sentencias 92,83 %, ramas 90,03 %, funciones 89,94 %, líneas 93,58 %).
- `test:e2e:affected`: 169 de 169 en 60 s, un pase (zonas @problema-detalle, @servicio y otras), sin fallos.
- `core.bare` del checkout principal en `false`.

## Resultado

- Commits: 0412bd3 y 5c2c452 (tests), 8f5b5f9 (arreglo), 8881026 (en revisión), e622e25 (revisión) y 8562615 (verificación). Una ronda de revisión (APROBADO). Sin ADR nuevo.
- Ficheros principales: `src/renderer/src/lib/markdown-color.ts` (`Object.hasOwn(NAMED_COLORS, text)` y `hexToRgba` con `HEX`), `markdown-color.test.ts` y `MarkdownText.html.test.ts`.
- Decisión del developer: el helper interno `knownHex` lanza `TypeError` si recibe un hexadecimal no válido, y `readableColor` (exportada) lanza ahora si no recibe `#rgb`/`#rrggbb`, en vez de devolver basura. Con datos reales no puede lanzar (el reviewer lo comprobó: sus llamadas reciben siempre un `#rrggbb` válido); si lo hiciera por una regresión, `PanelBoundary` rompería el panel, no la app. Por eso «Carril» punto 1 queda como «no se cumple del todo».
- Los opcionales 2 y 3 del reviewer (`paintElement` con `hexToRgba` y tests de la rama que lanza) van a «Mejoras anotadas» del BACKLOG.
- Verificación: VERDE (4179 tests, e2e afectados 169 de 169).
