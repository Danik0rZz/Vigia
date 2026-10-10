---
id: '0051'
titulo: 'PROCESS_GROUP: tabla con las 20 de más CPU, aviso y modal «Ver todas» con transición de entrada'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

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

**Decisiones del developer (delegadas, refinables):**

- `instancesTruncated` (marcador «como mínimo» y aviso de recorte de la tabla): solo con `partial`
  y `totalKnown: false`. Con el total real, el marcador da el total exacto.
- Aviso de la tabla (`instancesNotice`): con `totalKnown` y un `total` mayor que las enseñadas,
  «N de total»; sin `totalKnown`, «N instancias…; puede haber más» si llegan 20 (el tope) o vino
  `partial`. En los demás casos, ni aviso ni botón.
- Aviso del modal (`fullListNotice`, nota del revisor sobre `truncated`): no afirma un recorte;
  con un `total` mayor que lo recibido, «Se muestran N de M instancias. Dynatrace devuelve como
  mucho unas 498 por consulta y no incluye las que no tienen datos en el rango.»; si no, «Se
  muestran N instancias y puede haber más: …». Sin tocar el canal (no hizo falta `totalKnown`).
- La consulta del modal se pide la primera vez que se abre y queda activa mientras la página está
  montada: reabrir no pide y «Actualizar» de la página la refresca con lo demás.
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

## Resultado

(pendiente)
