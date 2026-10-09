---
id: '0045'
titulo: e2e estable del smoke «la ventana no le quita el foco»
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: peticiones (el Orquestador, por la delegación de Dani del 2026-10-09; ver la especificación)
rama: fix/0045-e2e-smoke-foco-estable
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Sin petición de Dani: la abre el Orquestador, por la delegación de Dani mientras duerme, igual que
la 0044. El intermitente se apuntó en la 0044 y desde entonces ha salido en los e2e locales de los
developers de la 0032 y la 0033; si llega al CI, frena la cola.

## Especificación

El e2e `e2e/smoke.spec.ts` › «VIGIA_E2E: la ventana de la prueba se ve, pero no le quita el foco
del sistema a quien usa el PC» falla a veces con `visible: false` en
`expect(state).toEqual({ visible: true, focused: false })`, sobre todo con todos los e2e en
paralelo; solo, pasa.

Hipótesis a comprobar por el developer: con `VIGIA_E2E`, la ventana se enseña sin foco
(`showInactive` o similar) de forma asíncrona, y el test lee `isVisible()` antes de que llegue; o,
con carga, Windows tarda en reportarla visible. Arreglo preferido en el test: esperar con
`expect.poll` (tiempo acotado) a que `isVisible()` sea `true` y después comprobar que no tiene el
foco. Si la causa es de la app (la ventana de verdad no se enseña en algún caso), lo dice y se para:
eso sería otra ficha. No se suben timeouts globales ni se añaden `retries`.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): el test pasa 30 veces seguidas con `--repeat-each 30 --workers=1` y otras 30 con los
  workers por defecto, y en un e2e completo.
- CA2 (e2e): si la ventana tuviera el foco, el test sigue fallando (la espera solo cubre la
  visibilidad, no el foco).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar cómo la app enseña la ventana.

## Reproducción (developer)

- Con `main` (dcd24e7) y `out/` recién compilado,
  `npx playwright test e2e/smoke.spec.ts -g "VIGIA_E2E" --repeat-each 30` (workers por defecto)
  falló **22 de 30** y otra tanda de 10 falló casi entera, siempre con
  `{ visible: false, focused: false }`: nunca con el foco.
- Causa (del test, no de la app): `src/main/window.ts` crea la ventana con `show: false` y la enseña
  con `showInactive()` en `ready-to-show` (primer pintado). El `beforeAll` del smoke solo espera a
  `domcontentloaded`, que llega antes; el test leía `isVisible()` una sola vez, en ese hueco. Filtrado
  con `-g`, el test es el primero tras el `beforeAll` y cae casi siempre; en el e2e completo va
  detrás de otros tests del spec y solo cae cuando la carga de los 4 workers retrasa el pintado.
- La app sí enseña la ventana: con la espera, todas las repeticiones la ven (ver "Verificación").
- Arreglo: `expectShownWithoutFocus` (`e2e/window-state.ts`) lee el estado con `expect.poll` (10 s)
  hasta verla y comprueba el foco en **esa misma lectura**: si al verse tiene el foco, falla aunque
  después lo pierda (CA2). Sin tocar timeouts globales ni `retries`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

Ficha ligera: los tests del developer cubren CA1 (el smoke real con `expectShownWithoutFocus` y una
ventana sintética que se ve tarde) y CA2 (se ve con el foco y luego lo pierde: falla; nunca se ve:
falla acotado). El foco se comprueba sobre la misma lectura con la que el poll dio la ventana por
visible, así que la espera no puede esconderlo. Tests anteriores al arreglo (`3d1dba6`) y sin tocar
después. Solo cambian `e2e/smoke.spec.ts` y `e2e/window-state.ts`: ni app, ni
`playwright.config.ts`, ni timeouts globales, ni `retries`. La causa la confirma
`src/main/window.ts` (`show: false` y `showInactive()` en `ready-to-show`).

Opcional: el test «nunca se ve» comprueba más bien que la espera está acotada; podría ir como CA1.

## Verificación

- Tests (ficha ligera, del developer): 3d1dba6. Arreglo: a383321 (`e2e/window-state.ts`).
- Developer: `-g "0045" --repeat-each 30` con los workers por defecto, 120 de 120; `-g "VIGIA_E2E"
--repeat-each 30 --workers=1`, 30 de 30; e2e completo, 291 de 291 (dos veces, la segunda con
  `test:e2e:affected -- main..HEAD`, que lanza el completo). `npm run check` en verde.
- CA2: si el helper volviera a leer tras la espera (o esperase también al foco), el test «falla
  aunque después lo pierda» pasaría a fallar: la lectura falsa pierde el foco justo después.

### Verifier, 2026-10-09, commit `760aa76`, rango `main..fix/0045-e2e-smoke-foco-estable`: VERDE

- check: 2613 tests en 148 ficheros, cobertura ok.
- e2e completo (los specs fijan la ventana del CI con `useCiWindow`): 291/291.
- CA1: los 4 tests 0045 del smoke ×30 con `--workers=1`: 120/120; ×30 con los workers por defecto:
  120/120.

## Resultado

- Commits: tests `3d1dba6`, arreglo `a383321`; revisión y verificación `760aa76`, `b3b51fa`.
- Ficheros principales: `e2e/window-state.ts` (`expectShownWithoutFocus`) y `e2e/smoke.spec.ts`. La app no cambia.
- Rondas de revisión: 1 (aprobada). Verifier en verde: 291/291 e2e; CA1 120/120 con uno y con varios workers.
- ADR nuevo: ninguno. Migraciones: no.
