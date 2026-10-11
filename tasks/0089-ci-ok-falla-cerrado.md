---
id: '0089'
titulo: '«CI ok» falla cerrado: si no se sabe si la PR trae código, se prueba'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0089-ci-ok-falla-cerrado
adrs: [13, 14] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la T-02.

## Especificación

**Hoy.** En `.github/workflows/ci.yml`, el job `windows` corre con
`if: needs.cambios.outputs.codigo == 'true'`, y `ci-ok` solo se pone en rojo si algún job acabó en
`failure` o `cancelled`. Si la salida `codigo` llega vacía (un `id` que cambia, un `outputs` mal
mapeado, `scripts/ci-changes.mjs` sin `GITHUB_OUTPUT`), `windows` se salta (`skipped`) y «CI ok» sale
en verde sin haber probado nada. `scripts/ci-changes.main.test.ts` fija hoy que sin `GITHUB_OUTPUT`
no escribe nada.

**Qué se hace.**

1. `windows`: `if: needs.cambios.outputs.codigo != 'false'` (lo desconocido se prueba).
2. `ci-ok`: además de lo de hoy, rojo si `codigo` no es `'false'` y `windows` no acabó en `success`.
   El `echo` final imprime también `codigo`.
3. `scripts/ci-changes.mjs`: con `GITHUB_ACTIONS` definido y sin `GITHUB_OUTPUT`, falla con un mensaje
   claro (fuera del CI, como hoy).
4. Lo de hoy no cambia: una PR solo de documentos (`codigo` = `'false'`) salta `windows` y «CI ok» sale
   en verde.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (el check que exige la protección de `main`): va
sola en su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: se cumple.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia la lógica del CI.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: en `scripts/ci-workflow.test.ts`, el `if` de `windows` no es una igualdad con `'true'` y
  trata como «hay código» todo lo que no sea `'false'`. Test con «CA1 (0089)».
- CA2: en `scripts/ci-workflow.test.ts`, la condición de rojo de `ci-ok` nombra `codigo` y exige
  `success` de `windows` cuando `codigo` no es `'false'`. Test con «CA2 (0089)».
- CA3: `ci-changes.mjs` con `GITHUB_ACTIONS=true` y sin `GITHUB_OUTPUT` falla (código distinto de 0);
  sin `GITHUB_ACTIONS`, como hoy. Test con «CA3 (0089)» en `scripts/ci-changes.main.test.ts`.
- CA4: el CI de la PR de esta ficha (que trae código) pasa por `windows` y «CI ok» sale en verde.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Atar la fusión al commit que pasó el CI (ficha 0090).
- La configuración de la protección de `main`: la decide Dani.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1–CA3 con su test numerado (`scripts/ci-workflow.test.ts`, `scripts/ci-changes.main.test.ts`), fallarían sin el código y no se tocaron tras 3416211. El test de CA3 quita las `GITHUB_*` del entorno; los de `main` de antes siguen valiendo. CA4, en el CI de la PR.
- Falla cerrado (`ci.yml:66` y `:142-144`): con `codigo` vacío o ausente, `!= 'false'` es verdadero, `windows` corre y «CI ok» solo sale en verde con `success`. Si `cambios` falla o se cancela, `windows` se salta y «CI ok» queda en rojo. Si `windows` se salta por otra razón con `codigo` distinto de `'false'`, rojo por el paso nuevo. PR solo de documentos (`'false'`): verde sin e2e, como en la 0072. El script, si falla en el CI, sale con 1 y `cambios` acaba en `failure`.
- Push a main y `workflow_dispatch` igual; concurrencia, `permissions: contents: read`, SHA fijados y `PINNED` sin tocar. Sin secretos ni datos del tenant.
- Opcional (doc-writer): `docs/adr/0014-integracion-por-pull-request.md:18` dice que «CI ok» da verde si `windows` «acabó bien o se saltó»; desde esta ficha, solo con `codigo` = `'false'` (nota en el ADR o en `docs/flujo.md:443`). GitHub compara sin mayúsculas (`'False'` también saltaría), sin riesgo real.

## Verificación

Tests: commit 3416211 (test-writer, 2026-10-11).

- CA1: `scripts/ci-workflow.test.ts`, «CA1 (0089): windows se ejecuta salvo que codigo sea exactamente false» (no es `== 'true'` y es `!= 'false'`).
- CA2: `scripts/ci-workflow.test.ts`, «CA2 (0089): ci-ok exige success de windows cuando codigo no es false» (paso con `exit 1` cuyo `if` une con `&&` `codigo != 'false'` y `windows.result != 'success'`; sigue el rojo por failure y cancelled; el `echo` imprime `codigo`).
- CA3: `scripts/ci-changes.main.test.ts`, «CA3 (0089): sin GITHUB_OUTPUT falla dentro del CI y fuera no» (lanza el script con `spawnSync`, evento push y sin variables GITHUB_ del entorno: con `GITHUB_ACTIONS=true` sale distinto de 0 y nombra GITHUB_OUTPUT en stderr; sin ella, 0).
- CA4: sin test local; se comprueba en el CI de la PR (verifier).

Código: commit 65ec371 (developer, 2026-10-11). Decisiones: `main` lanza el error y el arranque del
script lo escribe en stderr con `process.exitCode = 1` (sin traza); en `ci-ok`, la condición nueva va
en un paso propio («Hay código y windows no acabó bien»); si `cambios` falla, el `success()` implícito
salta `windows` y el rojo llega por `failure`, como hoy.

Verificación 2026-10-11, commit 7818704, rango `main..fix/0089-ci-ok-falla-cerrado`: **VERDE**.

- `npm run check`: 221 ficheros, 3985 tests; cobertura: sentencias 92,74 %, ramas 90,06 %, funciones 89,83 %, líneas 93,51 %.
- `npm run test:e2e:affected`: cero e2e (solo docs, tests unitarios y CI).
- CA4: se comprueba en el CI de la PR (pendiente: lo anota el Orquestador al abrirla).

## Resultado

- Commits: 3416211 (tests), 65ec371 (código), más los de ficha y el de cierre.
- Ficheros principales: `.github/workflows/ci.yml`, `scripts/ci-changes.mjs`, `scripts/ci-workflow.test.ts`, `scripts/ci-changes.main.test.ts`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno; nota añadida en el ADR-0014 y en `docs/flujo.md`.
- CA4: pendiente: lo anota el Orquestador al abrir la PR.
- Sin migraciones.
