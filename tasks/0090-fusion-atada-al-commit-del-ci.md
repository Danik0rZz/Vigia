---
id: '0090'
titulo: 'La fusión de una PR va atada al commit que pasó «CI ok», y fuera el `[skip ci]` del ADR-0013'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0090-fusion-atada-al-commit
adrs: [13, 14] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 2
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la T-03.

## Especificación

**Hoy.** `.claude/commands/tarea.md` (paso 10) y `.claude/commands/cerrar-version.md` sondean
`gh pr checks <n>` leyendo texto y, con «CI ok» en verde, fusionan con `gh pr merge <n> --merge`.
Entre la lectura y la fusión, la rama `integra/…` puede recibir otro push (un «Traer `main`», un
arreglo del CI) y se fusionaría un commit cuyo CI no ha terminado. Además, el ADR-0013 dice que un
commit de medición con código «lleva `[skip ci]`»: GitHub no lanza el workflow de `pull_request` si
el último commit de la PR lo lleva, y la PR se quedaría sin «CI ok».

**Qué se hace.**

1. En los dos comandos: el verde se lee con `gh pr checks <n> --json name,state` filtrando el check
   «CI ok» (no leyendo texto), se toma el SHA de la cabeza con `gh pr view <n> --json headRefOid`
   antes de mirar los checks, y se fusiona con `gh pr merge <n> --merge --match-head-commit <sha>`.
   Si GitHub la rechaza porque la rama se ha movido, se vuelve a esperar el CI del commit nuevo.
   Las opciones de `gh` se comprueban con `gh pr merge --help` y `gh pr checks --help` de la versión
   instalada; si alguna no existe, se para y se avisa (`[ALCANCE]`).
2. `docs/flujo.md` («PR agrupada» o donde se describe la fusión) dice lo mismo.
3. ADR-0013: la frase de `[skip ci]` pasa a «la medición va en el commit de documentación; si tiene
   que ir con código, va en su PR y pasa el CI».
4. Los permisos de `.claude/settings.json` siguen dejando `gh pr merge <n> --merge` con
   `--match-head-commit` y siguen negando `--squash`, `--rebase` y `--delete-branch` (ficha 0082).

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (cómo se decide qué entra en `main`): va sola en
su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: se cumple (instrucciones y documentación).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: se cumple en la app; cambia el procedimiento de fusión.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: en `scripts/integration-docs.test.ts`, los dos comandos fusionan con `--match-head-commit` y
  leen «CI ok» con `--json`. Test con «CA1 (0090)».
- CA2: ningún fichero de `.claude/`, `docs/flujo.md` ni de `docs/adr/` vigente recomienda
  `[skip ci]`. Test con «CA2 (0090)».
- CA3: el test de permisos de la 0082 sigue en verde, y uno nuevo comprueba que
  `gh pr merge 12 --merge --match-head-commit abc123` no casa con ninguna regla de `deny`. Test con
  «CA3 (0090)».

## Pruebas a mano para Dani

- Ninguna. (Si Dani quiere cerrar también el hueco desde GitHub: en la protección de `main`,
  «Require branches to be up to date before merging». Es configuración de GitHub y la decide él.)

## Fuera de alcance

- La configuración de GitHub.
- «CI ok» con la salida vacía (ficha 0089).

## Ideas surgidas (fuera de alcance)

- (developer) El `CLAUDE.md` raíz («Push») y el ADR-0014 (punto 29) siguen diciendo `gh pr merge --merge` sin `--match-head-commit`: no los toca esta ficha (su alcance son los dos comandos, `docs/flujo.md` y el ADR-0013); convendría alinearlos.
- (developer) Decisión: en `docs/flujo.md` se mantiene la mención `gh pr merge --merge` como nombre de la estrategia, porque el test CA5 (0073) la exige; el comando completo, con `--match-head-commit`, va justo antes. `gh` 2.102.0: `--match-head-commit` y `--json name,state` existen.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Criterios / flujo] `.claude/commands/tarea.md:74`: la fusión de la PR solo de documentos que se abre al acabar la cola sigue con «push, PR y fusión con «CI ok» en verde», sin el procedimiento nuevo; también sale de una `integra/…` y le puede llegar un push entre el CI y la fusión. El test CA1 no lo ve (no hay fragmento `gh pr merge`). Acción: remitir al paso 10 (`headRefOid`, `--json name,state` y `--match-head-commit`).

Bien: la carrera se cierra (se lee `headRefOid` antes de los checks y se fusiona con `--match-head-commit`; con un push en medio, GitHub rechaza la fusión; volver a empezar está escrito en `tarea.md`, `cerrar-version.md` y `docs/flujo.md`). `settings.json` sin cambios; las reglas `deny` siguen cubriendo squash, rebase y delete-branch también con la forma nueva. CA1–CA3 con su test; 8c028e0 no cambia lo que se comprueba. El ADR-0013 ya no recomienda `[skip ci]`; no se pierde ninguna regla. Sin datos del tenant ni secretos.

Opcional: `docs/flujo.md:205` pasa de 100 columnas; en el ADR-0013 (líneas 91-94) «la medición va en el commit de documentación» sale dos veces; caso negado con la forma nueva en `claude-permissions.test.ts`. `CLAUDE.md` raíz (línea 71) sin `--match-head-commit`: no bloquea; alinearlo cambia el alcance (`[ALCANCE]`, lo decide Dani). El ADR-0014 no hace falta tocarlo.

### Ronda 2: APROBADO

- Nota 1 de la ronda 1 resuelta (65ead94): en `.claude/commands/tarea.md:74-76` la PR solo de documentos se fusiona como en el paso 10 (`headRefOid`, `--json name,state`, `--match-head-commit`; si GitHub la rechaza, se vuelve a empezar).
- Opcionales hechos: `docs/flujo.md:200-208` a 100 columnas (sigue la mención que exige CA5 de la 0073); el ADR-0013 sin la frase repetida; 87477d4 añade el caso negado con la forma nueva en Bash y PowerShell.
- Tests: desde 590872d solo 8c028e0 (tipos) y 87477d4 (añade casos). `settings.json` sin cambios; sin datos del tenant.
- Opcional: `.claude/commands/cerrar-version.md:36` pasa por poco de 100 columnas; `CLAUDE.md` raíz sin `--match-head-commit` (`[ALCANCE]`, lo decide Dani).

## Verificación

Tests: commit 590872d (`test(flujo): criterios de la ficha 0090 (#0090)`).

- CA1: `scripts/integration-docs.test.ts`, describe «CA1 (0090)»: en `tarea.md` y `cerrar-version.md`, todo `gh pr merge` es `gh pr merge <n> --merge --match-head-commit <sha>`, todo `gh pr checks` lleva `--json name,state` y hay un `gh pr view <n> --json headRefOid`.
- CA2: `scripts/integration-docs.test.ts`, describes «CA2 (0090)»: ninguna frase de `.claude/**/*.md`, `docs/flujo.md` ni de los ADR vigentes (Estado que no empieza por «sustituido») menciona `[skip ci]` sin negarlo.
- CA3: `scripts/claude-permissions.test.ts`, describe «CA3 (0090)» (Bash y PowerShell), más los de la 0082 que ya había. Pasa ya hoy: es una guarda de regresión.

Verificación 2026-10-11, commit 3efda0b, rango `main..fix/0090-fusion-atada-al-commit`: **VERDE**.

- `npm run check`: 221 ficheros, 4018 tests. El primer pase tuvo un fallo intermitente ajeno (`scripts/react-compiler.test.ts`, «CA3 (0059)», 5000 ms); aislado ×3, 3 de 3, y un segundo `check` completo en verde.
- `npm run test:e2e:affected`, un pase: 61 pasados, 0 fallos (zona `@problema-detalle`; el spec aparece en el rango solo porque `main` ganó la cuarentena de la 0096 después de que saliera la rama).

## Resultado

- Commits: 590872d (tests), de26fb0 (comandos y flujo), 56198b4 (ADR-0013), 8c028e0 (tipos del test), 65ead94 (PR solo de documentos) y 87477d4 (casos negados); más los de la ficha.
- Ficheros principales: `.claude/commands/tarea.md`, `.claude/commands/cerrar-version.md`, `docs/flujo.md`, `docs/adr/0013-carril-rapido-y-menos-repeticiones.md`, `scripts/integration-docs.test.ts` y `scripts/claude-permissions.test.ts`. `settings.json` sin cambios.
- Rondas de revisión: 2 (ronda 1 CAMBIOS por la PR solo de documentos; ronda 2 APROBADO). ADR nuevo: ninguno. Sin migraciones.
- Pendiente de Dani: alinear el `CLAUDE.md` raíz con `--match-head-commit` (`[ALCANCE]`, anotado en el BACKLOG). Va sola en su PR por la exclusión `seguridad`; la fusiona Dani.
