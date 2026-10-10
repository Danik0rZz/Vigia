---
id: '0072'
titulo: 'CI en las PR a main con el e2e completo y un check «CI ok» que se ejecuta siempre'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0072-ci-en-pull-request
adrs: [7, 13] # ADR que aplican, por número
adr_nuevo: 'ADR-0014: integración por pull request (CI en la PR, check «CI ok» siempre presente, un commit por ficha y ramas de integración)' # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, A, «Git y CI» (aprobada por Dani el 2026-10-10): «push a la rama sin CI, con el
CI solo en PR a `main` agrupando 3 a 5 fichas (…) y el e2e completo siempre en el CI de cada PR»,
«`dist:win` solo al fusionar en `main` o al cerrar versión», y «antes de proteger `main`, un job
mínimo que se ejecute siempre (sin `paths-ignore`) como único check obligatorio (…) probado antes
de activar la protección».

## Especificación

Primera de dos fichas de git y CI. Esta prepara el CI para las PR **sin cambiar todavía cómo se
integra**: el push a `main` sigue lanzando el CI de hoy. La 0073 cambia el flujo (ramas de
integración, PR y un commit por ficha) y recorta el CI del push a `main`.

**Disparadores de `ci.yml`:**

- `pull_request` a `main`, **sin `paths-ignore`**: así el workflow arranca en todas las PR, también
  en las que solo traen documentos.
- `push` a `main`: como hoy (con su `paths-ignore`), hasta la 0073.
- `workflow_dispatch`: como hoy.

**Jobs en las PR:**

1. `cambios` (en `ubuntu-latest`, que arranca antes; solo hace `git diff`): decide si la PR trae
   algo más que documentos con un script del repositorio, `scripts/ci-changes.mjs`, cuya función
   pura recibe la lista de ficheros y devuelve `codigo: true | false`. La lista de lo que no cuenta
   es la de hoy en `paths-ignore` (`**/*.md`, `docs/**`, `tasks/**`, `.claude/**`) y vive en un solo
   sitio (el script o un JSON que lean el script y su test; el workflow no la repite). Sin acciones de
   terceros (nada de `paths-filter`): sería una dependencia más.
2. `windows`: el de hoy (`npm ci`, audit, caché de Electron, `check`, **e2e completo**, artefactos de
   los e2e fallidos) **sin `dist:win`**, solo si `cambios` dice `codigo: true`.
3. `ci-ok` (nombre visible **«CI ok»**): `if: always()`, `needs: [cambios, windows]`. Da verde si
   `cambios` acabó bien y `windows` acabó bien o se saltó porque no había código; da rojo si alguno
   falló o se canceló. Es **el único check que exigirá la protección de `main`** (la activa Dani,
   después). Así una PR solo de `docs/` o `tasks/` no se queda «pendiente» para siempre.

**En el push a `main`** (hasta la 0073) el job `windows` hace lo de hoy, `dist:win` incluido. Las
condiciones de cada paso se escriben para que el mismo job sirva a los dos eventos.

**Concurrencia:** en las PR, un push nuevo a la misma PR cancela el run anterior de esa PR (solo
cuenta el último); en `main`, los runs se encolan como hoy (ficha 0056). Grupo por PR o por rama.

**Permisos:** `contents: read`, como hoy; los checkout siguen fijados por SHA (ficha 0056) y la
tabla `PINNED` de `scripts/ci-workflow.test.ts` no cambia salvo que se añada una acción.

**Comprobación en GitHub (la hace el Orquestador al integrar, con `gh` ya configurado por Dani con su token
(0073, punto 5; la regla de push ya está decidida). Si aún no lo está, queda para la 0073):** dos PR de prueba contra `main` desde ramas de prueba, una
solo con un `.md` y otra con un cambio de código inocuo. En la primera, «CI ok» en verde sin e2e; en
la segunda, «CI ok» espera al e2e completo y da su resultado. Se cierran sin fusionar. El resultado
(enlaces y tiempos) va en «Verificación». **La protección de `main` no se activa en esta ficha.**

**Documentación:** el comentario de cabecera de `ci.yml`; el doc-writer escribe el ADR-0014 con lo
que Dani decida en la 0073 (si aún no lo ha decidido, deja el ADR en «propuesto»).

## Carril

Normal (`ligera: no`). Toca un servicio externo (GitHub Actions), ya no entra.

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade `ci-changes.mjs` y dos
   jobs.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia la lógica del CI.
4. No hay ninguna decisión que preguntar a Dani: **no se cumple** para la comprobación en GitHub,
   que necesita publicar ramas de prueba (la regla de push la decide Dani, ver la 0073).

## Criterios de aceptación

- CA1: la función de `ci-changes.mjs` da `codigo: false` con solo `.md`, `docs/`, `tasks/` o
  `.claude/`, y `true` en cuanto hay otro fichero (también un `.md` más un `.ts`, o una lista vacía
  tratada como «sin código»), y lee la lista de un solo sitio.
- CA2 (`scripts/ci-workflow.test.ts`): `pull_request` a `main` no tiene `paths-ignore`; `push` a
  `main` lo conserva.
- CA3: `windows` depende de `cambios` y se salta sin código; en `pull_request` no ejecuta
  `dist:win` y sí `check` y `npm run test:e2e` (completo, sin afectados).
- CA4: `ci-ok` tiene `if: always()`, necesita a todos los demás jobs y su paso falla si alguno
  terminó en `failure` o `cancelled` (comprobado sobre el texto del paso o, mejor, con la lógica en
  el script y probada con resultados de ejemplo: `success`/`skipped` → verde; `failure`/`cancelled`
  → rojo).
- CA5: concurrencia: en `pull_request` con `cancel-in-progress` activo; en `push` a `main`, sin
  cancelar.

## Pruebas a mano para Dani

- Antes de activar la protección de `main`, ver las dos PR de prueba: «CI ok» verde en la de solo
  documentos, y esperando y luego verde en la de código. Después, activar la protección con
  «CI ok» como único check obligatorio (ver la 0073).

## Fuera de alcance

- Ramas de integración, PR agrupadas, un commit por ficha y recortar el CI del push a `main` (0073).
- Activar la protección de `main` (lo hace Dani).
- Medir el CI (0074).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios CA1–CA5 con su `describe` numerado en `scripts/ci-changes.test.ts` y `scripts/ci-workflow.test.ts`, sin cambios desde el commit de tests (275846b); fallarían sin el código. El cambio del test de la 0056 («nunca es true sin condición») es correcto: el CA5 de la 0072 sustituye al de la 0056 y fija la expresión exacta. `scripts/ci-changes.main.test.ts` (del developer) cubre git y `GITHUB_OUTPUT`. La lista de no-código vive solo en `NON_CODE_PATTERNS`.
- Diseño en GitHub Actions: en `pull_request` el checkout es el commit de fusión; con `fetch-depth: 2`, `HEAD^1` es `main`. `windows` con `needs.cambios.outputs.codigo == 'true'` se salta si `cambios` falla. «CI ok» con `always()` da rojo con `failure` o `cancelled` y verde con `success` + `skipped`. Push y `workflow_dispatch`: `codigo=true` y `dist:win` se ejecuta. Concurrencia: cancela en PR, encola en `main`.
- Reglas: `contents: read`, acciones con los SHA de `PINNED`, sin dependencias, secretos ni datos del tenant.
- Opcional (no bloquea): fijar `== 'true'` en el test de CA3; llevar la lógica de CA4 al script; un run cancelado por otro push ejecuta «CI ok» en rojo sobre el SHA antiguo (no afecta a la PR; `!cancelled()` lo evitaría, pero la ficha pide `always()`); ADR-0014 para el doc-writer.

## Verificación

Tests (commit 275846b), que fallan hasta implementar:

- CA1: `scripts/ci-changes.test.ts`, «CA1 (0072): classifyChanges decide si una PR trae código». Contrato fijado: `classifyChanges(files) → { codigo }` y `NON_CODE_PATTERNS` exportada; el `paths-ignore` del push tiene que coincidir con ella y `ci.yml` no repite los globs en otro sitio.
- CA2: `scripts/ci-workflow.test.ts`, «CA2 (0072): pull_request a main sin paths-ignore; push a main lo conserva».
- CA3: `scripts/ci-workflow.test.ts`, «CA3 (0072): windows depende de cambios y en las PR no empaqueta» (el `if` de `dist:win` usa `github.event_name != 'pull_request'` o `== 'push'`).
- CA4: `scripts/ci-workflow.test.ts`, «CA4 (0072): ci-ok («CI ok») siempre se ejecuta y falla si algún job falló» (sobre el texto de sus pasos: `needs`, `failure` y `cancelled`).
- CA5: `scripts/ci-workflow.test.ts`, «CA5 (0072): concurrencia que cancela en las PR y encola en main». El test de la 0056 «cancel-in-progress es false» pasa a «nunca es true sin condición».

Comprobación en GitHub: (pendiente)

Verificación 2026-10-11, commit 3f1ba3a, rango `main..feat/0072-ci-en-pull-request`: **VERDE**.

- `npm run check`: 3575 tests (204 ficheros); cobertura: líneas 93,43 %, ramas 89,98 %, funciones 89,84 %, sentencias 92,68 %.
- `npm run test:e2e:affected -- main..feat/0072-ci-en-pull-request`: «solo docs o tests unitarios; no hace falta ningún e2e» (cero e2e).
- Comprobación en GitHub (dos PR de prueba): la hace el Orquestador tras integrar.

## Resultado

(pendiente)
