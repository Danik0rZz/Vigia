---
id: '0098'
titulo: 'CI: por qué el runner de Windows falla al azar en los e2e desde el 2026-10-11, y su arreglo común'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0098-ci-e2e-fallos-al-azar
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Dani, por el Orquestador (2026-10-11): ficha nueva, por delante de la 0086 y la 0096, para
investigar por qué el runner de Windows del CI falla al azar desde hoy. En las últimas PR, casi cada
ejecución falla en un e2e distinto y ajeno a la ficha. Hipótesis a medir: tiempos de espera
ajustados al runner, la 0079 (`gatedFetch`), la 0070 (reparto de specs y arnés) o carga del runner;
comparar duraciones de runs antes y después de la 0070 y la 0079 con `node scripts/ci-times.mjs <run>`.

## Especificación

**Los fallos vistos** (todos pasan al relanzar):

- `views-problema-detalle.spec.ts`: la cola de gráficos (0086, en cuarentena), la evidencia de 45
  días (0096, en cuarentena), «v0.10.0: tabla de evidencias…» y «v0.10.0: tabla virtualizada…» (0097).
- `views-problemas.spec.ts`: «grid de Problemas: ARIA…» (tooltip «Cerrado», dentro de la 0096).
- `shell.spec.ts`: «CA2 (0021)… 1024×720».
- `views-portapapeles.spec.ts`: «captura del gráfico al portapapeles» (PR #12, run 38160295714,
  intento 2).
- Unitario: `scripts/react-compiler.test.ts`, CA3 (0059), por tiempo.
- Los de git real de la 0088 (ya arreglados en su ficha).

**Dato de la 0086:** su fallo era del test: el retardo fijo del simulador (400 ms) era más corto que
cada despliegue de fila en el runner de Windows. Se arregló con una compuerta en el simulador
(`sim.eventMetricGate`, como `detailGate`) en vez de esperas fijas. Buscar en los specs de vistas
otros tests que dependan de un retardo fijo del simulador frente al ritmo del runner.

1. **Medir antes de cambiar nada.** Con `node scripts/ci-times.mjs <run>`, duraciones del job y de los
   pasos de e2e en runs de antes y de después de la 0070 y la 0079, y qué falla en cada uno. Una
   pista para empezar, no un diagnóstico: antes de la 0070 casi todas las vistas iban en un único
   spec (un worker); desde la 0070, cada spec de vistas lanza su app y su simulador, así que en el
   runner (4 núcleos, 4 workers) hay hasta 4 apps Electron a la vez donde antes había una. Comprobar
   también si el reloj de los tests (esperas de 5 s de `expect`, tiempos de tooltips y animaciones)
   va justo con esa carga, y si `gatedFetch` alarga el arranque de las vistas.
2. **Diagnóstico escrito en «Resultado»:** la causa común (o que no la hay), con los números que la
   sostienen, y qué fallos explica y cuáles no.
3. **Arreglo común, si lo hay**, en el sitio de la causa: configuración de Playwright o del CI
   (workers del CI, tiempos de `expect`), el arnés de vistas o la app. Cada cambio con su porqué en
   la ficha. Límites:
   - nada de reintentos (`retries` sigue en 0) ni de subir tiempos «por si acaso»: solo un valor
     medido y justificado;
   - si el arreglo toca `gatedFetch` o la verificación de certificados (0079), o la definición de
     «CI ok» (`.github/workflows/ci.yml`), se para y se pregunta (`[ALCANCE]`) y el reviewer marca la
     exclusión `seguridad`: la ficha pasa a ir sola en su PR, como dijo la 0077;
   - menos workers en el CI es una salida válida si los números lo sostienen.
4. **Lo que no explique la causa común** se anota en «Resultado» para el Planificador (una ficha de
   arreglo por test confirmado, como la 0086). Las fichas 0086, 0096 y 0097 siguen: si el arreglo
   común las resuelve, su developer lo comprueba y lo dice en su ficha.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la
   duda, no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **puede no cumplirse**, si la causa está en la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo los `[ALCANCE]` del punto 3.

## Criterios de aceptación

- CA1: si el arreglo cambia la configuración (workers o tiempos de Playwright, el CI o el arnés), un
  test unitario en `scripts/` con «(0098)» en el nombre fija el valor nuevo (como el de workers de la
  0070). Si el arreglo está en la app, un test que falla sin él y pasa con él, con «(0098)».
- CA2: el job de e2e del CI de la PR de la ficha pasa tres veces seguidas sin ningún fallo en el
  proyecto `e2e` (la primera ejecución y dos relanzamientos con `gh run rerun`), y los tiempos de las
  tres se apuntan en «Verificación».
- CA3: `npm run check` y la guarda de la 0075 siguen en verde.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Arreglar uno por uno los tests sueltos que no explique la causa común (cada uno, su ficha).
- `retries` distinto de 0.
- Cambiar el runner del CI (otro sistema o máquina más grande): si hiciera falta, se le propone a
  Dani (configuración de GitHub y coste).

## Ideas surgidas (fuera de alcance)

- (developer) Un script en `scripts/` que, a partir del log de un job, saque la duración de cada
  test y cuántas apps había a la vez (la tabla del punto 3 de «Resultado»): serviría para ver pronto
  si una ficha vuelve a saturar el runner. Para esta ficha se hizo con scripts sueltos, fuera del
  repositorio.

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios.** CA1 se cumple: «CA1 (0098): con CI, 2 workers» fija `CI_WORKERS = 2`, el valor medido (x1,11 con 2 apps a la vez); falla sin el cambio (en 15555f8 el test exige 2 y la config sigue en 4). Sustituir «CA5 (0070): con CI, 4 workers» es correcto (la 0087 hizo lo mismo con el de local). CA2 y CA3, del verifier y del Orquestador.
- **Límites.** El diff solo toca `playwright.config.ts`, `e2e/CLAUDE.md`, dos tests de `scripts/` y la ficha. `retries` sigue en 0; no se tocan tiempos de `expect`, `gatedFetch`, certificados ni `.github/workflows/ci.yml`. Sin datos del tenant.
- **Diagnóstico.** Los números sostienen la conclusión (6 % → 50 % de intentos fallidos; lentitud x0,91, x1,11, x1,69 y x2,11 con 1-4 apps). `gatedFetch` descartado con argumento razonable. El reviewer no ejecutó `ci-times.mjs` (su rol no lo permite): revisó la coherencia interna.

Opcional (no bloquea):

1. [Datos] La columna «Fallos» del punto 3 de «Resultado» no apoya por sí sola la conclusión; lo que la sostiene es «Lentitud». Una línea en la ficha que lo diga.
2. [Legibilidad] El comentario de `CI_WORKERS` dice «fallaban en una espera de 5 s»; mejor «fallaban por tiempos».
3. [Docs] La entrada de la 0098 en el CHANGELOG debe dejar claro que el CI pasa a 2 (la de la 0087 dice «El CI sigue con 4»).

## Verificación

**Tests escritos antes del desarrollo (test-writer, 2026-10-11): ninguno.** La ficha no fija de
antemano ningún valor de configuración ni ningún comportamiento de la app: el arreglo depende del
diagnóstico (punto 2), así que no hay un test que pueda fallar ahora sin inventar el arreglo. La
única restricción fija, `retries` en 0, ya la guarda `scripts/e2e-projects.test.ts` («CA1 (0075):
los proyectos solo cambian el filtro…», `expect(config.retries).toBe(0)`); si el developer la
rompe, ese test falla.

Quién comprueba cada criterio:

- CA1: **developer**. Cuando conozca la causa, escribe el test con «(0098)» en el nombre: si el
  arreglo es de configuración (workers, tiempos de `expect` o de Playwright, CI o arnés), un
  unitario en `scripts/` que fije el valor nuevo, como `scripts/playwright-workers.test.ts` de la
  0070; si es de la app, un test que falle sin el arreglo y pase con él (lo demuestra en esta
  sección, con la salida sin y con el cambio). Si no hay arreglo común, CA1 no aplica y se dice
  aquí. El reviewer comprueba que el valor fijado es el medido en «Resultado», no uno «por si
  acaso».
- CA2: **CI de la PR** (lo lanza y apunta el Orquestador o el verifier): la primera ejecución y
  dos `gh run rerun` del job de e2e, sin fallos en el proyecto `e2e`, con los tiempos de las tres
  (`node scripts/ci-times.mjs <run>`) apuntados aquí.
- CA3: **verifier**: `npm run check` en verde y la guarda de la 0075 (`scripts/e2e-projects.test.ts`,
  `scripts/e2e-tags.test.ts` y `scripts/ci-workflow.test.ts`, que van dentro de `npm run check`).

**CA1 (developer, 2026-10-11):** el arreglo es de configuración: `workers` del CI pasa de 4 a 2
(`playwright.config.ts`, `CI_WORKERS`). Lo fija «CA1 (0098): con CI, 2 workers» en
`scripts/playwright-workers.test.ts`, que sustituye a «CA5 (0070): con CI, 4 workers» (era el valor
que esta ficha cambia; los otros dos tests del fichero siguen igual). Sin el cambio falla
(`expected 4 to be 2`, commit 15555f8); con él, pasa (commit 99a411a).

Verificación 2026-10-11, commit 66ad1a9, rango `integra/20261011-19..fix/0098-ci-e2e-fallos-al-azar`: **VERDE**

- `npm run check`: 4106 de 4106, cobertura ok. En el primer pase falló por timeout de 5000 ms `scripts/react-compiler.test.ts` (CA3 0059), con la instalación recién hecha; aislado ×3 pasó, y el `check` completo repetido salió verde. Intermitente por carga, sin relación con el cambio (el mismo sospechoso del BACKLOG).
- e2e completo (`npm run test:e2e`, workers de local): 367 passed en 1,6 min, un pase.
- CA2 (tres pases verdes del CI de la PR): lo hace el Orquestador tras abrir la PR.

## Resultado

**Cierre (doc-writer, 2026-10-11).** Commits: eb91c5e (ficha sin tests previos), 5c01527 (test de
2 workers), aba788d (`CI_WORKERS = 2` en `playwright.config.ts`), f525426, 66ad1a9 y bc0c64e (ficha:
diagnóstico, revisión y verificación). Ficheros: `playwright.config.ts`,
`scripts/playwright-workers.test.ts`, `scripts/e2e-projects.test.ts`, `e2e/CLAUDE.md` y esta ficha.
Una ronda de revisión (APROBADO). ADR nuevo: ninguno. CA1 y CA3 cumplidos; **CA2 (tres pases
verdes del CI de la PR) pendiente**: lo hace el Orquestador tras abrir la PR y apunta aquí los
tiempos.

**Diagnóstico (developer, 2026-10-11).** Logs de los jobs `windows` de cada intento (API de GitHub,
`actions/jobs/{id}/logs`, solo lectura) y `node scripts/ci-times.mjs`; los números de cada test
salen de la línea `ok N … (duración)` del reporter `list`.

1. **Antes y después, en intentos del paso de e2e** (todos los runs `CI` desde el 2026-10-07): antes
   de la 0070 (hasta las 13:00 del 2026-10-11), **4 fallos en 64 intentos (6 %)**; desde la PR #7, que
   trajo a la vez la 0070 y la 0079, **13 fallos en 26 intentos (50 %)** (más 2 cancelados).
2. **El paso es más corto, pero cada test va más lento.** Paso de e2e antes: 7 min 12 s, 7 min 35 s y
   6 min 13 s (PR #3, #4 y #5; Playwright 6,8, 7,1 y 5,9 min). Después: de 3,3 a 5,5 min de
   Playwright. La suma de las duraciones de los tests subió de 433-522 s a 652-1043 s. Mismo test,
   mediana antes (PR #4 y #5) frente a 8 intentos después, en los ~370 tests comunes: 525 s → 853 s
   (x1,62). Por spec: los de vistas, x1,5 a x2,4 (`views-problema-detalle` 61 → 122 s,
   `views-problemas` 31 → 66 s, `views-portapapeles` 5 → 11 s); los que no son de vistas, igual o
   más rápidos (`errors` x1,02, `tenants` x1,09, `shell` x0,84, `tls` x0,88, `smoke` x0,78).
   Ejemplos: «grid de Problemas: ARIA…» 3,6-4,2 s → 7,4-12,6 s; «tabla de evidencias…» 2,9-3,2 s →
   5,9-9,7 s; «v0.9.2: carga diferida y cola…» 4,3 s → 11,8-12,8 s.
3. **La lentitud depende de cuántas apps hay a la vez, no del código nuevo.** Para cada test de
   vistas de los 17 intentos de después, cuántos specs estaban activos en el centro del test (cada
   spec activo es una app Electron, y los de vistas, además, su simulador) y su duración frente a la
   mediana de antes:

   | Apps a la vez | Tests | Lentitud | Fallos |
   | ------------- | ----- | -------- | ------ |
   | 1             | 176   | x0,91    | 0      |
   | 2             | 161   | x1,11    | 1      |
   | 3             | 867   | x1,69    | 3      |
   | 4             | 2993  | x2,11    | 9      |

   La columna «Fallos» no sostiene por sí sola la conclusión (por test sale un 0,6 %, un 0,35 % y un
   0,3 % con 2, 3 y 4 apps, casi plano); la que la sostiene es «Lentitud».

   El salto está entre 2 y 3: el runner (4 núcleos lógicos, sin GPU) se satura con más de 2 apps.
   Antes de la 0070 casi todas las vistas iban en un único spec, así que había 1 app de vistas y,
   al principio, los specs ligeros (suma/duración del paso: 1,2-1,5 apps de media); después, 3,3 de
   media durante todo el paso.

4. **No es `gatedFetch` (0079):** solo serializa la primera petición de cada host de cada sesión
   (una por arranque, contra el simulador en localhost), y los tests de vistas con 1-2 apps a la vez
   tardan lo mismo que antes de la 0079 (x0,91-x1,11). Tampoco es el código de los tests: con poca
   carga, los mismos tests van igual de rápidos.
5. **Comprobación local** (VPS, playwright limitado a 4 núcleos lógicos con `start /affinity F`,
   `CI=1`, proyecto `e2e` completo, 367 tests): 4 workers, 3,0 min y suma 500 s; 3 workers, 3,1 min y
   443 s; 2 workers, 3,9 min y 416 s; los tres en verde. Los núcleos de la VPS son más rápidos y
   tienen GPU, así que la saturación es menor que en el runner, pero confirma que con 2 workers la
   suite pasa entera y que la suma baja al bajar los workers.

**Causa común:** desde la 0070 el runner lleva 3-4 apps Electron a la vez y va saturado; cada test
de vistas tarda casi el doble y se come el margen de las esperas de 5 s de `expect`, de los tooltips
y de los retardos fijos del simulador. **Arreglo:** 2 workers en el CI (con 2 apps, x1,11). Coste
previsto: suma de tests a ritmo de antes ~550-600 s entre 2 workers, ~5 min de Playwright, entre lo
de ahora (3,3-5,5 min, con la mitad de intentos fallando) y lo de antes de la 0070 (5,9-7,1 min). Se
confirma con CA2. No se tocan `retries`, los tiempos de `expect`, `gatedFetch` ni `ci.yml`.

**Qué fallos explica:**

- Esperas de 5 s que se agotan con el runner saturado: `applyCiWindow` (`e2e/window-size.ts:48`, el
  `expect.poll` del tamaño) en «CA2 (0021)… 1024×720» de `shell` y en «al relanzar la app siguen el
  entorno activo…» de `tenants` (dos intentos de la PR #16); los tooltips de «grid de Problemas:
  ARIA…» («Cerrado») y de la evidencia de 45 días (0096); «captura del gráfico al portapapeles»;
  «CA4 (0010)» de `views-servicio` (`toBeVisible`); y el `page.reload` de 30 s de `resetState` en
  «CA1 (0034), nota del Orquestador…» de `views-aplicacion`.
- La cola de gráficos (0086): ya arreglada en su ficha con la compuerta; su retardo fijo (400 ms) era
  el que la lentitud dejaba corto.

**Qué no explica (para el Planificador):**

- «v0.10.0: tabla virtualizada: desplegar una fila con gráfico recalcula la altura» (0097, falló en
  4 intentos): tiene el mismo patrón que la 0086 (`sim.eventMetricDelayMs = 600`,
  `views-problema-detalle.spec.ts:315`, y lee `bottomOf(detail)` justo después del `expect.poll`;
  falló con `Expected > 725, Received 725`). Con menos carga fallará menos, pero la carrera sigue: se
  queda en su ficha. Es el único otro test de vistas que fija un retardo del simulador
  (`eventMetricDelayMs` solo se cambia en las líneas 315 y 1218 del spec).
- La evidencia de 45 días y el tooltip «Cerrado» (0096) y «v0.10.0: tabla de evidencias…»: la carga
  los explica, pero siguen en cuarentena con sus fichas; su developer comprueba con 2 workers si
  basta.
- Unitario `scripts/react-compiler.test.ts`, CA3 (0059), por tiempo: va en el paso `npm run check`,
  antes del e2e y sin apps abiertas; los workers de Playwright no le afectan. Si vuelve a fallar,
  ficha propia.
- Los de git real de la 0088: arreglados en su ficha.
- «CA5 (0020)» de `views-servicio` con `Application exited` (run 38163241467, intento 2): el intento
  se canceló a mano a mitad; no es un fallo.
