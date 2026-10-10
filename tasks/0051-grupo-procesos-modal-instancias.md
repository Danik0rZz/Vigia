---
id: '0051'
titulo: 'PROCESS_GROUP: tabla con las 20 de más CPU, aviso y modal «Ver todas» con transición de entrada'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos-2
depende_de: ['0050']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0051-grupo-procesos-modal-instancias
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:processGroupMetrics` y `entities:processGroupInstances` de la 0050)
migracion: no
rondas_revision: 2
---

## Petición original

Lote «grupo-procesos-2» (0050 y 0051). La petición completa está en la ficha 0050: tabla con las 20
instancias que más CPU consumen, aviso de que hay más, botón «Ver todas» y un modal centrado con una
transición de entrada vistosa y la lista completa, que avisa si está recortada.

## Especificación

En la tabla «Instancias» de la página del process group (0032):

- Enseña las **20 de más CPU** (las de `instances.items`).
- Si `total` es mayor que 20, debajo: «20 de 1.234 instancias, las de más CPU» y el botón **«Ver
  todas»**. Si `totalKnown` es `false`: «20 instancias, las de más CPU; puede haber más» y el botón.
- **Modal** (el `Dialog` de Radix de `components/dialogs.tsx`, accesible: foco atrapado, Escape y
  clic fuera cierran, título «Instancias de <grupo>»):
  - Centrado, ancho amplio y alto máximo de la ventana con scroll interno; la tabla con las mismas
    columnas y enlaces que la de la página (a la página de cada proceso y de su host), orden por
    columna y un buscador por nombre o host.
  - **Transición de entrada vistosa:** el fondo se oscurece con desenfoque suave y el panel entra
    con escala (de 0,92 a 1), un leve desplazamiento hacia arriba y opacidad, con una curva con algo
    de rebote (unos 300 ms); al cerrar, la inversa más rápida. Con «reducir el movimiento» de
    Windows, solo un fundido corto.
  - Los datos se piden **al abrir** (`entities:processGroupInstances`, ADR-0004: lo pide el usuario)
    y se quedan en caché con la misma clave; mientras cargan, un esqueleto de filas; si falla, aviso
    con Reintentar dentro del modal.
  - Si `truncated`: aviso destacado arriba del modal («Dynatrace devuelve como mucho unas 498
    instancias por consulta: se muestran N de M»), con el número real si se conoce.
- Pulsar un proceso o un host en el modal cierra el modal y navega; «Volver» regresa al grupo.
- Textos en es y en.
- Del revisor de la 0050: `instancesTruncated` (`process-group-instances.ts`) solo mira `partial`; con `totalKnown: true` el marcador diría «al menos N» aunque el total sea exacto, hay que usar `total` y `totalKnown`. Y `truncated` de `processGroupInstances` también es `true` si `totalCount` cuenta instancias sin series: el aviso del modal no debe afirmar un recorte de Dynatrace sin más.

## Criterios de aceptación

- CA1 (e2e): con un grupo de 30 instancias en el simulador, la tabla enseña 20, ordenadas por CPU, y
  el aviso «20 de 30» con «Ver todas»; con 12 instancias, ni aviso ni botón.
- CA2 (e2e): «Ver todas» abre el modal con las 30, pide `entities:processGroupInstances` una sola
  vez (abrir y cerrar otra vez no vuelve a pedir) y la página no lo pide antes de pulsar.
- CA3 (e2e): con un grupo recortado, el modal enseña el aviso de recorte con los números.
- CA4 (e2e): en el modal, el buscador filtra, el orden por columna funciona, Escape cierra y el foco
  vuelve al botón «Ver todas»; pulsar un proceso abre su página.
- CA5 (e2e): el panel del modal tiene la animación de entrada (clase o atributo de estado de Radix
  con la transición) y, con `prefers-reduced-motion: reduce` emulado, solo el fundido.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un process group real grande: el aviso, el modal, la transición (que se ve vistosa) y el aviso
  de recorte si lo hay.

## Fuera de alcance

- Gráficos dentro del modal o seleccionar instancias para compararlas.

## Ideas surgidas (fuera de alcance)

- (developer) El pie del marcador «Instancias» sigue diciendo «Con datos en el rango», pero desde
  la 0050, con `totalKnown`, el número es `totalCount` de `GET /entities` (todas las instancias del
  grupo, tengan datos o no). Cambiar el pie según `totalKnown`.
- (developer) `entities:processGroupInstances` sigue sin `totalKnown` (idea de la 0050): el modal
  no lo necesita (sin un total mayor que lo recibido dice «puede haber más»), así que no se ha
  tocado el canal.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Criterios / test anterior debilitado] `process-group-instances.ts:45-48`: `instancesTruncated`
   pasa a `partial && !totalKnown` y controla a la vez el «como mínimo» del marcador y el aviso de
   recorte de la tabla. La nota de la 0050 solo pedía corregir el marcador: con total conocido el
   número es exacto, pero la lista puede seguir incompleta (la memoria va sin `:limit`), y el grupo
   grande (con `totalCount`) se queda sin aviso. El e2e de la 0032 con 403 sigue cubriendo el
   «7+» (legítimo), pero el unitario fija que la tabla deje de avisar y nadie prueba ya «`partial`
   con total conocido» en la tabla. Separar las dos decisiones: marcador con `partial &&
!totalKnown`, aviso de la tabla con `partial` (con total conocido, un texto que no diga que el
   total puede estar incompleto, en es y en); ajustar el unitario y añadir un e2e con el grupo
   recortado y total real: aviso de la tabla visible y marcador con 600 exacto.

Bien: CA1 a CA6 con su test y sin tocarlos tras `afb7cf3`; foco, Escape, clic fuera, devolución del
foco y `prefers-reduced-motion`; sin IPC, API, esquema, CSP ni dependencias; consulta `MANUAL`
activada al pulsar (ADR-0004); nada del tenant.

Opcional: la lista completa se vuelve a pedir al cambiar el rango con el modal cerrado (anotarlo o
`enabled: requested && open`); `busy` de «Actualizar» no cuenta la consulta del modal; un e2e del
error con Reintentar dentro del modal.

### Ronda 2: APROBADO

El CAMBIO de la ronda 1, resuelto: `instancesAtLeast` (`partial && !totalKnown`) para el «como
mínimo» del marcador e `instancesTruncated` (`partial`) para el aviso de la tabla, con `partialList`
en es y en cuando se sabe el total. El unitario de la 0032 queda más estricto que en `main` (aviso
con `partial` con y sin total) y hay test de los cuatro casos de `instancesAtLeast`; e2e nuevo del
grupo recortado con total real (aviso visible, marcador 600 exacto); el «7+» de la 0032 sigue. Sin
tocar tests tras `309b9a0`. Opcionales aplicados conforme a ADR-0004: lista solo con el modal
abierto y «Actualizar» con el modal cerrado solo la marca como vieja (e2e con el recuento de
peticiones); e2e del error con Reintentar en el modal. El test de textos de CA6 ya exige cada clave.

Opcional: partir a mano el comentario de `ProcessGroupMarkers.tsx` (~línea 24), que pasa de 100
columnas.

## Verificación

Ficha ligera: tests escritos por el developer en `afb7cf3` (`test(entidades): criterios de la
ficha 0051 (#0051)`); código en `ef2fcb2`.

| CA  | Test                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1 | `e2e/views.spec.ts`, `CA1 (0051): …` (30 → las 20 de más CPU y «20 de 30»; con 12, ni aviso ni botón; sin `totalCount`, «puede haber más»); `process-group-instances.test.ts`, `describe CA1 (0051)` |
| CA2 | `e2e/views.spec.ts`, `CA2 (0051): …` (la página no pide la lista; una petición al abrir; reabrir no pide)                                                                                            |
| CA3 | `e2e/views.spec.ts`, `CA3 (0051): …` («25 de 600», 498, arriba de la tabla; marcador 600 exacto); `describe CA3 (0051)` del unitario                                                                 |
| CA4 | `e2e/views.spec.ts`, `CA4 (0051): …` (buscador, orden, Escape y clic fuera, foco en «Ver todas», proceso y host); `describe CA4 (0051)` del unitario                                                 |
| CA5 | `e2e/views.spec.ts`, `CA5 (0051): …` (fotogramas con scale, translate y opacity, entre 200 y 500 ms, `cubic-bezier` con rebote, fondo con `blur`; con `reduce`, solo opacidad y 200 ms como mucho)   |
| CA6 | `src/renderer/src/locales/process-group-page.test.ts`, `CA6 (0051): …`                                                                                                                               |

Antes del código: 10 unitarios y los 5 e2e de la 0051 fallaban por lo que faltaba; los de la 0032
y la 0050, en verde. Con el código: `npm run check` en verde (3177 tests en 174 ficheros) y
`npm run test:e2e:affected -- main..HEAD` 304/304; los e2e de la 0051 con `--repeat-each 3`
(animación), 15/15.

**Cambio en un test anterior (en el commit de tests):** el `CA1 (0032), nota del Orquestador`
(recorte) pasa a simular `/entities` con 403 (`sim.processGroupEntitiesFail`, nuevo): con el total
real, la nota del revisor de la 0050 pide que el marcador no diga «como mínimo», así que el caso
del «7+» solo existe sin `totalCount`. El unitario de `instancesTruncated` (0032) gana
`instances.totalKnown` por lo mismo.

**Ronda 1 (CAMBIOS):** tests en `309b9a0` y código en `ef2ac8c`.

- Unitario de la 0032 (`process-group-instances.test.ts`): en `afb7cf3` lo cambié para que la tabla
  dejara de avisar con el total real, y el revisor vio que eso debilitaba la 0032. Ahora vuelve a
  exigir el aviso con `partial`, se sepa o no el total, y un test nuevo fija el «como mínimo» del
  marcador (`instancesAtLeast`).
- e2e nuevos: `CA3 (0051), revisión ronda 1` (grupo recortado con total real: aviso de la tabla
  visible, sin hablar del total, y marcador con 600 exacto); `CA2 (0051), revisión ronda 1` (con el
  modal cerrado, ni un rango nuevo ni «Actualizar» piden la lista; al abrir, sí); y
  `Especificación (0051)` (error de la lista con Reintentar dentro del modal, con
  `sim.processGroupInstancesFail`, nuevo).
- `CA6 (0051)` de textos: ahora también comprueba que cada clave sea una cadena. Antes
  `String(undefined)` pasaba el patrón y una clave que faltara no lo hacía fallar.
- Resultados: `npm run check` en verde (3178 tests en 174 ficheros);
  `npm run test:e2e:affected -- main..HEAD` 307/307; los de la 0051 y la 0032 con
  `--repeat-each 3`, 45/45.

**Decisiones del developer (delegadas, refinables):**

- Tras la ronda 1, dos decisiones por separado: el «como mínimo» del marcador (`instancesAtLeast`)
  solo con `partial` y `totalKnown: false` (con el total real, el total exacto), y el aviso de
  recorte de la tabla (`instancesTruncated`) con `partial`, se sepa o no el total; con el total
  real, el texto `partialList` («Dynatrace ha recortado la consulta de instancias: la lista puede
  estar incompleta.»), sin hablar del total.
- Aviso de la tabla (`instancesNotice`): con `totalKnown` y un `total` mayor que las enseñadas,
  «N de total»; sin `totalKnown`, «N instancias…; puede haber más» si llegan 20 (el tope) o vino
  `partial`. En los demás casos, ni aviso ni botón.
- Aviso del modal (`fullListNotice`, nota del revisor sobre `truncated`): no afirma un recorte;
  con un `total` mayor que lo recibido, «Se muestran N de M instancias. Dynatrace devuelve como
  mucho unas 498 por consulta y no incluye las que no tienen datos en el rango.»; si no, «Se
  muestran N instancias y puede haber más: …». Sin tocar el canal (no hizo falta `totalKnown`).
- Tras la ronda 1 (opcional del revisor): la consulta del modal solo está activa con el modal
  abierto (`enabled: open`). Reabrirlo con la misma clave no pide nada; con el modal cerrado, un
  rango nuevo no la pide (se pide al abrirlo) y «Actualizar» la marca como vieja sin pedirla
  (`useInvalidateProcessGroupInstances`, `refetchType: 'none'`), así que se vuelve a pedir al
  abrirlo. Con el modal abierto no se puede pulsar «Actualizar», así que su `busy` no tiene que
  contar esta consulta.
- Modal genérico `ShowcaseDialog` en `components/dialogs.tsx` (Radix Dialog): 1100 px o 94 vw, alto
  máximo 92 vh con scroll; fondo `bg-overlay` con `backdrop-blur`; panel con `vigia-dialog-in`
  (`main.css`: `translateY(14px) scale(0.92)` a 1, 320 ms, `cubic-bezier(0.34, 1.45, 0.64, 1)`) y
  salida de 160 ms; con `prefers-reduced-motion: reduce`, un fundido de 120 ms (90 ms al cerrar),
  con una regla más específica que la general, que lo dejaría en 0,01 ms.
- Sin `Dialog.Trigger`, Radix no devuelve el foco al cerrar (enfoca su `triggerRef`, vacío):
  `ShowcaseDialog` guarda el elemento enfocado al abrir y se lo devuelve.
- La tabla pasa a `ProcessGroupInstancesTable.tsx` (la usan la tarjeta y el modal, con sus testids)
  y el modal va en `ProcessGroupInstancesDialog.tsx`; los dos, en el área `views` (`pages/**`).
- Al abrir con la lista en caché, el foco va al buscador; si aún carga, al botón de cerrar.
- Testids: `process-group-instances-more`, `-all`, `-dialog`, `-dialog-overlay`, `-dialog-search`,
  `-dialog-truncated`, `-dialog-grid`, `-dialog-scroll` y `-dialog-skeleton`; textos en
  `entities.processGroup.instances` (`moreOf`, `moreUnknown`, `viewAll` y `dialog.*`).

### Verifier, 2026-10-10, commit `9b99b86`, rango `main..feat/0051-grupo-procesos-modal-instancias`: VERDE

- check: 3178 tests en 174 ficheros, cobertura ok.
- e2e completo (toca `main.css` y `dialogs.tsx`): 339/339, sin intermitentes.
- Los 8 e2e de la 0051 ×3 con `--workers=1`: 24/24 (incluida la animación de CA5).

## Resultado

(pendiente)
