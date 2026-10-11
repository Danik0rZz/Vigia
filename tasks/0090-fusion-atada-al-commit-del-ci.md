---
id: '0090'
titulo: 'La fusión de una PR va atada al commit que pasó «CI ok», y fuera el `[skip ci]` del ADR-0013'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
