---
id: '0101'
titulo: Tests sin variables GIT_* heredadas (el core.bare=true del checkout principal)
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0101-tests-sin-variables-git
adrs: ['0013'] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 2
---

## Petición original

Petición del Orquestador (2026-10-12), con prioridad porque Dani quiere atajar lo que frena el
flujo: averiguar quién dejó `core.bare=true` en el `.git/config` común del repositorio y evitar que
se repita.

## Especificación

**Hechos** (del Orquestador):

- El 2026-10-12 a las 01:21:29 se modificó el `.git/config` común del checkout principal y quedó con
  `core.bare=true`. Desde entonces, en el checkout principal, git fallaba con «this operation must be
  run in a work tree». Los worktrees seguían funcionando. Dani lo restauró a mano.
- A esa hora acababa de integrarse la 0091: su pre-commit lanzó `npx vitest related` y después vino
  el push. No se sabe qué proceso escribió el fichero.
- Precedente de la misma familia (0091): en el pre-commit, git exporta `GIT_INDEX_FILE` (y en otros
  hooks, `GIT_DIR` y compañía), y los tests que lanzan git en carpetas temporales las heredaban y
  escribían en el repositorio real. Se arregló solo en `scripts/scan-tenant.test.ts`
  (`withoutGitVars` y el borrado de `GIT_*` de `process.env` al cargar el fichero).
- Tests que lanzan git en repositorios temporales (candidatos): `pre-push.test.ts`,
  `pre-push-refs.test.ts`, `check-push-refs.test.ts`, `affected-e2e.test.ts`,
  `notify-telegram.test.ts` y los que importan funciones que llaman a git con `process.env`.

**Qué se hace:**

1. **Reproducir** en carpetas temporales (nunca en el repositorio real) la hipótesis: un `git init`
   (u otro comando de git de los tests) lanzado con `GIT_DIR` apuntando a otro repositorio deja
   `core.bare=true` en el config de ese otro repositorio. Queda como test (CA1). Además, el developer
   intenta localizar cuál de los candidatos lo hace, lanzando cada fichero con las variables de un
   hook (en una copia temporal, nunca contra el repositorio real), y lo anota en «Verificación». Si
   la hipótesis no se reproduce, se para y se avisa: es `[ALCANCE]`.
2. **Guarda para todos los tests**: un fichero de `setupFiles` de Vitest (en `vitest.config.ts`)
   que borra de `process.env` todas las variables que empiezan por `GIT_` antes de cargar cada
   fichero de test, con la misma regla que `withoutGitVars`. Así ningún test hereda las variables
   del hook, lo lance quien lo lance (el pre-commit, el `check` o una sesión). La función de limpieza
   queda exportada y con su test. El borrado local de `scan-tenant.test.ts` puede quedarse o pasar
   a usar la función común; lo decide el developer.
3. Anotar la regla en `scripts/` o en `src/CLAUDE.md` (donde viven las lecciones de los tests): un
   test que lanza git nunca depende de las variables `GIT_*` del entorno.

## Carril

Normal (`ligera: no`). Sin exclusiones: no toca los hooks (`.githooks/`), ni permisos, ni
dependencias; solo la configuración de los tests y un fichero de preparación.

1. No añade componentes, funciones ni cálculos nuevos: **no cumple**; añade una función de limpieza
   y un fichero de `setupFiles`.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: cumple en la app; cambia el arranque de todos los tests.
4. No hay ninguna decisión que preguntar a Dani: cumple.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1: test de reproducción en carpetas temporales: con `GIT_DIR` apuntando a un repositorio de
  prueba con árbol de trabajo, el comando de git identificado en el paso 1 deja `core.bare=true` en
  ese repositorio; sin la variable, no lo toca.
- CA2: la función de limpieza quita todas las `GIT_*` (también en minúsculas o mezcladas, como en
  Windows) y deja intactas las demás variables.
- CA3: `vitest.config.ts` carga el fichero de preparación en `setupFiles`, y un test que arranca
  Vitest en un proceso hijo con `GIT_DIR`, `GIT_WORK_TREE` y `GIT_INDEX_FILE` puestos comprueba que
  dentro de los tests ninguna de ellas llega a `process.env`.
- CA4: `npm run check` en verde, también lanzado desde un commit (con el pre-commit, que exporta las
  variables de git).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Que el pre-commit o el pre-push avisen si `core.bare` es `true` en un repositorio con árbol de
  trabajo: toca los hooks, que son una puerta de seguridad del flujo (como en la 0088). Si Dani lo
  quiere, ficha aparte.
- Encontrar con certeza el proceso de las 01:21:29 si no deja rastro: basta con cerrar el mecanismo.
- Tests de la app (`src/`) que no lanzan git: la guarda los cubre igual, sin cambiarlos.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios:** cada CA con su test en `scripts/lib/git-env.test.ts`, sin tocar desde 308953e. CA1 pasa sin código (reproduce git, como avisa la ficha); CA2 y CA3 fallarían sin él. La sonda se salta en el hijo con `VIGIA_GIT_ENV_PROBE`. CA4, del verifier.
- **Nada necesita una `GIT_*`:** solo `git-env.test.ts` y `scan-tenant.test.ts` las usan, para quitarlas. `control-chars.test.ts:40` (`git ls-files` sin `env` ni `cwd`) lee el índice normal del worktree, igual que el del hook en un commit normal, y el contenido del disco: no pierde nada.
- **Culpable cubierto:** `scripts/lib/env-file.test.ts:47-53` hereda `process.env`, que ya llega limpio por `vitest.config.ts:12` (`scripts/lib/vitest-git-env.setup.mjs`); CA3 lo prueba con un Vitest hijo.
- **Dónde va la regla:** la ficha permitía `src/CLAUDE.md`; cumple, aunque quien trabaje en `scripts/` no la verá sola. Lo que protege es la guarda.
- Sin secretos, datos del tenant, dependencias, API ni IPC.

Opcional: una línea en el `CLAUDE.md` raíz o un `scripts/CLAUDE.md` mínimo que remita a la regla; `vitest.live.config.ts` no carga el `setupFiles` (hoy no lanza git); un unitario directo de `deleteGitVars`.

### Ronda 2 (arreglo del CI): APROBADO

- **El arreglo funciona:** en el CI el color va pegado al número (`\x1b[32m1 passed`) y entre la `m` y el `1` no hay frontera `\b`. `stripVTControlCharacters` (`node:util`, sin dependencia nueva) quita esas secuencias antes de comparar; la comprobación ya no depende del color.
- **CA3 comprueba lo mismo:** hijo con código 0, exactamente `1 passed` (`\b` sigue descartando `11 passed`) y `core.bare` del repositorio falso en `false`. El cambio del test lo hizo el test-writer al reabrirse la ficha, anotado en ella.
- **No toca nada más:** `integra/20261012-2..fix/0101-ci` (12493b4, a5d6611) solo cambia `scripts/lib/git-env.test.ts` (un import y la línea de `output`) y la ficha.

## Verificación

Tests escritos en `308953e` (`scripts/lib/git-env.test.ts`). Contrato que fijan (la ficha no daba
nombres): `scripts/lib/git-env.mjs` exporta `withoutGitVars(env)`, que devuelve un objeto nuevo
sin las `GIT_*` (sin distinguir mayúsculas) y no modifica la entrada; `vitest.config.ts` declara en
`test.setupFiles` el fichero de preparación.

- CA1 → «CA1 (0101): con GIT_DIR apuntando al gitdir de un worktree, git init en otra carpeta pone
  core.bare=true en el config común» y «CA1 (0101): sin GIT_DIR, git init en otra carpeta no toca el
  repositorio de prueba». La hipótesis se reproduce (git 2.55, carpetas temporales): `git init`
  con `GIT_DIR` apuntando a `.git/worktrees/<wt>` (lo que exporta un hook lanzado desde un
  worktree) pone `core.bare=true` en el config común; con `GIT_DIR` apuntando al `.git` del checkout
  principal, no. Este test pasa ya: prueba el comportamiento de git, no código nuevo. Queda al
  developer localizar qué candidato lanza ese `git init`.
- CA2 → los tres «CA2 (0101): …» (mayúsculas, minúsculas y mezcladas; las demás intactas, como
  `GITHUB_ACTIONS` o `VIGIA_GIT_DIR`; objeto nuevo sin tocar la entrada).
- CA3 → «CA3 (0101): vitest.config.ts carga un fichero de preparación en setupFiles», la sonda
  «CA3 (0101): sonda, ninguna variable GIT_ llega a process.env dentro de un test» (corre también en
  la pasada normal) y «CA3 (0101): Vitest lanzado con GIT_DIR, GIT_WORK_TREE y GIT_INDEX_FILE no las
  pasa a los tests» (Vitest hijo con las variables apuntando a un repositorio falso temporal).
- CA4 → lo ejecuta el verifier (`npm run check` desde un commit); no es un test.

Ejecución con los tests nuevos: 6 fallan (módulo que no existe, `setupFiles` vacío y variables
`GIT_*` que llegan a los tests; la sesión ya trae 8, como `GIT_ASKPASS`) y pasan los 2 de CA1.

Verificación 2026-10-12, commit 67db4c0, rango `integra/20261012-2..fix/0101-tests-sin-variables-git`: **VERDE**

- `npm run check`: 4162 tests (226 ficheros), cobertura ok (líneas 93,58 %, ramas 90,03 %).
- CA4: `npm run check` lanzado desde un hook de git en un commit de prueba de un worktree temporal, con 16 variables `GIT_*` exportadas por git: código 0, 4162 tests. El pre-commit real (que solo lanza `vitest related`) también pasó en un commit de prueba.
- `test:e2e:affected`: «solo docs o tests unitarios»; ningún spec.
- `core.bare` del checkout principal: `false` antes y después.

Verificación 2026-10-12 (arreglo del CI), commit 4e7fda1, rango `integra/20261012-2..fix/0101-ci`: **VERDE**

- `npm run check`: 4162 tests (226 ficheros), cobertura ok (líneas 93,58 %, ramas 90,03 %).
- `npx vitest run scripts/lib/git-env.test.ts`: 8/8 con `FORCE_COLOR=1` (como en el CI) y 8/8 sin él.
- `core.bare` del checkout principal: `false` antes y después.

## Resultado

**Culpable localizado: `scripts/lib/env-file.test.ts`** (ficha 0055). Su `git()` no limpia el
entorno y `repoWithWorktree()` empieza con `git init -q` en una carpeta temporal. Prueba (en
carpetas temporales): un pre-commit lanzado desde un worktree exporta `GIT_DIR=<repo>/.git/worktrees/<wt>`
y `GIT_INDEX_FILE`; con esas dos variables apuntando a un repositorio de prueba con worktree, se
lanzó cada candidato con `npx vitest run <fichero>`. Solo `env-file.test.ts` dejó
`core.bare=true` en el repositorio de prueba. `pre-push`, `pre-push-refs`, `scan-tenant`,
`check-push-refs`, `affected-e2e`, `affected-e2e-spawn`, `notify-telegram`,
`ci-changes.main`, `e2e-cuarentena`, `e2e-projects` y `src/test/live-usage` no lo tocaron;
`control-chars.test.ts` falló con esas variables (lee el repositorio que dice `GIT_DIR`), pero sin
tocar el config. Con la guarda, `env-file` y `control-chars` pasan con las mismas variables y
`core.bare` sigue en `false`.

- `scripts/lib/git-env.mjs`: `isGitVar`, `withoutGitVars` y `deleteGitVars`.
- `scripts/lib/vitest-git-env.setup.mjs`, en `test.setupFiles` de `vitest.config.ts`.
- Regla anotada en `src/CLAUDE.md`.
- (developer) `scan-tenant.test.ts` conserva su limpieza local: importar el `.mjs` de forma
  estática desde TypeScript pediría declarar tipos, y con la guarda ya no hace falta tocarlo.
- Commits: `308953e` (tests), `f5fa317` (guarda), `8129e33` (regla y culpable), más los de revisión y verificación. Una ronda de revisión (APROBADO). Sin ADR nuevo ni migraciones.

**CI de la PR #24 (Orquestador, 2026-10-12).** Run 38187118544: falla un test de 4162, «CA3 (0101):
Vitest lanzado con GIT_DIR, GIT_WORK_TREE y GIT_INDEX_FILE no las pasa a los tests»
(`scripts/lib/git-env.test.ts:198`). El Vitest hijo pasa («Tests 1 passed | 7 skipped»), pero en el
CI su salida lleva códigos de color ANSI pegados al número y `/\b1 passed\b/` no casa. Es un error
del test, determinista (no un inestable): no se relanza. Se reabre en `fix/0101-ci` y vuelve al
test-writer.

Arreglo del test (test-writer, 2026-10-12): la salida del Vitest hijo se compara sin secuencias ANSI (`stripVTControlCharacters` de `node:util`), así no depende de cómo venga el color en el entorno; pasa en local con y sin `FORCE_COLOR=1`.
