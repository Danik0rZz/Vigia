---
id: '0002'
titulo: La descripción del evento siempre con formato (sin «Con formato · Texto original»)
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0002-descripcion-siempre-markdown
adrs: [8]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
