---
id: '0094'
titulo: 'Visor de Markdown: los colores con nombre no se buscan en el prototipo'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

1. No añade componentes, funciones ni cálculos nuevos: se cumple.
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
