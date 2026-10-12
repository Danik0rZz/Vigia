---
id: '0107'
titulo: Capturas de evidencias en los e2e de los criterios visibles
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0107-e2e-capturas-evidencias
adrs: ['0006'] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12), primera parte de
«evidencias visuales en el aviso final»: cuando una ficha cambia algo visible y tiene e2e, el aviso
de «hecha» lleva capturas de esos tests, cada una con su criterio debajo («CA1 (0018) · …»).
Probado en un test aparte con el arnés de vistas: captura de la zona del criterio y de la ventana.
Ideas: el test-writer marca en cada e2e de un criterio visible qué zona capturar; solo del
simulador, nunca de `test:live`; las fichas sin pantalla, sin evidencias; capturar cuando acaben las
animaciones de los gráficos.

## Especificación

Esta ficha solo **produce las capturas** al pasar los e2e; meterlas en el aviso es la 0108.

- Ayuda nueva en `e2e/` (por ejemplo `e2e/evidence.ts`):
  `captureEvidence(page, { criterio, zona })`, donde `criterio` es el nombre del criterio tal como
  va en el título del test («CA1 (0018)») y `zona` es un `Locator`. Guarda, en
  `test-results/evidencias/<ficha>/`, la captura de la zona, la de la ventana entera y una línea en
  `manifiesto.json` con el criterio, el título del test, un texto corto opcional (`nota`) y las dos
  rutas. Un criterio puede tener **varias** evidencias (varias llamadas, cada una con su zona),
  con nombres que no se pisan (`<CA>-<n>-zona.png`, `<CA>-<n>-ventana.png`).
- Como en el prototipo: el test usa el arnés de vistas tal cual (`setupViewsApp`, `openHostPage` u
  otros) y, después de sus `expect`, `locator.screenshot()` de la zona y `page.screenshot()` de la
  ventana (1024×720, de `applyCiWindow`).
- **Que no falte detalle** (Dani, 2026-10-12): las evidencias son la prueba empírica de que todo
  está bien. Van la zona y la ventana entera, para ver el conjunto; si el cambio toca varias cosas,
  una evidencia por cada una.
- **Solo cuando se pide:** con `VIGIA_EVIDENCIAS=1` en el entorno; sin ella no hace nada (los e2e
  de siempre no se alargan ni dejan ficheros).
- **Solo del simulador:** los e2e de Playwright solo hablan con el simulador (ADR-0006); la ayuda
  además se niega a capturar si la app no está apuntando al simulador (la URL del tenant de la
  prueba no es la del simulador local) y lo dice en el log del test.
- **Sin animaciones a medias.** En el prototipo, esperar a que `data-series` tuviera series no
  bastó: la captura de la ventana salió con los gráficos aún vacíos, porque ECharts sigue animando.
  ECharts no hace caso de `prefers-reduced-motion` en la app (solo Motion y el CSS), así que
  `reducedMotion: 'reduce'` no basta. Decisión del Planificador: **sin tocar la app**, la ayuda
  captura hasta que dos capturas seguidas den los mismos bytes (lo que hace `toHaveScreenshot` de
  Playwright), con un tiempo máximo. Si se pasa del tiempo, guarda la última y lo apunta en el
  manifiesto (`estable: false`).
- **Antes de comparar, quitar lo que se mueve y no es del criterio** (aviso de la sesión del
  prototipo, 2026-10-12: el cursor de texto de un campo con foco, un spinner o un tooltip harían que
  dos capturas nunca coincidan). Por defecto, la ayuda quita el foco
  (`document.activeElement.blur()`), lleva el ratón a la zona neutra (`moveToNeutral` de
  `e2e/hover.ts`) y captura con `caret: 'hide'` y `animations: 'disabled'` (opciones de
  `screenshot` de Playwright; el developer comprueba que funcionan con Electron en la 1.63 y lo
  anota). Las animaciones del lienzo de ECharts no las para `animations: 'disabled'`: para eso está
  la comparación. Si el criterio es justo el foco o el hover (un contorno o un tooltip), el test
  lo pide con una opción (por ejemplo `{ conservarFoco: true }` o `{ conservarRaton: true }`) y
  esa parte no se toca. Desactivar la animación de ECharts en la app con una marca de e2e
  o hacer que respete `prefers-reduced-motion` cambia la app: si el developer lo ve necesario, es
  un `[ALCANCE]`.
- `.claude/agents/test-writer.md`: en cada e2e de un criterio que cambia algo visible, una llamada
  a `captureEvidence` por cada cosa que cambia (con su zona), al final del test (cuando ya ha
  comprobado lo que tiene que comprobar). En el carril rápido lo hace el developer al escribir los
  tests. Las fichas sin pantalla no la llevan. Una regla en `e2e/CLAUDE.md`.
- `.claude/agents/verifier.md`: al pasar los e2e afectados, una tirada más de los de la ficha
  (`-g "(NNNN)"`) con `VIGIA_EVIDENCIAS=1`, y la ruta del manifiesto en su informe. Si esa tirada
  falla, no cambia el resultado del verifier: solo no hay evidencias.

## Carril

Normal (`ligera: no`):

1. No añade componentes, funciones ni cálculos nuevos: falla, ayuda nueva de los e2e.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: cumple en la app; cambia los e2e y el flujo de los agentes.
4. No hay ninguna decisión que preguntar a Dani: falla, qué capturas se guardan (contestada por
   Dani el 2026-10-12: zona y ventana, y las que hagan falta).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1: con `VIGIA_EVIDENCIAS=1`, un e2e de prueba que llama a `captureEvidence` con una zona del
  arnés de vistas deja los dos PNG y una entrada en `manifiesto.json` con el criterio, el título y
  las rutas; el PNG de la zona tiene el tamaño de la caja del `Locator`. e2e.
- CA1b: dos llamadas del mismo criterio con zonas distintas dejan cuatro PNG distintos y dos
  entradas en el manifiesto, sin pisarse. e2e.
- CA2: sin `VIGIA_EVIDENCIAS`, el mismo test no deja ningún fichero en `test-results/evidencias`.
  e2e.
- CA3: con un gráfico de ECharts en la zona, dos capturas seguidas de la zona dan los mismos bytes
  (no se capturó a media animación), tanto en la zona como en la ventana, y el manifiesto dice
  `estable: true`. e2e.
- CA3b: si la zona no deja de cambiar antes del tiempo máximo (una zona de prueba que cambia sin
  parar), se guarda la última captura con `estable: false` y el test no falla. e2e.
- CA3c: con el foco en un campo de texto y el ratón sobre un elemento con tooltip, la captura sale
  estable (`estable: true`) y sin el tooltip; con `conservarFoco: true`, el campo sigue con el foco
  después de capturar. e2e.
- CA4: si la app no apunta al simulador, `captureEvidence` no guarda nada. Unitario de la función
  que lo decide.
- CA5: `test-writer.md` pide `captureEvidence` en los e2e de los criterios visibles, y
  `verifier.md` pide la tirada con `VIGIA_EVIDENCIAS=1` y la ruta del manifiesto, sin que cambie su
  resultado. Test de texto en `scripts/`, como los de `integration-docs.test.ts`.

## Pruebas a mano para Dani

- Ver las capturas de una ficha con pantalla y decir si la zona elegida enseña el criterio.

## Fuera de alcance

- Meter las capturas en el aviso (0108).
- Añadir capturas a los e2e de fichas ya hechas.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
