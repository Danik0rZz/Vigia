---
id: '0002'
titulo: La descripción del evento siempre con formato (sin «Con formato · Texto original»)
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0002-descripcion-siempre-markdown
adrs: [8]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

"El botón que se ha creado para ver el texto normal o en markdown, quiero que siempre se vea en
markdown."

## Especificación

Cambio sobre la ficha 0001 (hecha). En la sección «Descripción» del detalle de un evento
(`src/renderer/src/components/EvidenceDescription.tsx`):

- Se quita el conmutador «Con formato · Texto original»
  (`evidence-description-mode-*`, `problems.eventTable.description.mode` y las claves de sus
  opciones, en es y en). La descripción se pinta siempre con `MarkdownText`.
- **Se queda «Copiar»** y sigue copiando el texto original (el Markdown tal cual, recortado si
  venía recortado). Motivo: Dani solo pidió quitar el conmutador, y copiar el original sigue
  siendo útil para pegarlo en otro sitio. Dani aprobó la ficha con «Copiar» (2026-10-06).
- Se queda igual: la nota de recorte, la seguridad del Markdown (ADR de contenido del tenant con
  formato) y el resto del detalle.
- Tests de la 0001 que dejan de aplicar: el e2e `CA7 (0001)` se borra y el `CA9 (0001)` se
  ajusta (Tab llega a «Copiar»; ya no hay conmutador). Lo hace el test-writer y lo anota en
  "Resultado".

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): al desplegar un evento con descripción, no existe ningún control de modo
  (`evidence-description-mode-*` ni un grupo con la etiqueta del conmutador) y la descripción sale
  renderizada (`h*`, `li`, `strong`, `code`, `table`), no con los símbolos de Markdown.
- CA2 (e2e): «Copiar» sigue llamando a `app:copyText` con el texto original exacto y se ve el
  aviso de copiado.
- CA3 (e2e): con el teclado, Tab llega a «Copiar» dentro del detalle, Enter lo activa y Escape
  sigue plegando la fila.
- CA4 (unitario): las claves de i18n del conmutador ya no existen ni en es ni en en, y el test de
  paridad sigue en verde.

## Pruebas a mano para Dani

(ninguna: se ve igual que la 0001 sin el conmutador)

## Fuera de alcance

- Cualquier otro cambio en la descripción o en `MarkdownText`.

## Ideas surgidas (fuera de alcance)

- (developer) ADR-0008 dice «Siempre hay forma de ver y copiar el texto original («Texto original»
  y «Copiar»)»; desde esta ficha solo se puede copiar. Según `docs/adr/README.md` no se edita: lo
  decide el Orquestador (ADR que lo sustituya o nota del doc-writer). El CHANGELOG de la 0001 también
  menciona el conmutador; es tarea del doc-writer.

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: los cuatro CA con su test y su número; CA1, CA3 y CA4 fallan con el código anterior y CA2
  es de no regresión (Markdown exacto de dos eventos).
- Tests sin tocar después de `975a21d`. Los ajustes a la 0001 (CA7 borrado, CA8, CA9 y CA15, y
  `RENDERED` y `tabTo` sin uso) son solo los que obliga quitar el conmutador.
- Código: se quitan el estado `mode`, los botones, el `pre` y el import de `cn`; siempre
  `MarkdownText` (ADR-0008); «Copiar» igual; claves borradas en es y en; sin IPC, API, dependencias
  ni áreas nuevas; sin datos del tenant.
- No bloquea: ADR-0008 (línea 28), CHANGELOG y BACKLOG nombran el conmutador (para el doc-writer).
- Opcional: añadir Espacio sobre «Copiar» en el e2e (antes se probaba).

## Verificación

Tests escritos en `975a21d` (test-writer, antes del código):

- CA1: `e2e/views.spec.ts`, `CA1 (0002)` (P-785, dos eventos con descripción): sin
  `[data-testid^="evidence-description-mode"]`, sin `aria-pressed`, sin grupo, radio, pestaña ni
  botón con los textos del conmutador (es y en); el único botón de la sección es «Copiar», y salen
  `h*`, `li`, `strong`, `code` y `table` sin símbolos. Falla hoy (2 controles de modo).
- CA2: `e2e/views.spec.ts`, `CA8 (0001) y CA2 (0002)`: «Copiar» deja en el portapapeles el
  Markdown exacto (y el de otro evento, el suyo) y se ve el aviso. Pasa ya: es de no regresión.
- CA3: `e2e/views.spec.ts`, `CA9 (0001) y CA3 (0002)`: Tab desde la fila llega a «Copiar» sin
  pasar por ningún `evidence-description-mode-*`, Enter copia sin plegar y Escape pliega con el
  foco en la fila. Falla hoy (el Tab pasa por los dos botones de modo).
- CA4: `src/renderer/src/locales/description-mode.test.ts`: sin `mode`, `formatted` ni
  `original` en `problems.eventTable.description` de es y en, y siguen `title`, `copy` y
  `truncated`. La paridad la cubre `locales.test.ts` en `check`. Falla hoy (las claves
  existen).
- Ejecución: `npx vitest run src/renderer/src/locales/` (2 fallos, los de CA4; paridad en verde);
  `npm run test:e2e -- e2e/views.spec.ts -g "0002|0001"`: 6 pasan y 2 fallan (CA1 y CA3 de la
  0002, por la aserción del conmutador).

### Verifier, 2026-10-06, commit `ca9f5a5`, rango `main..feat/0002-descripcion-siempre-markdown`: VERDE

- check: 1878 tests en 90 ficheros, cobertura ok; lint, tipos y formato limpios.
- e2e afectados (shell, smoke y views): 113 pasan y 2 fallan, los dos preexistentes de la VPS
  (BACKLOG.md): `views.spec.ts:1721` (fila 140 en vez de 150, 3/3 aislado) y `:3978` (serie vacía;
  intermitente también aislado: 2/3 en la rama y 1/3 en `main` 7a083a0). Todos los CA de la 0002
  pasan.

## Resultado

- (test-writer) Tests de la 0001 ajustados en `975a21d`: `CA7 (0001)` borrado; `CA9 (0001)`
  pasa a ser `CA9 (0001) y CA3 (0002)` (Tab llega a «Copiar», sin conmutador); también
  `CA8 (0001)` (ahora `CA8 (0001) y CA2 (0002)`, sin pasar por «Texto original») y
  `CA15 (0001)` (solo comprueba «Copiar» en inglés), que usaban los botones de modo; se quitaron
  `RENDERED` y `tabTo`, que se quedaban sin uso.

- (developer) `17d3344`: fuera el conmutador de `EvidenceDescription.tsx` (estado `mode`,
  botones `evidence-description-mode-*` y el `pre` del texto original); la descripción va siempre
  con `MarkdownText` y se queda «Copiar». Fuera `mode`, `formatted` y `original` de es y en.
  No se tocaron los tests de la ficha.
- `npm run check`: 1878 tests en verde. `npm run test:e2e:affected -- main..HEAD` (shell, smoke y
  views): 113 pasan y 2 fallan, `views.spec.ts:1721` (300 filas virtualizadas) y `:3978` (i18n con
  el gráfico de Métricas), los dos preexistentes en BACKLOG.md y ajenos a esta ficha. Los tests
  de la 0001 y la 0002 pasan.
