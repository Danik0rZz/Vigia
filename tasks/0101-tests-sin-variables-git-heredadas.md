---
id: '0101'
titulo: Tests sin variables GIT_* heredadas (el core.bare=true del checkout principal)
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente; aquí va también qué candidato reproduce el fallo)

## Resultado

(pendiente)
