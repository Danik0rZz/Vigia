---
id: '0075'
titulo: 'e2e: cuarentena de los tests inestables con la etiqueta @inestable (no bloquean y siguen a la vista)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067', '0073'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0075-e2e-cuarentena-inestables
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 2
---

## Petición original

ADR-0013, parte 2, B (aprobada por Dani el 2026-10-10): «localizar los specs intermitentes, ponerlos
en cuarentena con una etiqueta (no bloquean, pero siguen a la vista) y una ficha de arreglo por cada
uno».

## Especificación

Primera ficha del lote **e2e-inestables**: el mecanismo, sin poner ningún test en cuarentena (eso es
la 0076).

- **Etiqueta `@inestable`**, como etiqueta de recurso en `e2e/areas.json` (`resourceTags`, 0067).
  Cada test con `@inestable` lleva además una anotación de Playwright de tipo `arreglo` con el
  número de su ficha de arreglo en `description`.
- **Dos proyectos de Playwright** en `playwright.config.ts`: `e2e` (todo menos `@inestable`, con
  `grepInvert`) y `inestables` (solo `@inestable`, con `grep`). Las demás opciones, iguales.
- **Bloquea solo `e2e`:** `test:e2e`, `test:e2e:nobuild` y `test:e2e:affected` lanzan solo
  `--project=e2e`. Un script nuevo, `test:e2e:inestables`, lanza el otro proyecto; el verifier lo pasa
  y apunta el resultado en la ficha, pero un fallo ahí no lo pone en rojo.
- **En el CI de las PR** (tal como quede tras la 0073): el paso del e2e completo lanza `--project=e2e`
  (bloqueante) y un paso más lanza `--project=inestables` con `continue-on-error: true` y escribe en el
  resumen del job (`$GITHUB_STEP_SUMMARY`) cuántos pasaron y fallaron, con el título y la ficha de
  cada uno que falló. «CI ok» no depende de ese paso.
- **Specs en modo serie** (`tenants.spec.ts` usa `mode: 'serial'`): un test sacado por `grepInvert`
  no se ejecuta en `e2e`, así que los siguientes no pueden depender de lo que él dejaba. El developer
  lo comprueba en `tenants.spec.ts` y lo documenta en `e2e/CLAUDE.md`; si un test depende de otro, la
  0076 lo dice antes de poner ninguno en cuarentena.
- **Guarda** (en la de la 0067): un test con `@inestable` tiene la anotación `arreglo`; la ficha
  `tasks/NNNN-*.md` existe; y no está `hecha` (si está hecha, la etiqueta sobra y hay que quitarla).
- **A la vista:** una sección «Tests en cuarentena» en `BACKLOG.md` que el doc-writer mantiene (test,
  spec, ficha de arreglo, desde cuándo). La guarda no la lee; la regla va en `docs/flujo.md`.
- **Documentación:** `docs/flujo.md` («Niveles de prueba» y «El CI, sin esperarlo»: un fallo que pasa
  al relanzar se anota como sospechoso y, si se confirma, va a cuarentena con su ficha) y
  `e2e/CLAUDE.md`.

## Carril

Normal (`ligera: no`). Toca el CI (servicio externo).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade proyectos, un script y
   una regla de la guarda.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia qué tests bloquean.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1 (test de `scripts/` sobre la config): hay dos proyectos; `e2e` excluye `@inestable` y
  `inestables` solo la incluye.
- CA2: `test:e2e`, `test:e2e:nobuild` y el plan de `test:e2e:affected` usan `--project=e2e`;
  `test:e2e:inestables` usa `--project=inestables`.
- CA3: con specs de ejemplo, la guarda falla con un `@inestable` sin anotación `arreglo`, con una
  ficha que no existe o con una ficha `hecha`.
- CA4 (`scripts/ci-workflow.test.ts`): en las PR, el paso de inestables usa
  `--project=inestables`, tiene `continue-on-error: true` y escribe en `$GITHUB_STEP_SUMMARY`; el
  paso bloqueante usa `--project=e2e`; `ci-ok` no depende del de inestables.
- CA5: con un test de ejemplo marcado `@inestable` (en un spec de prueba fuera de `e2e/` o con un
  filtro), `--list` del proyecto `e2e` no lo incluye y el de `inestables` sí.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Poner tests concretos en cuarentena (0076) y arreglarlos (0077, 0078 y las que salgan).
- Reintentos automáticos (`retries` sigue a 0).

## Ideas surgidas (fuera de alcance)

- (developer) Subir como artefacto el `test-results/` del paso de inestables cuando falle (con `if: steps.<id>.outcome == 'failure'`): ahora el resumen dice qué falló, pero la captura y el log de `failure-capture` de esos tests no se suben.
- (developer) Añadir `npm run test:e2e:inestables` a la tabla de comandos del README y del `CLAUDE.md` raíz.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [CA4] `.github/workflows/ci.yml:106`, `npm run test:e2e:inestables -- --reporter=list,json`: el job `windows` corre en `pwsh`, donde la coma sin comillas parte el argumento en dos (`--reporter=list` y `json`, que Playwright tomaría como filtro de ficheros). Con `--pass-with-no-tests` saldría en 0, no se escribiría `test-results/inestables.json` y el resumen diría siempre «No hay informe». Un test en cuarentena no llegaría a ejecutarse. Acción: entrecomillar (`'--reporter=list,json'`) o fijar el reporter sin depender del shell; comprobarlo en `pwsh` sin tests (resumen con 0) y con un spec de ejemplo `@inestable`. Si se pasa a `shell: bash`, guardar el código de salida antes (`bash -e` cortaría el resumen).

Bien: CA1–CA5 con su test numerado, sin tocar desde el commit de tests (6889ce6 tras el rebase); el cambio del ayudante `playwright()` responde a CA2. `/@inestable(\s|$)/` con `grep`/`grepInvert` de la misma constante: ningún test sin `@inestable` sale de `e2e`. `ci.yml` solo añade líneas; nada de la 0072/0073 se pierde; con `continue-on-error` el paso no cambia «CI ok». Guarda, datos y reglas, bien.

Opcional: corregir en «Verificación» el commit de tests (`d704489` → `6889ce6`); la guarda solo lee la opción `tag` (un `@inestable` en el título se saltaría la guarda; ficha aparte); `timeout-minutes` en el paso de inestables.

### Ronda 2: APROBADO

- Nota 1 de la ronda 1 resuelta: `ci.yml:109` pasa `'--reporter=list,json'` entre comillas simples y el paso lleva `timeout-minutes: 20`. cae83a8 solo cambia `ci.yml` y la ficha; CA4 y su test siguen igual.
- En pwsh 7 (shell del job `windows`), un literal entre comillas simples es un solo argumento; sin espacios ni comillas dentro, `$PSNativeCommandArgumentPassing` no lo altera. Con `$PSNativeCommandUseErrorActionPreference` en `$false`, si `npm` sale con 1 el resumen se escribe igual. Lo confirmará el CI de la PR.
- No rompe nada: `--pass-with-no-tests` sigue; «CI ok» no depende del paso; el commit de tests en «Verificación» ya es `6889ce6`.
- Opcional: precisar el comentario de `ci.yml:100-101` (en 5.1 no se partía; las comillas son para no depender de la versión).

## Verificación

Tests escritos en `6889ce6` (tras el rebase; antes `d704489`, `test(e2e): criterios de la ficha 0075`); fallan porque el código aún no existe.

- CA1 → `scripts/e2e-projects.test.ts`, «CA1 (0075): …» (importa `playwright.config.ts`: exactamente dos proyectos; `e2e` con `grepInvert` que saca `@inestable`, `inestables` con `grep` que solo lo deja; los proyectos solo llevan `name`, `grep` y `grepInvert`).
- CA2 → `scripts/e2e-projects.test.ts`, «CA2 (0075): …» (`test:e2e`, `test:e2e:nobuild` y `test:e2e:inestables` de `package.json`) y `scripts/affected-e2e.test.ts`, «CA2 (0075): el plan de test:e2e:affected…». El plan pone `--project=e2e` justo tras `playwright test`: el ayudante `playwright()` de los tests de la 0068 ya lo incluye en esa posición.
- CA3 → `scripts/e2e-tags.test.ts`, «CA3 (0075): …». API que fijan: `checkTags(specs, config, modules, tasks)`, con `tasks` = `{ file: 'tasks/NNNN-….md', code }[]` (el Markdown con su cabecera); anotación `annotation: { type: 'arreglo', description: 'NNNN' }` (objeto o lista); problemas nuevos `sin-arreglo`, `ficha-inexistente` y `ficha-hecha`, con fichero, test y (en los dos últimos) número de ficha en el mensaje. El test de los specs reales pasa ya las fichas de `tasks/`. También comprueba que `@inestable` está en `resourceTags` de `e2e/areas.json`.
- CA4 → `scripts/ci-workflow.test.ts`, «CA4 (0075): …» (un paso de las PR usa `--project=inestables`, en su `run` o en el script de `package.json` que lanza; tiene `continue-on-error: true`; él o el script `scripts/*.mjs|cjs` que llama escribe en `GITHUB_STEP_SUMMARY`; el paso bloqueante del e2e usa `--project=e2e`; `ci-ok` no nombra inestables ni mira `outcome`/`conclusion`).
- CA5 → `scripts/e2e-projects.test.ts`, «CA5 (0075): …» (spec de ejemplo en una carpeta temporal, config real con otro `testDir` y `playwright test --list --project=…`).

Ronda 1, nota 1 (developer): el reporter del paso de inestables va entre comillas
(`'--reporter=list,json'`) y el paso lleva `timeout-minutes: 20`. En la máquina no hay `pwsh`;
probado en `powershell` 5.1 con el `run` del paso tal cual, dentro de un script como el que monta
GitHub (`$ErrorActionPreference = 'stop'` delante y la salida con `$LASTEXITCODE`) y
`GITHUB_STEP_SUMMARY` en un fichero temporal:

- Sin tests en cuarentena: se crea `test-results/inestables.json`; resumen «Pasaron 0 y fallaron 0»;
  salida 0.
- Con un spec de ejemplo temporal en `e2e/` (sin commitear: un `@inestable` que pasa con `arreglo`
  0076, otro que falla con 0077 y uno estable): `[inestables]` ejecuta solo los dos `@inestable`;
  resumen «Pasaron 1 y fallaron 1» y «Fallaron: zz-ejemplo-0075.spec.ts: ejemplo falla (ficha
  0077)»; salida 1 (el paso en rojo, sin bloquear por `continue-on-error`). El fallo de `npm` no
  corta el script: el resumen se escribe igual.
- En `powershell` 5.1 la coma sin comillas tampoco partía el argumento (`node -e` recibe
  `--reporter=list,json` entero); `pwsh` 7 no se ha podido probar aquí, por eso las comillas, que
  valen igual en los dos y en bash.

Verificación 2026-10-11, commit d1a3aba, rango `main..feat/0075-e2e-cuarentena-inestables`: **VERDE**.

- `npm run check`: 210 ficheros, 3688 tests; cobertura: líneas 93,43 %, ramas 89,98 %, funciones 89,84 %, sentencias 92,68 %.
- `npm run test:e2e:affected -- main..d1a3aba`: completo (`playwright.config.ts` es transversal), un pase: 362 pasados, 0 fallos, 5,6 min.
- `npm run test:e2e:inestables`: sale con 0, sin tests en cuarentena.
- `npm run test:e2e` lanza solo el proyecto `e2e` (`playwright test --list`: 362 tests, todos `[e2e]`).

## Resultado

Commits (`main..HEAD`): tests `6889ce6`; código `2cf380f` (proyectos y guarda) y `1c76a08` (CI); docs `e815e25`; arreglo de la ronda 1 `cae83a8`. Ficheros principales: `playwright.config.ts`, `package.json`, `scripts/e2e-tags.cjs`, `scripts/affected-e2e.cjs`, `scripts/e2e-inestables-summary.mjs`, `.github/workflows/ci.yml`, `e2e/areas.json`, `docs/flujo.md`, `e2e/CLAUDE.md`. Rondas de revisión: 2 (CAMBIOS por el reporter sin comillas en pwsh; APROBADO). ADR nuevo: ninguno. Sin migraciones. Todavía no hay ningún test en cuarentena (0076). Pendiente de comprobar en el CI de la PR: el paso de inestables en `pwsh` 7.
