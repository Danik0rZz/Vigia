---
id: '0082'
titulo: 'Permisos de Claude: negar las fusiones por squash o rebase, el borrado de ramas al fusionar y el push que borra una rama remota'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

## Pruebas a mano para Dani

- En una sesión nueva de Claude Code (los permisos se leen al arrancar), pedir
  `gh pr merge 999 --squash` y comprobar que lo niega sin preguntar; y que `gh pr view` sigue
  funcionando. No hace falta que exista la PR 999.

## Fuera de alcance

- Distinguir por comando la PR de una ficha sola de una agrupada: no se puede con reglas de texto;
  sigue siendo una regla escrita (`docs/flujo.md`).
- Otras vías de borrar ramas (`gh api -X DELETE …`): si el reviewer las ve fáciles de negar, se
  anotan en «Ideas surgidas».

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
