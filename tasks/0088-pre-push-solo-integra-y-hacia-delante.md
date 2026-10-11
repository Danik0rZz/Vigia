---
id: '0088'
titulo: 'pre-push: solo se publica en ramas integra/ y solo hacia delante'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0088-pre-push-solo-integra
adrs: [7, 14] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad que siguen abiertos de la revisión
de código del 2026-10-11 pasan a fichas con prioridad. Esta es la T-01: el pre-push no limita a
dónde se hace push.

## Especificación

**Hoy.** `.githooks/pre-push` rechaza los borrados de refs remotos (ficha 0082) y lanza
`scan-tenant --pre-push`, que lee de cada línea de stdin solo los dos SHA y descarta el ref remoto.
Así pasan el hook: un push a cualquier rama que no sea `integra/…` (`git push origin HEAD:otra`), y
un push que no es avance rápido escrito con refspec `+` (`git push origin +x:integra/y`), que además
no casa con ningún `deny` de `.claude/settings.json` (solo cubren `--force`, `-f` y
`--force-with-lease`). La protección de `main` en GitHub (activa desde el 2026-10-11) cierra `main`,
pero no las ramas `integra/`.

**Qué se hace.**

1. Una función pura (por ejemplo `checkPushRefs(lines, { allowed, isAncestor })`, en
   `scripts/scan-tenant.mjs` o en un script nuevo que el hook llame antes del escaneo) que, por cada
   línea de stdin (`<ref local> <sha local> <ref remoto> <sha remoto>`), devuelva un problema si:
   - el ref remoto no empieza por `refs/heads/integra/` y no está en la lista permitida;
   - es un borrado (SHA local a ceros; ya lo rechaza la 0082: se mantiene, en el hook o en la
     función);
   - no es lineal: el SHA remoto no es ceros y no es antecesor del local
     (`git merge-base --is-ancestor <remoto> <local>` distinto de 0). Si el SHA remoto no está en
     el clon, también se rechaza, con un mensaje que pida hacer `git fetch` (falla cerrado).
2. El hook sale con 1 y un mensaje claro, sin ningún valor del tenant: «el destino no es una rama
   integra/», «no es un avance rápido» o «se borra un ref remoto». No se publica nada.
3. **Excepción para Dani:** la variable `VIGIA_PUSH_ALLOW_REFS` con refs exactos separados por comas
   (por ejemplo, `refs/tags/v0.12.0`), como `VIGIA_SCAN_TENANT_OPTIONAL`. Solo abre el destino; nunca
   un push no lineal ni un borrado. Se documenta en el README y en `docs/flujo.md` («Puertas sin
   IA»). **Decisión de Dani (2026-10-11):** las etiquetas no tienen excepción propia; un tag
   (`refs/tags/v…`) se publica nombrándolo en la variable, como cualquier otro destino.
4. **Segunda capa, en `.claude/settings.json`** (`deny`, en `Bash(…)` y en `PowerShell(…)`, como las
   que ya hay): `git push * +*`, `git push * --mirror*`, `git push * --prune*` y `git -c *push*`. Lo
   que tiene que seguir permitido: `git push origin integra/<nombre>` y
   `git push -u origin integra/<nombre>`.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (puerta de publicación y permisos de los
agentes): va sola en su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se cumple; añade la función de comprobación.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia la lógica del hook.
4. No hay ninguna decisión que preguntar a Dani: no se cumplía (los tags); ya la tomó Dani.

## Criterios de aceptación

- CA1: la función devuelve un problema para un ref remoto `refs/heads/main`, para
  `refs/heads/feat/x`, para un borrado y para un push no lineal, y ninguno para un avance rápido a
  `refs/heads/integra/AAAAMMDD-N` ni para una rama `integra/` nueva (SHA remoto a ceros). Test
  unitario con «CA1 (0088)».
- CA2: con un repositorio temporal y el hook instalado, un push a una rama que no es `integra/` y un
  push no lineal a una `integra/` salen con código distinto de 0 y el remoto no cambia; un avance
  rápido a `integra/` publica. Test con «CA2 (0088)».
- CA3: con `VIGIA_PUSH_ALLOW_REFS` y el ref exacto, ese destino pasa; con un valor parecido (prefijo,
  comodín) no pasa; y la variable no deja pasar un push no lineal. Test con «CA3 (0088)».
- CA4: `permissions.deny` tiene, en Bash y en PowerShell, las cuatro reglas del punto 4, y no niega
  `git push origin integra/x` ni `git push -u origin integra/x`. Test con «CA4 (0088)».
- CA5: los tests de la 0055 y la 0082 (escaneo del pre-push y borrados) siguen en verde sin cambiar
  lo que esperan.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- La configuración de GitHub (protección de ramas): la decide Dani.
- Otras vías que no pasan por el pre-push (`gh api -X DELETE …`): idea de la 0082, sigue anotada.
- `scan:tenant` con binarios y nombres de fichero (ficha 0091).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1–CA4 con sus tests numerados (`scripts/pre-push-refs.test.ts`, `scripts/claude-permissions.test.ts`); CA2 y CA3 con git de verdad, comprobando el SHA del remoto. Tests sin tocar tras sus commits (a5f3fe0 y d5b6529). CA5: d5b6529 solo cambia el destino de `main` a `HEAD:integra/…`; las aserciones siguen igual (montaje, decisión del Orquestador).
- `checkPushRefs` y `--check-refs`: prefijo exacto `refs/heads/integra/`, sensible a mayúsculas (se rechazan `refs/heads/integra` sin barra, `Integra/`, tags y `HEAD:otra`); `..` no llega (git lo rechaza antes). `VIGIA_PUSH_ALLOW_REFS` compara refs exactos, después de los borrados y antes de la linealidad. SHA remoto a ceros: rama nueva. Commit remoto ausente: rechazo pidiendo `git fetch`; cualquier otro error de git: rechazo (falla cerrado). Mensajes solo con el ref.
- Hook: borrados (0082), después `--check-refs` (cualquier salida distinta de 0 para el push) y al final el escaneo del tenant, sin cambios.
- Permisos: las 4 reglas en Bash y PowerShell; no niegan `git push origin integra/x`, `-u` ni `HEAD:integra/…`; ninguna acaba en `:*`. README y `docs/flujo.md` documentan la variable. Sin secretos ni datos del tenant.
- Para el doc-writer: corregir los commits citados en «Verificación» tras el rebase (a5f3fe0 y d5b6529) y anotar las decisiones del developer (modo `--check-refs` en `scan-tenant.mjs`; línea mal formada rechazada; `cat-file -e` antes de `merge-base`; borrados rechazados dos veces; `scripts/check-push-refs.test.ts` propio).
- Opcional: `deny` no cubre `git push --mirror`, `--prune` ni `git -C <dir> push …` (el hook los para igual); idea fuera de alcance: saltarse el hook con `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0=core.hooksPath` no casa con ninguna regla.

## Verificación

Tests escritos en a5f3fe0 (test-writer). Contrato que fijan: `checkPushRefs(lines, { allowed, isAncestor })` exportada por `scripts/scan-tenant.mjs`; `lines` es un array de líneas de stdin, `isAncestor(antecesor, descendiente)` devuelve booleano y el resultado es la lista de problemas (vacía si pasa), con los mensajes del punto 2.

- CA1: `scripts/pre-push-refs.test.ts`, describe «CA1 (0088): checkPushRefs rechaza…» (main, feat/x, borrado, no lineal; avance rápido e integra/ nueva sin problemas).
- CA2: `scripts/pre-push-refs.test.ts`, describe «CA2 (0088)…» (git real con remoto temporal: main, feat/x, rama nueva y `+HEAD:integra/…` salen con error y el remoto no cambia; avance rápido e integra/ nueva publican).
- CA3: `scripts/pre-push-refs.test.ts`, describe «CA3 (0088): checkPushRefs con refs permitidos…» (unitario) y «CA3 (0088): VIGIA_PUSH_ALLOW_REFS…» (hook: tag exacto y lista con comas pasan; prefijo y comodines no; ni no lineal ni borrado).
- CA4: `scripts/claude-permissions.test.ts`, describe «CA4 (0088)…» (las cuatro reglas en Bash y PowerShell, ejemplos negados y `git push origin integra/x` y `git push -u origin integra/x` permitidos).
- CA5: sin test nuevo (son los de `scripts/scan-tenant.test.ts` y `scripts/pre-push.test.ts`). Choca con CA1: «CA4 (0082): un push normal a main pasa» y «con una fuga del tenant… (scan:tenant, 0055)» empujan a `main`, que la 0088 rechaza; no pueden seguir en verde sin cambiarlos. Decisión del Orquestador (no es [ALCANCE]): el destino es montaje, no lo que esperan. En d5b6529 los dos publican en `HEAD:integra/20261011-2` y `HEAD:integra/20261011-3` (el primero se llama ahora «un push normal a una integra/ pasa»), con las mismas aserciones; la del remoto mira la rama del destino. Los cinco borrados no cambian. Con el hook de hoy, 8/8 en verde.

Verificación 2026-10-11, commit 50bb774, rango `main..fix/0088-pre-push-solo-integra`: **VERDE**.

- `npm run check`: 223 ficheros, 4038 tests. Incluye `scripts/pre-push-refs.test.ts`, `check-push-refs.test.ts`, `pre-push.test.ts`, `scan-tenant.test.ts` y `claude-permissions.test.ts` (200 tests en verde). El primer pase tuvo un fallo intermitente ajeno: `scripts/react-compiler.test.ts` («CA3 (0059)») por el límite de 5000 ms; aislado ×3, 3 de 3, y un segundo `check` completo en verde.
- `npm run test:e2e:affected`: «solo docs o tests unitarios; no hace falta ningún e2e».

## Resultado

- Commits (rama `fix/0088-pre-push-solo-integra`): tests a5f3fe0 y d5b6529 (destino de los tests de la 0082), implementación 845f029, permisos 7408c7a, documentación fcd5b6e. Una ronda de revisión (APROBADO). Sin ADR nuevo. Sin migraciones.
- Ficheros principales: `scripts/scan-tenant.mjs` (`checkPushRefs` y modo `--check-refs`), `.githooks/pre-push`, `.claude/settings.json`, `README.md`, `docs/flujo.md`, `scripts/pre-push-refs.test.ts`, `scripts/check-push-refs.test.ts`, `scripts/claude-permissions.test.ts`.
- Decisiones del developer: la comprobación es un modo `--check-refs` de `scan-tenant.mjs` y no un script nuevo; una línea de stdin mal formada se rechaza; `git cat-file -e` va antes de `merge-base` para distinguir un commit remoto que falta (pide `git fetch`) de otro error de git (falla cerrado); los borrados se rechazan dos veces, en el hook (0082) y en la función; `scripts/check-push-refs.test.ts` es propio del developer.
- Efecto práctico: con este hook ningún push a `main` ni a otras ramas pasa, tampoco para Dani; los tags, con `VIGIA_PUSH_ALLOW_REFS=refs/tags/vX.Y.Z`.
- Ideas anotadas en el BACKLOG: huecos de `deny` (`--mirror`, `--prune`, `git -C`), el salto del hook con `GIT_CONFIG_COUNT` y el unitario `react-compiler` sospechoso de inestable.
- Reapertura por el CI (2026-10-11, PR #16, run 38159322552, intento 2): «CA3 (0088): la variable no deja pasar un push no lineal a un ref permitido» pasó del límite de 5000 ms de vitest (8,5 s en el runner de Windows; el fichero, 53,7 s). Arreglo en `fix/0088-ci`: `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })` en la cabecera de `scripts/pre-push-refs.test.ts` y de `scripts/pre-push.test.ts` (0082, mismo riesgo: git real y push con el hook), sin tocar ninguna aserción. Se eligió `setConfig` y no la opción `timeout` de cada `describe` para no reindentar los bloques (diff limpio); comprobado con una prueba temporal que vale también para los `beforeEach`. `scripts/check-push-refs.test.ts` es unitario puro: sin riesgo, sin cambios. No se vio cómo acelerarlos sin quitar el push real con el hook, que es justo lo que comprueban.
