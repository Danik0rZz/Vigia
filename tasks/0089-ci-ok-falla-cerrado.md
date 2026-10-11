---
id: '0089'
titulo: '«CI ok» falla cerrado: si no se sabe si la PR trae código, se prueba'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
