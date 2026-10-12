---
id: '0107'
titulo: Capturas de evidencias en los e2e de los criterios visibles
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0107-ci
adrs: ['0006'] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 2
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

### Ronda 1: APROBADO

- **Criterios:** CA1, CA1b, CA2, CA3, CA3b, CA3c, CA4 y CA5 tienen cada uno su test con su número y fallarían sin `e2e/evidence.ts` o sin los párrafos de los agentes. `captureEvidence` hace lo que pide la especificación: solo actúa con `VIGIA_EVIDENCIAS=1` (leída al llamarla), se niega si la app no apunta al simulador (lo apunta en el log y en las anotaciones del test), deja zona, ventana y manifiesto con nombres `<CA>-<n>-…` que no se pisan, con un cerrojo entre workers. Quita foco y ratón salvo con `conservarFoco` o `conservarRaton`, usa `caret: 'hide'` y `animations: 'disabled'`, y repite la captura hasta que dos seguidas coinciden, con tiempo máximo y `estable: false` si se pasa. La comprobación en Electron con Playwright 1.63 está en la cabecera de `e2e/evidence.ts`. `test-writer.md`, `verifier.md` y `e2e/CLAUDE.md` piden lo que dice la ficha.
- **Corrección de los tests (`git diff 517e3be..HEAD`):** del test-writer, por motivos de la prueba y sin cambiar criterios. En el CI (escala 1) no afloja CA1 ni CA1b: `expectPngFits` sigue con 1 px cuando `dpr === 1` y solo con otra escala admite `dpr + 1`. Filtrar por una `nota` única por copia no quita nada: CA1 sigue exigiendo una entrada con título y nota, y CA1b dos entradas, cuatro PNG distintos y el tamaño de cada zona.
- **Arquitectura y reglas:** no toca `src/`, IPC, esquema ni dependencias. `environments:getActive` y `tenants:list` existen en `src/shared/ipc.ts`. Sin URLs ni secretos en el log, sin endpoints de Dynatrace, fixtures con dominios de ejemplo. Comentarios en español, identificadores en inglés.
- **`e2e/areas.json`:** `e2e/evidence.ts` no tiene área y lanza el e2e completo, como ya pasa con `e2e/hover.ts`; no bloquea.

Opcional:

1. CA2 queda algo más flojo en `e2e/views-metricas.spec.ts` (`ownFiles` y `entriesOf`): antes exigía que no cambiara nada bajo `test-results/evidencias`; ahora mira solo los ficheros `CA2-…` y sus entradas. El fallo probable (no mirar la variable) sí lo detecta. Para reforzarlo sin la condición de carrera: con `repeatEachIndex === 0` y un solo worker, comparar también la lista completa de ficheros y los bytes del manifiesto.
2. En `captureEvidence`, `scrollIntoViewIfNeeded` va después de `quiet`: si al desplazar el puntero queda sobre algo con tooltip, podría salir en la captura. Se evita desplazando antes de `quiet`.
3. Dar área a `e2e/evidence.ts` en `e2e/areas.json` (p. ej. `@metricas`) para que un cambio en la ayuda no lance el e2e completo.

### Ronda 2 (arreglo de CI): APROBADO

- **Criterios:** lo que comprueba CA3c sigue igual (`e2e/views-metricas.spec.ts:657-678`): el campo tiene el foco antes de capturar; tras `captureEvidence`, `estable: true`, `tooltip.count() === 0` y el campo sin foco; con `conservarFoco`, dos entradas estables y el foco se mantiene. El cambio del developer en el test es solo de la preparación, por un fallo del CI, sin cambiar el criterio.
- **`toPass` (líneas 651-656):** solo se reintenta hasta que el tooltip se abre; lo que se comprueba después no se afloja. Cada intento empieza en `hoverFresh` → `moveToNeutral`, que cierra el tooltip anterior, así que la preparación se repite entera. Acotado: 2 s por intento y 20 s en total. El foco se comprueba fuera del reintento, con su propio mensaje.
- **Encaje con `e2e/CLAUDE.md`:** `field.scrollIntoViewIfNeeded()` va antes de `focus()` (lección de Radix) y se sigue usando `hoverFresh` (lección de la 0044).
- **Reglas:** no toca `src/`, IPC, dependencias, esquema, API ni `e2e/areas.json`; sin datos del tenant. La ficha anota el arreglo con su run del CI y los resultados (`--repeat-each 10`: 10 de 10; `check` en verde; affected 33 de 33) y deja claro que el fallo de CA4 (0010) no es de esta ficha.

## Verificación

Tests escritos en el commit 517e3be (test-writer, 2026-10-12); fallan porque aún no existe
`e2e/evidence.ts` (`Cannot find module './evidence'`) y por los textos de los agentes.

- CA1: `e2e/views-metricas.spec.ts`, «CA1 (0107): con VIGIA_EVIDENCIAS=1 deja la zona, la
  ventana y su entrada en el manifiesto».
- CA1b: `e2e/views-metricas.spec.ts`, «CA1b (0107): dos evidencias del mismo criterio con zonas
  distintas no se pisan».
- CA2: `e2e/views-metricas.spec.ts`, «CA2 (0107): sin VIGIA_EVIDENCIAS no deja ningún fichero en
  test-results/evidencias».
- CA3: `e2e/views-metricas.spec.ts`, «CA3 (0107): con un gráfico de ECharts en la zona, la
  captura no sale a media animación».
- CA3b: `e2e/views-metricas.spec.ts`, «CA3b (0107): si la zona no deja de cambiar, guarda la
  última con estable: false y no falla».
- CA3c: `e2e/views-metricas.spec.ts`, «CA3c (0107): quita el foco y el tooltip antes de capturar,
  salvo con conservarFoco».
- CA4: `scripts/e2e-evidence.test.ts`, «CA4 (0107): pointsToSimulator decide si la app apunta al
  simulador» (función pura `pointsToSimulator(url)` exportada de `e2e/evidence.ts`).
- CA5: `scripts/e2e-evidence-docs.test.ts`, «CA5 (0107): test-writer y verifier piden las
  evidencias».

Contrato que fijan los e2e (cabecera del bloque en el spec): `VIGIA_EVIDENCIAS` se lee al llamar
a `captureEvidence` (los tests la ponen en `process.env`); carpeta
`test-results/evidencias/<ficha>/` bajo `process.cwd()`; en el manifiesto, los campos `criterio`,
`nota` y `estable`, el título del test como valor y las rutas acabadas en `-zona.png` y
`-ventana.png` (nombres `<CA>-<n>-…`).

Corrección de los tests (test-writer, 2026-10-12, commit siguiente a 40a9c48): `expectPngFits`
admite `dpr + 1` px físicos con escala distinta de 1 (Playwright redondea el recorte a px CSS) y
sigue en 1 px con escala 1; cada copia del test marca sus evidencias con una `nota` propia y lee
solo las suyas, sin borrar la carpeta, y CA2 mira solo los `CA2-…` y sus entradas. Pasan los 6 en
local (escala 1,5) y con `--repeat-each 3 --workers 3` (18 de 18).

Verificación 2026-10-12, commit 1dc17af, rango integra/20261012-7..feat/0107-e2e-capturas-evidencias: VERDE

- check: 4257 tests (228 ficheros), cobertura ok (sentencias 92,98 %, ramas 90,13 %, funciones 90,37 %, líneas 93,75 %).
- e2e: un único pase de `test:e2e:affected`; como `e2e/evidence.ts` no tiene área, lanzó el completo: 380 de 380 (1,8 min). Sin `--repeat-each`: nada falló ni cambió temporización.
- evidencias: `VIGIA_EVIDENCIAS=1 npm run test:e2e:nobuild -- -g "(0107)"`: 6 de 6 (CA1, CA1b, CA2, CA3, CA3b y CA3c), con el manifiesto y la zona y la ventana de cada criterio en `test-results/evidencias/0107/`.

Verificación del arreglo de CI 2026-10-12, commit 0841570, rango main..fix/0107-ci: VERDE

- check: 4282 tests (229 ficheros), cobertura ok (líneas 93,75 %, ramas 90,13 %).
- e2e: `test:e2e:affected`: 33 de 33 (smoke y `views-metricas`, con los 6 de la 0107).
- «CA3c (0107)» con `--repeat-each 10`: 10 de 10; con `--workers=4` para forzar carga, otros 10 de 10 (3,6 a 4,1 s cada uno).
- evidencias: tirada con `VIGIA_EVIDENCIAS=1`, 6 de 6.

## Resultado

- Commits: 40a9c48 (`captureEvidence`), d079908 (textos de test-writer, verifier y `e2e/CLAUDE.md`), 517e3be y 011db60 (tests, con la corrección por escala de pantalla).
- Ficheros principales: `e2e/evidence.ts`, `e2e/views-metricas.spec.ts`, `scripts/e2e-evidence.test.ts`, `scripts/e2e-evidence-docs.test.ts`, `.claude/agents/test-writer.md`, `.claude/agents/verifier.md`, `e2e/CLAUDE.md`.
- Rondas de revisión: 1 (aprobado). ADR nuevo: ninguno. Sin migraciones. No toca la app.
- Ideas pasadas al BACKLOG: reforzar CA2, desplazar antes de quitar foco y ratón, dar área a `e2e/evidence.ts`.
- Arreglo de CI (rama `fix/0107-ci`, commit 1449b45, 2026-10-12): en el CI de la PR #32 (run 38256624161, intento 2) CA3c falló en la preparación: el tooltip de `nav-topology` no se abrió en 5 s tras `field.focus()` y `hoverFresh`. Ahora la preparación entera (traer el campo a la vista, foco y `hoverFresh` desde la zona neutra) se repite con `toPass` (2 s por intento, 20 s en total) hasta ver el tooltip; lo que comprueba CA3c no cambia (tras capturar, sin tooltip, `estable: true` y sin foco; con `conservarFoco`, el foco sigue). CA3c con `--repeat-each 10`: 10 de 10; `npm run check` en verde; `test:e2e:affected main..HEAD`: 33 de 33 (`views-metricas`). El fallo de CA4 (0010) en `views-servicio.spec.ts` del intento 1 no es de esta ficha y no se ha tocado.
