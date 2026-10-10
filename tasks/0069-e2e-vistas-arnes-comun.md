---
id: '0069'
titulo: 'e2e: sacar el simulador y los ayudantes de views.spec.ts a un arnés común'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0069-e2e-vistas-arnes-comun
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10): «partir `views.spec.ts` por zonas (los
tests del portapapeles, juntos y en serie) y medir con más workers». Esta ficha es el primer paso:
preparar el terreno sin mover ningún test.

## Especificación

`e2e/views.spec.ts` tiene unas 17 900 líneas: las primeras ~5 300 son el Dynatrace simulado
(HTTPS en 127.0.0.1), los fixtures, los ayudantes y los ganchos (`beforeAll` lanza la app una vez
por worker, `beforeEach` la deja como al principio, `afterEach` y `afterAll`), y el resto son 261
tests. Para repartir los tests en varios specs (0070), todo lo que no es un test tiene que poder
importarse.

- Se mueve a uno o varios módulos de `e2e/` que **no** acaben en `.spec.ts` ni `.test.ts` (Playwright
  no los toma como tests): por ejemplo `e2e/views/harness.ts`, `e2e/views/simulator.ts` y
  `e2e/views/fixtures.ts`. El reparto lo decide el developer y lo explica en la cabecera.
- Los ganchos se registran con una función que cada spec de vistas llama una vez, arriba del todo:
  `setupViewsApp()` (no empieza por `use`, para no chocar con `react-hooks/rules-of-hooks`; ver la
  mejora anotada sobre `useCiWindow`). Sigue llamando a `useCiWindow` como ahora.
- El estado compartido (app, página, simulador, carpeta de exportación) se lee con accesores o un
  objeto exportado; el developer elige y lo comenta.
- `views.spec.ts` se queda con los 261 tests **sin tocar sus títulos ni sus cuerpos** (solo cambian
  los `import`). El comentario de cabecera pasa al arnés y se actualiza.
- **Guarda** (`scripts/e2e-views-harness.test.ts`, o dentro de la de la 0067 si encaja): todo spec
  que importe el arnés de vistas llama a `setupViewsApp()` exactamente una vez, en el nivel
  superior, y ningún spec de vistas declara su propio `beforeAll` de lanzar la app. Así, un spec
  nuevo de la 0070 que se olvide del arnés falla en `check` y no en un e2e confuso.
- `e2e/areas.json`: los módulos nuevos del arnés van como globs del área `views` (cambiarlos lanza
  los specs de vistas, como hoy cambiar `views.spec.ts`).

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade `setupViewsApp` y la
   guarda.
2. No elimina nada visible para el usuario: se cumple; solo `e2e/` y `scripts/`.
3. No toca datos, API ni lógica: se cumple para la app; reorganiza el código de los e2e.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: los 261 tests de `views.spec.ts` siguen con el mismo título y el mismo cuerpo (el diff de
  `views.spec.ts` solo quita código que no es un `test(...)` y cambia los `import`) y pasan en el e2e
  de `views`.
- CA2: la guarda pasa en el repositorio y, con specs de ejemplo, falla si un spec que importa el
  arnés no llama a `setupViewsApp()`, la llama dos veces o la llama dentro de un `describe` o de un
  test.
- CA3: la etiqueta de zona de la 0067 sigue en todos los tests (su guarda sigue en verde).

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Repartir los tests en specs por zona y medir los workers (0070).
- Cambiar o arreglar tests.

## Ideas surgidas (fuera de alcance)

- (developer) Solo se ha movido el bloque de arriba de `views.spec.ts` (y `markerProblems`, que el
  simulador usa). Los ayudantes y datos intercalados entre los tests (`withContentWidth`,
  `clipboardText`, `detailOnly.push(...)` de cada zona…) siguen junto a sus tests: en la 0070, los
  que use más de una zona pasarán al arnés.
- (developer) El arnés es un estado por worker: si un worker ejecuta dos specs de vistas, el segundo
  relanza la app y vuelve a crear los entornos (`env` se sobrescribe), pero los datos que cada spec
  añade al cargarse (`detailOnly.push`) se acumulan. Para la 0070, comprobar que no chocan los IDs.

## Notas del revisor

### Ronda 1: APROBADO

- CA1, comprobado sin fiarse del AST del developer: el diff de `views.spec.ts` tiene solo dos
  bloques (fuera la cabecera, datos, ayudantes y ganchos, con los `import` y `setupViewsApp()`; y
  fuera `markerProblems`, ahora en `e2e/views/fixtures.ts`). Ninguna línea quitada es un `test(`;
  261 tests antes y después, y el resto del fichero, idéntico. Los ganchos de `main` y los de
  `harness.ts` son idénticos y en el mismo orden.
- Guardas de las fichas 0021, 0030 y 0067 (`33a9aa1`), no más laxas: `e2e-ci-window` y
  `e2e-export-read` miran ahora todos los `.ts` de `e2e/` (más estrictas, con casos nuevos);
  `e2e-tags` suma las funciones con portapapeles de los módulos importados. Sin tocarlas habrían
  dejado de ver el arnés. La guarda de la ficha no se tocó tras `5bee504`.
- Ganchos dentro de `setupViewsApp` (llamada en el nivel superior, se registran en la suite del
  fichero) y `export let` como enlace vivo de solo lectura; `sim-state.ts` evita el ciclo.
- `e2e/views/**` en el área `views`; sin `src/`, dependencias, IPC, API ni nada del tenant.

Opcional:

- `e2e-tags.cjs` y `e2e-export-read.test.ts` emparejan por nombre de importación: no ven
  `import * as h` ni un alias de `exportTo`. Hoy nadie lo usa; cubrirlo o prohibirlo en la 0070.
- El comentario de `views.spec.ts` (≈5472) dice «y sus problemas para los recuentos», que ahora
  viven en `fixtures.ts`: retocarlo en la 0070.

## Verificación

Tests (test-writer): commit 5bee504, `scripts/e2e-views-harness.test.ts`.

- CA1: sin test nuevo. Lo cubre el e2e de `views` (`npm run test:e2e -- e2e/views.spec.ts`) más la revisión del diff de `e2e/views.spec.ts` (solo quita código que no es un `test(...)` y cambia los `import`). No se deja una guarda permanente contra la versión anterior porque la 0070 moverá los tests a otros specs.
- CA2: «checkHarnessUse (la propia comprobación)», con specs de ejemplo: acepta la llamada única en el nivel superior (también con alias) e ignora los specs que no importan el arnés; falla sin llamada (también si solo importa otro módulo del arnés), con dos llamadas, dentro de un `describe`, de un test o de un gancho, dentro de un `if`, y si el spec lanza la app con su propio `beforeAll`. Sobre el repositorio, «arnés de vistas en el repositorio»: un único módulo de `e2e/` (no spec ni test) exporta `setupViewsApp`; `views.spec.ts` importa el arnés; cada `e2e/*.spec.ts` lo usa bien; el arnés lanza la app y llama a `useCiWindow` justo después; cada módulo del arnés está en los globs de `views` y `decide` lanza `e2e/views.spec.ts`. El arnés se localiza sin suponer su nombre: el módulo que exporta `setupViewsApp` y, si está en una subcarpeta de `e2e/`, sus vecinos.
- CA3: sin test nuevo; lo cubre la guarda de la 0067 (`scripts/e2e-tags.test.ts`), que debe seguir en verde.

### Verifier, 2026-10-10, commit `d744b7e`, rango `main..feat/0069-e2e-vistas-arnes-comun`: VERDE

- check: 3535 tests, cobertura ok (líneas 93,43 %, ramas 89,98 %).
- e2e completo (toca `e2e/areas.json`), un único pase: 361/362. Falló una vez «CA1 (0036)» de
  `views.spec.ts` (la tarjeta Información es la última sección): timeout de 60 s en `settledBox`
  (el elemento deja de moverse). Aislado ×3 con `--workers=1`: 3/3. `settledBox` es el mismo código
  que ya estaba en `main` (solo se movió al arnés): intermitente con los workers en paralelo,
  anotado como sospechoso para la ficha B.
- `views.spec.ts` entero ×3 con `--workers=1` (por el cambio de ganchos): 795/795.
- AUD-03 y AUD-21 no fallaron.

## Resultado

- Commits: `5bee504` (tests), `9b78be0` (arnés), `33a9aa1` (guardas anteriores miran el arnés), `3eabf4b` (reglas de `e2e/`), más los de ficha.
- Ficheros principales: `e2e/views/harness.ts`, `e2e/views/simulator.ts`, `e2e/views/fixtures.ts`, `e2e/views/sim-state.ts`, `e2e/views.spec.ts`, `e2e/areas.json`, `scripts/e2e-views-harness.test.ts`, `scripts/e2e-tags.cjs`, `e2e/CLAUDE.md`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Sin migraciones.
- Los dos opcionales del reviewer y el sospechoso «CA1 (0036)» pasan a «Mejoras anotadas» del BACKLOG; las ideas del developer quedan para la 0070.
