---
id: '0073'
titulo: 'Integración por PR: un commit por ficha, ramas de integración, PR de 3 a 5 fichas y dist:win solo en main'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0072'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0073-integracion-por-pr
adrs: [7, 10, 13] # ADR que aplican, por número
adr_nuevo: 'ADR-0014 (lo abre la 0072): se completa con las decisiones de Dani de esta ficha' # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, A, «Git y CI» (aprobada por Dani el 2026-10-10): «un commit por ficha (agrupado
al fusionar); push a la rama sin CI, con el CI solo en PR a `main` agrupando 3 a 5 fichas (las del
carril normal, en su propia PR) (…); `dist:win` solo al fusionar en `main` o al cerrar versión».
«Cambiar la regla de push (hoy, solo `git push origin main`) y cómo se borran las ramas remotas lo
decide Dani.»

## Especificación

**Decisiones de Dani (2026-10-10, al aprobar el lote):**

1. **Regla de push.** Los agentes pueden, además de lo de hoy, `git push origin integra/<nombre>`
   (solo ramas con ese prefijo, nunca `--force` ni `--force-with-lease`), abrir PR a `main` y
   fusionar las PR agrupadas cuando «CI ok» esté en verde, el reviewer en APROBADO y el verifier en
   verde en cada ficha. Las PR de una ficha sola (punto 6) las fusiona Dani. Cuando la protección esté
   activa, `git push origin main` deja de usarse.
2. **Cómo se fusiona la PR: «Create a merge commit».** Así `main` conserva un commit por ficha (más
   el de la fusión) con los mismos SHA de la rama. Con «Rebase and merge», GitHub reescribe los
   commits, y una rama de integración que ya va por delante habría que subirla con force push, que
   está prohibido. Con «Squash» se pierde el «uno por ficha».
3. **Ramas remotas:** Dani activa en GitHub «Automatically delete head branches» y GitHub borra la
   rama al fusionar. Los agentes no borran ramas remotas.
4. **Protección de `main`** (la activa Dani, después de ver las PR de prueba de la 0072): «CI ok»
   como único check obligatorio, sin exigir que la rama esté al día con `main` (la PR ya se prueba
   sobre el resultado de fusionarla) y **sin excepción para administradores**.
5. **GitHub CLI con un token propio, no con la cuenta de Dani.** Dani instala `gh`, crea un token
   _fine-grained_ solo para este repositorio (Contents y Pull requests de lectura y escritura, sin
   administración) y lo configura con `gh auth login --with-token`. Los agentes nunca ven, escriben
   ni guardan el token. Si `gh pr checks` o `gh run view` no pueden leer el estado del CI con esos
   permisos, el Orquestador lo dice y Dani decide si añade un permiso de solo lectura; no se amplía
   por su cuenta.
6. **Qué va solo en su PR:** solo la ficha que toque alguna de las exclusiones del carril rápido
   (canales IPC, la API de Dynatrace, dependencias, el esquema de la base de datos, la seguridad o
   servicios externos). Esa PR **la fusiona Dani**. Todas las demás, rápidas o normales, se agrupan
   de 3 a 5.
7. **El push a `main` mantiene `npm run check`** además de `dist:win`, para detectar combinaciones de
   PR que no se probaron juntas.

**Lo que se construye (con esas decisiones):**

- **Un commit por ficha.** Al integrar, el Orquestador fusiona la rama de la ficha en la rama de
  integración con `git merge --squash` y un mensaje con el formato de siempre
  (`feat(zona): título (#NNNN)`, `fix(…)` si la rama es `fix/`). Un script,
  `scripts/integrate.mjs`, hace la parte comprobable: lee la ficha, compone el mensaje y se niega si
  la ficha no está `verificada` o si el árbol no está limpio. El mensaje y las comprobaciones son
  funciones puras con sus tests. Los commits de documentación del cierre de la ficha van en ese
  mismo commit (el doc-writer trabaja antes de integrar, como hoy).
- **Ramas de integración** `integra/AAAAMMDD-N`, creadas desde `main` (o desde la rama de integración
  anterior si su PR aún no se ha fusionado), que se publican con `git push origin integra/…`. El push
  no lanza el CI (solo lo lanzan las PR y `main`, 0072).
- **Exclusiones en la ficha.** La plantilla (`tasks/_PLANTILLA.md`) gana un campo `exclusiones`:
  lista con las que toca la ficha, de `ipc`, `api`, `dependencias`, `esquema`, `seguridad` y
  `externos` (vacía si ninguna). La rellena el Planificador desde esta ficha (se actualiza
  `.claude/agents/planner.md`). Una ficha sin el campo (las anteriores) cuenta como que sí toca
  alguna: va sola, que es lo seguro.
- **Agrupar:** una ficha con alguna exclusión va sola en su PR. Las demás, rápidas o normales, se
  juntan en el orden de la cola, de 3 a 5. La PR se abre al llegar a 5, al llegar a 3 si no quedan
  más agrupables en la cola, o al acabar la cola con las que haya. Una ficha sola que aparece en
  medio no corta el grupo en curso. La regla es una función pura (`groupForPrs(fichas)`) con sus
  tests, que el Orquestador usa para decidir; no abre PR por sí sola.
- **PR agrupada:** el Orquestador la abre con `gh pr create` (título con las fichas, cuerpo con la
  lista de fichas y sus enlaces, sin nada del tenant), **no espera** al CI (ADR-0013), la sondea en
  segundo plano y la fusiona con `gh pr merge --merge` cuando «CI ok» está en verde.
- **PR de una ficha sola:** la rama sale de `main`, no de una rama de integración pendiente. El
  Orquestador la abre, **no la fusiona** y avisa a Dani por Telegram (`parada`, con el enlace de la
  PR y el estado de «CI ok»). La cola sigue con las fichas que no dependan de ella; las que dependen
  quedan `en_espera` hasta que Dani la fusione.
- **Si el CI de una PR falla,** se aplica la regla de «si falla el CI, se para la cola» (ADR-0013),
  con la PR como run.
- **Documentos sin código** (la ficha aprobada del Planificador, la medición del CI que llega
  después): van en la rama de integración en curso; si no hay ninguna, en una PR solo de
  documentos, que «CI ok» deja pasar en segundos.
- **CI del push a `main`:** `npm run check` y `dist:win`, sin e2e (el e2e completo ya pasó en cada
  PR). El `check` es para cazar dos PR que pasaron cada una por su lado y fallan juntas. Si falla, se
  aplica la regla de «si falla el CI, se para la cola». Al cerrar versión, `dist:win` se lanza en
  local como hoy y, si Dani quiere, con `workflow_dispatch`.
- **Documentación:** `docs/flujo.md` («Git», «El CI, sin esperarlo», «Quién decide» con la regla de
  push nueva), `CLAUDE.md` raíz («Reglas que no se saltan» y «Flujo, en corto»),
  `.claude/commands/tarea.md`, `.claude/commands/cerrar-version.md` y los agentes de `.claude/agents/`
  que hablen de push, merge o del commit de la ficha aprobada (también el del Planificador). El
  doc-writer completa el ADR-0014.

**Orden de puesta en marcha:** (1) se integra esta ficha por el flujo de hoy; (2) Dani instala `gh`
con su token (punto 5) y activa el borrado automático de ramas (punto 3); (3) Dani activa la
protección (punto 4); (4) desde la ficha siguiente, todo va por PR.

## Carril

Normal (`ligera: no`). Toca un servicio externo (GitHub) y la seguridad del repositorio.

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade `integrate.mjs` y
   `groupForPrs`.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia la lógica de integración y del CI.
4. No hay ninguna decisión que preguntar a Dani: **no se cumplía**; hacían falta siete decisiones, ya
   tomadas (arriba).

## Criterios de aceptación

- CA1: el mensaje del commit de una ficha sale de su front matter (`feat(…)` o `fix(…)` según la
  rama, título y `(#NNNN)`), y `integrate.mjs` se niega con una ficha que no está `verificada`, con el
  árbol sucio o con una rama que no es la de la ficha.
- CA2: `groupForPrs`: una ficha con alguna exclusión va sola y marcada «la fusiona Dani», y también
  una sin el campo `exclusiones`; tres sin exclusiones (rápidas, normales o mezcladas) forman una PR;
  seis sin exclusiones, una de 5 y otra de 1 si la cola acaba ahí; una ficha sola en medio no corta
  el grupo en curso; el orden de la cola se respeta dentro de cada grupo.
- CA3 (`scripts/ci-workflow.test.ts`): en el push a `main` se ejecutan `npm run check` y `dist:win`,
  sin e2e; en `pull_request`, `check` y e2e completo sin `dist:win`; `ci-ok` sigue como en la 0072.
- CA4: `tasks/_PLANTILLA.md` tiene el campo `exclusiones` con sus seis valores posibles, y
  `groupForPrs` rechaza un valor que no esté en esa lista.
- CA5: ningún documento de `.claude/` ni `docs/flujo.md` sigue diciendo que el push a `main` es la
  única forma de integrar ni que el CI lo lanza cada ficha (test de texto sobre esos ficheros, como
  los de la 0021).

## Pruebas a mano para Dani

- Instalar `gh`, crear el token fine-grained del repositorio (Contents y Pull requests de lectura y
  escritura, sin administración) y configurarlo con `gh auth login --with-token`.
- Activar «Automatically delete head branches».
- Activar la protección de `main` (punto 4) y ver que la primera PR del flujo nuevo se fusiona con
  «CI ok» en verde.

## Fuera de alcance

- Paralelismo (parte C).
- Releases, tags y publicar el zip (siguen siendo de Dani).
- Medición automática del CI (0074).

## Ideas surgidas (fuera de alcance)

- (developer) Negar en `.claude/settings.json` `gh pr merge * --squash`, `--rebase` y
  `--delete-branch`, y `git push origin :<rama>`, como ya se niegan el force push y los tags. No lo
  toco: es configuración de permisos.
- (developer) `docs/ARCHITECTURE.md` (línea de `scripts/`) no nombra `integrate.mjs`: lo deja el
  doc-writer.

## Notas del revisor

### Ronda 1: CAMBIOS

Bien: CA1–CA5 con su test (256d5e4), sin tocar tras el commit de tests; `ci.yml` con check y `dist:win` en el push a main y el e2e solo en las PR; solo `gh pr merge --merge` para fusionar (`--squash` solo dentro de `integra/…`); reglas de seguridad intactas; ningún documento deja al Orquestador proteger main ni borrar ramas remotas. El nuevo significado de `hecha` está dentro del alcance y es coherente.

1. [Seguridad] `scripts/integrate.mjs`, `groupForPrs`: `exclusiones:` vacío da `''` y la ficha se agrupa como si no tuviera exclusiones; un escalar (`exclusiones: ipc`) se recorre letra a letra. Si no es `undefined` ni array: error claro o «va sola». Test en `integrate.main.test.ts`.
2. [Flujo] La ficha aprobada del Planificador «en `main` local, sin push» (`planner.md`) choca con el `merge --ff-only origin/main` de `flujo.md`, `tarea.md` y `cerrar-version.md` (divergen), y no llega a la `integra/…` en curso. Un único camino en los cuatro documentos (p. ej., llevar a la `integra/…` en curso, con merge, los commits de `main` local que no están en `origin/main`). Si cambia la regla de la ficha, `[ALCANCE]`.
3. [Flujo] Falta el ciclo de vida de `integra/…`: con la PR abierta solo recibe `fix/NNNN-ci`; las fichas siguientes van a una `integra/…` nueva; la de una ficha sola nunca está «en curso». Conflictos con `main` (CHANGELOG/BACKLOG): fusionar `origin/main` en la `integra/…` (sin rebase ni force push), repetir el verifier si toca código y volver a subir. En `flujo.md` («Git») y `tarea.md`.
4. [Quién decide] `flujo.md` (bullet «Push») y `CLAUDE.md` permiten `git push origin main` «mientras no esté activa la protección»: decir que desde esta ficha no es vía para integrar fichas del flujo nuevo, y nunca para una con exclusiones.
5. [Coherencia] Rangos fijos `main..HEAD` / `main..<rama>` en `flujo.md` y `verifier.md`: pasar a `<base>..HEAD`.

Opcional: líneas de más de 100 columnas y código partido (`ci.yml` línea 1, `flujo.md`, `tarea.md`, `planner.md`); `/cerrar-version` podría pararse con PR de `integra/…` sin fusionar; comillas dobladas de YAML en `parseFrontMatter`; ficha propia para negar en los permisos `gh pr merge --squash`/`--rebase`/`--delete-branch` y `git push origin :<rama>`.

## Verificación

Tests escritos en 256d5e4 (`test(ci): criterios de la ficha 0073 (#0073)`), en rojo antes del
código:

- CA1: `scripts/integrate.test.ts`, «CA1 (0073): mensaje del commit desde el front matter»
  (`parseFrontMatter`, `buildCommitMessage(ficha, zona)` y `checkIntegration`). La zona del mensaje
  no está en el front matter: la pasa el Orquestador como argumento.
- CA2: `scripts/integrate.test.ts`, «CA2 (0073): groupForPrs agrupa la cola en PR».
- CA3: `scripts/ci-workflow.test.ts`, «CA3 (0073): check en el push a main y en las PR; e2e solo
  en las PR; dist:win solo en main».
- CA4: `scripts/integrate.test.ts`, «CA4 (0073): campo exclusiones en la plantilla y valores
  válidos».
- CA5: `scripts/integration-docs.test.ts`, «CA5 (0073): documentos del flujo sin la integración de
  antes» (más la comprobación de sus propias frases).

El contrato (todo exportado desde `scripts/integrate.mjs`, también `EXCLUSIONES`) está en la
cabecera de `scripts/integrate.test.ts`.

## Resultado

(pendiente)

Decisiones del developer (2026-10-11):

- `hecha` pasa a significar «integrada en su rama `integra/…`»: el doc-writer deja la ficha
  `verificada` (`integrate.mjs` solo integra una `verificada`, y el test rechaza `hecha`) y el
  Orquestador pone `estado: hecha` dentro del propio commit de la ficha, tras el
  `git merge --squash`.
- `integrate.mjs` no toca git más que para leer (`status --porcelain` y `branch --show-current`):
  escribe el mensaje en la salida y el squash y el commit los hace el Orquestador. Además,
  `--agrupar <fichas>` da en JSON el resultado de `groupForPrs` (test propio en
  `scripts/integrate.main.test.ts`). `groupForPrs` devuelve la ficha sola en cuanto aparece y el
  grupo al cerrarse, así que la PR sola puede salir antes que el grupo que la rodea.
- La rama de la ficha sale de la rama de integración en curso, así que reviewer, verifier, developer
  y doc-writer usan `<base>..HEAD` con la base que les pasa el Orquestador (`main` por defecto).
- Al reabrir una ficha por el CI, su campo `rama` pasa a `fix/NNNN-ci` (el tipo del commit sale
  de él).
- La ficha aprobada del Planificador sigue en un commit en `main` local, sin push. Ronda 2 (punto
  2 del revisor), un solo camino, «Traer `main`» (`docs/flujo.md`, «Git»; `tarea.md`,
  `cerrar-version.md` y `planner.md` lo citan igual): `git fetch origin` y
  `git -C <checkout principal> merge --no-edit origin/main` (avanza si puede; si el Planificador
  commiteó después, deja un merge en `main` local, sin push), y `git merge --no-edit main` en la
  `integra/…` en curso si `integra/…..main` no está vacío; sin ninguna en curso, la siguiente
  sale de `main` o recibe ese merge, y al acabar la cola, si `origin/main..main` no está vacío,
  PR solo de documentos. Se hace al empezar cada ficha, antes de abrir una PR y tras fusionar una.
  Respeta la regla de la ficha (los documentos van en la `integra/…` en curso) sin cambiarla.
- Ronda 2 (punto 3): la `integra/…` en curso es la que no tiene PR; si no hay ninguna al empezar
  una ficha agrupable, el Orquestador la crea antes (`git branch`, desde la que tenga la PR sin
  fusionar o desde `main`), para que la rama de la ficha salga siempre de ella. Los conflictos con
  `main` se resuelven con `git merge --no-edit origin/main` en la `integra/…`, sin rebase.
- Ronda 2 (punto 1): `exclusiones` que no es lista (vacío o escalar) hace fallar `groupForPrs`
  con un error que lo explica, en vez de ir sola: es un fallo de la ficha y conviene verlo.
- Ronda 2 (punto 4): `git push origin main` queda solo para integrar esta ficha; desde la
  siguiente no es vía de integración aunque falte la protección, y sin `gh` se para y se avisa.
- `/cerrar-version` integra su commit con una PR desde `integra/…` que fusiona el Orquestador.
- En `ci.yml`, el e2e lleva `if: github.event_name != 'push'`: corre en las PR y a mano
  (`workflow_dispatch`), no en el push a `main`.
