---
id: '0096'
titulo: 'e2e inestables en el CI: tooltips que no llegan a abrirse (evidencia de 45 días y grid de Problemas)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0096-e2e-tooltips-en-el-ci
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Orquestador (2026-10-11), con el camino que Dani aprobó en la 0086 («si se confirma, va a cuarentena
con su ficha de arreglo»): un segundo test de vistas falla en el CI y pasa al relanzar; hace falta
su ficha de arreglo para ponerlo en cuarentena. Que el Planificador valore si se junta con otro de
la misma familia (tooltips que no llegan a abrirse).

## Especificación

**Los dos tests.**

- **A, confirmado (va a cuarentena con `arreglo: 0096`):** `e2e/views-problema-detalle.spec.ts`,
  «v0.10.2: evidencia de 45 días: últimos 7 por defecto, etiquetas de fecha variadas (no «00:00»),
  nota y sin línea de inicio» (`@problema-detalle`). Mueve el ratón sobre el lienzo del gráfico
  (ECharts) y espera el tooltip `.vigia-chart-tooltip` con fecha y hora; falla con «element(s) not
  found». Tres fallos: CI de la PR #12 (run 38152066082, intento 1, y run 38157462342, intento 1) y
  una vez en local con 8 workers (developer de la 0085). Pasa al relanzar.
- **B, sospechoso (un fallo):** `e2e/views-problemas.spec.ts`, «grid de Problemas: ARIA, orden por
  columna, barra de estado y afectados» (`@problemas`). Pasa el ratón por la barra de estado con
  `hoverFresh` y espera el tooltip de Radix (`role="tooltip"`) con «Cerrado»; no aparece. Un fallo:
  CI de la PR #12, run 38152066082, intento 1. No se pone en cuarentena todavía: si vuelve a fallar
  antes de que acabe esta ficha, entra en cuarentena con la misma `arreglo: 0096`, sin ficha nueva.
- **C, añadido por Dani (2026-10-11, `[ALCANCE]`; un fallo):** `e2e/views-host.spec.ts:534`,
  «CA4 (0039): el tooltip de ayuda de «recuperable» sale con el ratón y con el foco» (`@host`).
  Espera el tooltip de ayuda (`reclaimableTooltip()`) y falla `toBeVisible` a los 5 s en la línea
  545 («element(s) not found»). Un fallo: CI de la PR #21 (0098, ya con 2 workers), run 38170355797,
  intento 3. Mismo trato que B: no va a cuarentena salvo que vuelva a fallar antes de acabar la ficha.

Se juntan porque el síntoma es el mismo (el tooltip no se abre tras mover el ratón, en el CI) y
puede tener la misma causa (eventos de ratón, foco o tamaño de la ventana en el runner); los
mecanismos son distintos (ECharts sobre canvas y Radix), así que la causa se busca para cada uno.

1. **Causa antes que arreglo**, para cada test. Hipótesis a comprobar: el ratón se mueve antes de
   que el gráfico o la barra estén estables (animación, redimensionado); el punto elegido (60 % del
   ancho del lienzo) cae fuera de la serie con otros tamaños; el tooltip se abre y se cierra antes de
   comprobarlo; la ventana no tiene el foco o el tamaño esperado en el CI. Cómo acercarse al CI: los
   artefactos de los runs fallidos (`test-results/`, 7 días), el log de `e2e/failure-capture.ts` y en
   local la suite en paralelo o `--repeat-each`. Nada de subir tiempos sin causa ni `waitForTimeout`.
2. **Arreglo donde está la causa.** Si es el test, se espera a una condición de la interfaz antes de
   mover el ratón o se apunta a un punto que tenga dato. Si es común a los dos, se arregla en el
   ayudante (`hoverFresh`, `moveToNeutral` o uno nuevo en `e2e/views/helpers.ts`). Si es la app, con
   su test que lo demuestre; si cambia lo que ve el usuario, se para y se pregunta (`[ALCANCE]`).
3. **Fuera de cuarentena:** se quitan `@inestable` y `arreglo` del test A (y del B si entró), y su
   fila de «Tests en cuarentena» del BACKLOG; en la línea de «Sospechosos de inestables» del BACKLOG
   se quitan los dos.

Los títulos no cambian; si el cuerpo cambia mucho, se añade «, arreglo (0096)» al final.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la
   duda, no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **puede no cumplirse**, si la causa está en la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo el `[ALCANCE]` del punto 2.

## Criterios de aceptación

- CA1: los tests A, B y C pasan 10 de 10 con `--repeat-each 10` en su spec con los workers de siempre, y
  10 de 10 con su spec entero y `--workers=1`.
- CA2: los tres pasan en el CI de la PR de la ficha (en el proyecto `e2e`, el que bloquea «CI ok»).
- CA3: ninguno lleva `@inestable` ni la anotación `arreglo`, y la guarda de la 0075
  (`scripts/e2e-tags.test.ts`) sigue en verde.
- CA4: si la causa estaba en la app, un test (unitario o e2e) que falla sin el arreglo y pasa con él,
  con «(0096)» en el nombre.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- El test de la cola de gráficos (0086) y los workers (0087).
- Otros tests con tooltips que no han fallado.

## Ideas surgidas (fuera de alcance)

- (developer) Con la ventana de 1024 px, el mini gráfico de una evidencia mide lo que la tabla
  (`min-w-[80rem]`, unos 1230 px) y su caja con scroll enseña poco más de la mitad: para ver el
  final del rango hay que desplazar la tabla en horizontal. Que el detalle desplegado use el ancho
  visible de la caja (por ejemplo, con `position: sticky` y el ancho del contenedor) lo vería
  entero. Cambia lo que ve el usuario: lo decide Dani.
- (developer) Otros tests apuntan a un porcentaje de la caja entera de un lienzo
  (`views-metricas.spec.ts`, «Métricas con 7 días…», al 50 %); si su lienzo quedara recortado,
  `visibleBox` (`e2e/hover.ts`) evita el mismo fallo.
- (developer) En local, el cursor real moviéndose sobre una ventana de los e2e (Dani usando la VPS
  mientras corren) manda `pointermove` nativos que cierran los tooltips de Radix: un fallo al azar
  de cualquier test de tooltip. Que el arnés aísle la ventana del ratón del sistema
  (`win.setIgnoreMouseEvents(true)` junto a `applyCiWindow`; los eventos de Playwright van por CDP)
  lo evitaría. Probado solo en una sonda de CA4 (0039): los de Playwright siguen llegando; falta
  ver que frena el cursor real y que no rompe ningún spec.

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios.** CA1: A y B 20 de 20 con `--repeat-each 10`, sus specs enteros con `--workers=1` (190/190 y 460/460); C 10 de 10 y `views-host` entero con `--workers=1` (320/320). CA2, pendiente del CI de la PR. CA3: `scripts/e2e-tooltips-0096.test.ts` comprueba que ninguno de los tres lleva `@inestable` ni `arreglo` y pasa la guarda de la 0075; los de A fallaban con A en cuarentena. Los tests no se tocan desde `bdf3f6d`. CA4 no aplica: la causa de A estaba en el test.
- **Causa antes que arreglo.** A, con la causa demostrada y reproducida (lienzo de unos 1230 px en una caja con scroll; el 60 % cae fuera de lo visible y ECharts lo esconde a los 100 ms). Arreglo donde está la causa (`visibleBox` en `e2e/hover.ts` y `scrollIntoView`), sin subir tiempos ni `waitForTimeout`. B y C sin causa y sin cambios, como pide la especificación (sospechosos de un fallo; no se arregla sin causa), con cada hipótesis descartada y anotado lo que hace falta si reaparecen.
- **BACKLOG.** Sale la fila de A de «Tests en cuarentena» y A y B de los sospechosos.
- **Reglas.** Solo `e2e/`, `scripts/`, `BACKLOG.md` y la ficha; sin IPC, API, dependencias ni esquema; sin datos del tenant.

Opcional:

- `visibleBox` no tiene en cuenta ancestros `position: fixed` ni transformaciones; anotarlo si se reutiliza.
- Partir la segunda línea del comentario de cabecera de `scripts/e2e-tooltips-0096.test.ts`.
- La idea de `setIgnoreMouseEvents` merece su propia ficha.

## Verificación

- Tests (test-writer, commit 6472ac1): `scripts/e2e-tooltips-0096.test.ts`.
  - CA1: sin test; se comprueba ejecutando los specs (`--repeat-each 10` y `--workers=1`).
  - CA2: sin test; se comprueba en el CI de la PR (proyecto `e2e`).
  - CA3: «CA3 (0096): el test A/B (…) no lleva @inestable», «… no lleva la anotación arreglo» y «la guarda de la 0075 no da problemas en los specs reales». Hoy fallan los dos de A (sigue en cuarentena); los de B pasan y vigilan que no entre.
  - CA3, test C (test-writer, ampliación tras el `[ALCANCE]` de Dani, commit bdf3f6d): «CA3 (0096): el test C (views-host.spec.ts) no lleva @inestable» y «… no lleva la anotación arreglo». Pasan hoy (C no está en cuarentena): vigilan que no entre.
  - CA4: sin test todavía; solo aplica si la causa está en la app, y lo escribe el developer con el arreglo.

Verificación 2026-10-11, commit e5f474d, rango `origin/main..fix/0096-e2e-tooltips-en-el-ci`: **VERDE**

- `npm run check`: 4113 tests, cobertura ok. En el primer pase falló una vez `CA3 (0059)` de `scripts/react-compiler.test.ts` (sospechoso de inestable ya anotado, por tiempo bajo carga); aislado ×3 pasó y el `check` completo repetido salió verde.
- `npm run test:e2e:affected -- origin/main..e5f474d`: 368 passed, 0 fallos (1,7 min), un pase.
- CA2 (los tres tests en el CI de la PR): lo comprueba el Orquestador tras abrir la PR.

## Resultado

- 2026-10-11 (developer): en cuarentena el test «v0.10.2: evidencia de 45 días…» de `e2e/views-problema-detalle.spec.ts` (`@inestable`, anotación `arreglo` 0096), por decisión de Dani; fila en «Tests en cuarentena» del `BACKLOG.md`. El tooltip «Cerrado» de `views-problemas.spec.ts` no entra. El arreglo sigue pendiente.
- 2026-10-11 (developer), **test A, causa en el test**: la tabla de evidencias mide `min-w-[80rem]`
  dentro de una caja con scroll, así que el lienzo del mini gráfico mide unos 1230 px con la ventana
  de 1024: el 60 % de su ancho (x ≈ 1052) caía fuera de la caja y de la ventana. El tooltip solo
  salía al cruzar el lienzo en los pasos intermedios del ratón y, al salir, ECharts lo escondía a los
  100 ms (`hideDelay`): en local se comprobaba antes; en el CI, más lento, no. Demostrado en local:
  con un solo paso falla siempre con «element(s) not found», y con 400 ms de pausa antes de comprobar,
  3 de 3 fallos; con el arreglo, las dos variantes pasan 3 de 3 (pruebas temporales, sin commitear).
  Arreglo: ayudante `visibleBox` en `e2e/hover.ts` (caja recortada por los antecesores que recortan y
  por la ventana) y el test apunta al centro de la parte visible, con el lienzo a la vista en
  vertical. Sale de cuarentena y de la tabla del BACKLOG; sin cambios en la app (CA4 no aplica).
- 2026-10-11 (developer), **test B, causa no encontrada**: un solo fallo (CI, run 38152066082, con 4
  workers; el artefacto solo trae el `error-context`, sin captura). Descartado con pruebas temporales:
  el punto final cae en la barra (`elementFromPoint`), el tooltip sigue abierto 1,5 s después de
  `hoverFresh` (no hay un cierre como en A), el meneo de 1 px con el tooltip ya abierto (pausa de
  450 ms antes) lo deja abierto, y con la CPU frenada ×4 y ×10 (`Emulation.setCPUThrottlingRate`)
  pasa. No se cambia; como pide la ficha, se quita de los sospechosos del BACKLOG. Si vuelve a fallar,
  hace falta la captura de `failure-capture` para seguir.
- 2026-10-11 (developer), **test C, causa no encontrada**: un solo fallo (CI de la PR #21, run
  38170355797, intento 3, con 2 workers; el artefacto solo trae el `error-context`: página cargada,
  icono sin foco y ningún tooltip en el DOM, así que no llegó a abrirse). No se reproduce en local:
  30 de 30 suelto, 80 de 80 con CA3 (0039) y 6 workers, y 141 de 141 con `views-host`,
  `views-inicio` y `views-metricas` ×3. Descartado con sondas temporales (sin commitear), que
  registran la caja, la identidad del icono, los `pointer*` y los `scroll` en cada fotograma: el
  icono no se vuelve a montar (el mismo nodo de principio a fin, ya con «2,5 GB», sin fase con
  «—»), no hay `scroll` en `main` ni en el documento, la caja no se mueve después de `stableBox`
  (la transición de entrada de la página, de Motion, acaba antes y como mucho son 6 px, menos que la
  mitad del icono de 14 px), el punto final cae en el icono (`pointerenter` y el tooltip a los
  300 ms), y pasa igual con la CPU frenada ×4 y ×6 (`Emulation.setCPUThrottlingRate`), recargando
  justo antes, y con otra ventana encima de la app (también durante los 300 ms del retardo) con el
  cursor real quieto dentro de ella. Sí lo rompe el cursor real del sistema **moviéndose** sobre la
  ventana: sus `pointermove` nativos llegan a la página y cierran el tooltip o impiden que se abra
  (visto en la VPS al mover el cursor con `SetCursorPos`); en el runner nada mueve el cursor, así que
  no explica el fallo del CI. Coincidencia anotada: en el CI, el otro worker arrancaba su app
  (primer test de `views-inicio`, 20:30:28) mientras C pasaba el ratón (C empezó a las 20:30:25,9);
  con una ventana del mismo proceso no se reproduce, con otro proceso no se ha probado. No se cambia
  nada; C no estaba en el BACKLOG. Si vuelve a fallar, hace falta la captura de `failure-capture`
  y mirar qué hacía el otro worker en ese momento.
- CA1: `--repeat-each 10` de A y B, 20 de 20; `--repeat-each 10 --workers=1` de los dos specs enteros:
  `views-problemas` 190 de 190 y `views-problema-detalle` 460 de 460. Test C: `--repeat-each 10`, 10 de 10, y `views-host` entero con `--repeat-each 10 --workers=1`, 320 de 320. CA3: `scripts/e2e-tooltips-0096.test.ts`
  y `scripts/e2e-tags.test.ts` en verde. CA2: pendiente del CI de la PR.

### Cierre (doc-writer, 2026-10-11)

- Commits: `92f402a` y `309de3c` (tests), `fd58e27` (arreglo de A: `e2e/hover.ts`, `e2e/views-problema-detalle.spec.ts`, `BACKLOG.md`), más los de la ficha. Ficheros principales: `e2e/hover.ts` (`visibleBox`), `e2e/views-problema-detalle.spec.ts`, `scripts/e2e-tooltips-0096.test.ts`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Sin migraciones.
- Estado de A, B y C: A arreglado; B y C sin causa y sin cambios. CA2 pendiente del CI de la PR.
- Las ideas surgidas y las notas opcionales del revisor pasaron al `BACKLOG.md` (surgió en 0096).
