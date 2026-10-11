---
id: '0082'
titulo: 'Permisos de Claude: negar las fusiones por squash o rebase, el borrado de ramas al fusionar y el push que borra una rama remota'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: ideas-backlog # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: chore/0082-permisos-claude-fusiones
adrs: [7, 14] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 2
---

## Petición original

BACKLOG, «Mejoras anotadas» (surgió en 0073): «Permisos de `.claude/settings.json`: negar
`gh pr merge --squash`, `--rebase` y `--delete-branch` y `git push origin :<rama>`, como ya se
niegan el force push y los tags (hoy que fusione solo Dani las PR de una ficha y que nadie borre
ramas remotas está solo escrito en `docs/flujo.md`). Ficha propia; lo decide Dani». Dani dijo que sí
el 2026-10-11.

## Especificación

Añadir a `permissions.deny` de `.claude/settings.json`, en `Bash(…)` y en `PowerShell(…)` como las
reglas que ya hay:

- `gh pr merge` con `--squash`, `-s`, `--rebase`, `-r`, `--delete-branch` o `-d`, en cualquier
  posición de la línea (`gh pr merge * --squash*` y las demás, como las de `--force`).
- `git push` con una refspec que borra una rama remota: `git push * :*` (por ejemplo,
  `git push origin :rama`). `git push * --delete *` ya está negado.

Lo que tiene que seguir permitido, porque es el flujo de hoy (`docs/flujo.md`, «Git»):
`gh pr merge <n> --merge` (las PR agrupadas), `gh pr create`, `git push origin integra/<nombre>` y
`git push -u origin integra/<nombre>`.

Al cerrar: se quita la línea del BACKLOG y se dice en `docs/flujo.md` («Git» o «Quién decide») que
estas reglas ya no están solo escritas, sino negadas en los permisos.

## Carril

Normal (`ligera: no`) y con la exclusión `seguridad`: cambia los permisos de los agentes. Va sola en
su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: se cumple (solo configuración y un test).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: se cumple.
4. No hay ninguna decisión que preguntar a Dani: se cumple (Dani dijo que sí); pero la exclusión
   `seguridad` basta para el carril normal.

## Criterios de aceptación

- CA1: un test unitario con «CA1 (0082)» en el nombre lee `.claude/settings.json` y comprueba que
  `permissions.deny` tiene, en Bash y en PowerShell, las reglas de `gh pr merge` con `--squash`,
  `-s`, `--rebase`, `-r`, `--delete-branch` y `-d`, y la de `git push * :*`.
- CA2: el mismo test comprueba que ninguna regla de `deny` es un prefijo que niegue
  `gh pr merge 12 --merge`, `gh pr create …`, `git push origin integra/20261011-1` ni
  `git push origin HEAD:integra/20261011-1` (los dos puntos sin espacio delante no borran nada) (con un
  comparador sencillo de comodines `*` sobre esos textos; no pretende imitar al de Claude Code).
- CA3: las reglas que ya había en `deny` y en `allow` siguen todas (el test de la 0004 sobre
  `notify-telegram` sigue en verde).

Decisiones de Dani (2026-10-11, `[ALCANCE]` del reviewer):

- CA1 cambia: la regla `git push * :*` se quita de `settings.json` (con `:*` al final, Claude Code la lee como prefijo y su efecto no está documentado). El borrado de ramas remotas lo bloquea el hook `.githooks/pre-push`: un borrado llega con el SHA local a ceros, así que cubre `:rama`, `--delete` y `-d` en cualquier posición. Criterio nuevo, CA4: un test con «CA4 (0082)» en el nombre comprueba que el pre-push sale con error y un mensaje claro cuando git le pasa un borrado (SHA local a ceros), y que deja pasar un push normal y uno a `HEAD:integra/…`. Desde ese momento, borrar una rama remota con git queda bloqueado para todos; se hace desde GitHub.
- Las reglas de permisos casan con el texto del comando: llamado por su ruta completa (`C:Program FilesGitHub CLIgh.exe`), `gh pr merge … --squash` no lo niega ninguna regla (lo dice la documentación: no son una barrera de seguridad). Un hook `PreToolUse` que lo bloquee se queda para una ficha propia del Planificador.

## Pruebas a mano para Dani

- Tras fusionar la PR, en una sesión nueva de Claude Code (los permisos se leen al arrancar), pedir
  `gh pr merge 999 --squash` y comprobar que lo niega sin preguntar; y que `gh pr view` sigue
  funcionando. No hace falta que exista la PR 999. (La prueba que se hizo antes de fusionar no
  cuenta: se repite.) **Hecho por Dani el 2026-10-11**, en una sesión nueva en el checkout principal: Claude Code niega `gh pr merge 999 --squash` antes de ejecutarlo.
- Con el pre-push instalado (`core.hooksPath .githooks`), `git push origin :rama-que-no-existe`
  tiene que rechazarlo el pre-push con un mensaje en español, sin llegar a GitHub. **No se pudo hacer a mano** (2026-10-11): no queda ninguna rama remota y, con una que no existe, git corta antes de llamar al hook; queda cubierta por el CA4 de la 0082 (git real, cinco formas de borrado).

## Fuera de alcance

- Distinguir por comando la PR de una ficha sola de una agrupada: no se puede con reglas de texto;
  sigue siendo una regla escrita (`docs/flujo.md`).
- Otras vías de borrar ramas (`gh api -X DELETE …`): si el reviewer las ve fáciles de negar, se
  anotan en «Ideas surgidas».

## Ideas surgidas (fuera de alcance)

- (developer) El force push con refspec `+` (`git push origin +rama`, `git push origin +HEAD:main`) no lo niega ninguna regla de `deny` (hueco de antes de esta ficha), ni las opciones cortas juntas (`-fu`). El pre-push podría rechazarlo también: un push que no es avance rápido llega con un SHA remoto que no es antecesor del local (`git merge-base --is-ancestor`).
- (developer) `gh api -X DELETE repos/…/git/refs/heads/<rama>` borra una rama remota sin pasar por el pre-push; se podría negar en `deny` (`gh api * DELETE*`), con el mismo límite de que las reglas casan con el texto.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Seguridad / sintaxis de Claude Code] `.claude/settings.json:60` y `:92`: `git push * :*` termina en `:*`, que en Claude Code es la forma antigua de prefijo (documentación de permisos: «The `:*` suffix is an equivalent way to write a trailing wildcard… only recognized at the end of a pattern»). Cómo combina el `*` del medio no está documentado: o no casa nunca (y `git push origin :rama` no queda negado) o niega cualquier `git push` con dos argumentos (y para el flujo). `[ALCANCE]`, porque CA1 exige esa regla literal.
2. [Documentación del cierre] Las reglas de `git push` no niegan todas las formas de borrar una rama remota (`git push --delete origin rama`, `git push -d …`, `git push origin -d rama`) ni el force push con `git push origin +rama` (huecos de antes de esta ficha). `docs/flujo.md` debe decir solo lo que de verdad queda negado.

Bien: CA1 (salvo el punto 1), CA2 y CA3 con sus tests; 3e40c7f solo añade casos negados. El diff de `settings.json` solo añade a `deny`; las reglas de `gh pr merge` cubren `--squash`, `--rebase` y `--delete-branch` (también con `=…`) delante o detrás del número y sin número, en Bash y PowerShell; las cortas no casan con `--subject` ni con `gh pr view -d`. Sin datos del tenant ni secretos.

Opcional: opciones cortas juntas (`-sd`, `-md`) y `-s=true` no se niegan; `* -s *` podría negar una fusión con `-s` en el texto de `--subject` (lado seguro); en CA2, `gh pr merge --merge` sin número y `git merge --squash <rama>`.

### Ronda 2: APROBADO

- Decisiones de Dani: `git push * :*` fuera de `.claude/settings.json` (Bash y PowerShell); el diff frente a `main` solo añade a `deny` las reglas de `gh pr merge` y no quita nada (CA3). El nuevo CA1 es el que decidió Dani.
- `.githooks/pre-push`: lee la entrada una vez (`input=$(cat)`), rechaza toda línea con el SHA local a ceros antes del escáner, con mensajes en español, y pasa la misma entrada a `scan-tenant.mjs --pre-push`. Varias líneas bien (el `while read` lee de un heredoc, en bash y en dash); entrada vacía bien; patrón POSIX; modo 100755.
- CA4 (`scripts/pre-push.test.ts`) con git real y un `.env` falso: las cinco formas de borrado fallan y la rama sigue; pasan `main` y `HEAD:integra/…`; una fuga sigue parando el push sin mostrar el valor. Tests sin tocar desde d7bce69.
- `docs/flujo.md`, «Qué queda bloqueado, y cómo»: separa pre-push y reglas `deny`, y avisa de que las reglas comparan el texto del comando. Sin secretos ni datos del tenant.
- Opcional: en «Verificación», los commits de tests son `a3ef475` y `d7bce69` tras el rebase; matizar en `docs/flujo.md` que el hook actúa con `core.hooksPath .githooks` y que `--no-verify` se lo salta (a los agentes se lo niega `deny`, también por texto); la línea 126 de `docs/flujo.md` pasa de 100 columnas.

## Verificación

Tests escritos en el commit `a3ef475` (`scripts/claude-permissions.test.ts`, comparador sencillo de
comodines):

- CA1: `describe` «CA1 (0082): …», en Bash y en PowerShell: niega `gh pr merge 12 <opción>`,
  `… <opción> --admin` y `… --merge <opción>` con `--squash`, `-s`, `--rebase`, `-r`,
  `--delete-branch` y `-d`; niega `git push origin :rama`; y `deny` tiene la regla `git push * :*`.
- CA2: `describe` «CA2 (0082): …»: ninguna regla de `deny` niega `gh pr merge 12 --merge`,
  `gh pr create …`, `git push origin integra/20261011-1`, `git push -u origin …`,
  `git push origin HEAD:integra/20261011-1` ni `git push origin main`.
- CA3: `describe` «CA3 (0082): …»: `allow` y `deny` conservan todas las reglas de antes; y el test
  CA11 (0004) de `scripts/notify-telegram.test.ts` sigue en verde.

Ejecución con los tests recién escritos: 42 fallan (los de CA1, porque las reglas aún no están) y
pasan los de CA2, CA3 y `notify-telegram.test.ts`.

Tests de las decisiones de Dani en el commit `d7bce69`:

- CA1 (cambia): en `scripts/claude-permissions.test.ts`, «CA1 (0082): Bash/PowerShell no tiene la
  regla «git push * :*»» (antes exigía que estuviera); se quitan los casos `git push origin :rama`
  de lo que tiene que negar `deny`.
- CA4: `scripts/pre-push.test.ts`, `describe` «CA4 (0082): …», con git de verdad (repositorio y
  remoto desnudo temporales, el hook y `scan-tenant.mjs` copiados, `.env.live.local` falso):
  `git push` con `origin :rama`, `origin --delete rama`, `--delete origin rama`, `origin -d rama`
  y `-d origin rama` sale con error, la salida nombra el pre-push y dice «borr…», y la rama sigue en
  el remoto; un push a `main` y uno a `HEAD:integra/20261011-1` pasan (con scan:tenant en la
  salida); y con una fuga el push sigue parado (0055).

Ejecución: fallan 7 (los dos de CA1, porque la regla sigue, y los cinco de borrado de CA4, porque el
hook los deja pasar); pasan los de push normal, `HEAD:integra/…` y fuga, y los de
`scan-tenant.test.ts` y `notify-telegram.test.ts`.

Verificación 2026-10-11, commit 12180c4, rango `main..chore/0082-permisos-claude-fusiones`: **VERDE**.

- `npm run check`: 221 ficheros, 3965 tests; cobertura: sentencias 92,74 %, ramas 90,06 %, funciones 89,83 %, líneas 93,51 %. `scripts/pre-push.test.ts`, `scripts/claude-permissions.test.ts` y `scripts/scan-tenant.test.ts` entran en el check; aparte, 140 de 140.
- `npm run test:e2e:affected`: «solo docs o tests unitarios; no hace falta ningún e2e».

## Resultado

(developer) 38 reglas nuevas en `deny` (19 por shell). Las largas, `gh pr merge --squash*` y `gh pr merge * --squash*` (igual con `--rebase` y `--delete-branch`): cubren la opción delante o detrás del número y sin número. Las cortas, al estilo de las de `-f`, con cuatro formas (`gh pr merge -s`, `-s *`, `* -s`, `* -s *`), para que `-s*` no case con otras opciones que empiecen igual. Y `git push * :*`. Casos nuevos en el test (commit propio, pedidos por el Orquestador): la opción delante del número, sin número y `--merge <opción> 12`. Lo de `docs/flujo.md` y la línea del BACKLOG queda para el cierre (doc-writer).

(developer, ronda 2) Decisiones de Dani: se quita `git push * :*` de `settings.json` (Bash y PowerShell). `.githooks/pre-push` guarda la entrada estándar, rechaza con mensaje en español toda línea con el SHA local a ceros (cualquier borrado remoto, también de tags) antes de `scan:tenant` y le pasa la misma entrada al escáner. `docs/flujo.md` («Quién decide» y «Git», nuevo punto «Qué queda bloqueado, y cómo»): solo lo que de verdad queda bloqueado y que las reglas casan con el texto del comando. Los huecos de `+rama` y `gh api -X DELETE`, a «Ideas surgidas».

(doc-writer) Commits de la rama (`main..chore/0082-permisos-claude-fusiones`): tests (`a3ef475`, `90e85f7`, `d7bce69`), reglas de `gh pr merge` (`5c5416c`), pre-push que rechaza borrados (`bc8b378`), `docs/flujo.md` (`0c949eb`) y fichas. Ficheros principales: `.claude/settings.json`, `.githooks/pre-push`, `scripts/claude-permissions.test.ts`, `scripts/pre-push.test.ts` y `docs/flujo.md`. Revisión: 2 rondas (CAMBIOS con `[ALCANCE]` resuelto por Dani, APROBADO). Sin ADR nuevo ni migraciones. Va sola en su PR y la fusiona Dani.
