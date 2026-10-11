---
id: '0091'
titulo: 'scan:tenant mira también los nombres de fichero, los renombrados y los binarios'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0091-scan-tenant-nombres-y-binarios
adrs: [7] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 4
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la T-05.

## Especificación

**Hoy.** `scripts/scan-tenant.mjs` solo mira las líneas añadidas de `git diff --unified=0`. No mira:
el nombre de un fichero nuevo o renombrado (un `…/<id>.json` con un valor del tenant en el nombre
pasa), ni el contenido de los binarios (git dice «Binary files … differ»: una captura de pantalla con
la URL del tenant pasa). Hoy los únicos binarios del repositorio son los iconos de `build/`.

**Qué se hace.**

1. **Nombres:** con `git diff --name-status -z <rango>`, cada ruta añadida, modificada o renombrada
   (también el destino de un renombrado) se compara con los valores del `.env`, como las líneas. Un
   hallazgo nuevo de tipo «nombre de fichero», que dice el fichero y nunca el valor.
2. **Binarios:** un binario añadido o modificado (`git diff --numstat` con `-` en las dos columnas)
   fuera de `build/**` hace fallar el escaneo con código 2 («no se ha podido comprobar»), salvo con
   `VIGIA_SCAN_ALLOW_BINARY=1`; el mensaje lo dice. Es la opción más simple y más dura: un binario no
   se puede leer de forma fiable (un xlsx es un zip), así que se trata como sospechoso. Con la
   variable, se busca igualmente en su contenido como texto `latin1` y UTF-16LE (lo que se pueda ver).
3. Lo de hoy no cambia: falla cerrado sin `.env`, con `.env` vacío o con un error de git, y nunca
   imprime valores. `docs/flujo.md` («Puertas sin IA») y el README explican lo nuevo y la variable.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (el filtro del tenant): va sola en su PR y la
fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se cumple; añade dos comprobaciones.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia la lógica del escáner.
4. No hay ninguna decisión que preguntar a Dani: se cumple; la opción del punto 2 la propuso el
   Planificador y Dani la aprobó con el lote (2026-10-11).

## Criterios de aceptación

Todos con un repositorio temporal y un `.env` de prueba con valores inventados.

- CA1: un fichero nuevo cuyo nombre lleva un valor del `.env` da 1 y el mensaje nombra el fichero sin
  el valor. Test con «CA1 (0091)».
- CA2: un renombrado hacia un nombre con un valor del `.env` da 1. Test con «CA2 (0091)».
- CA3: un binario nuevo fuera de `build/` da 2; dentro de `build/`, no. Test con «CA3 (0091)».
- CA4: con `VIGIA_SCAN_ALLOW_BINARY=1`, un binario sin valores pasa y uno que lleva un valor (en
  `latin1` o en UTF-16LE) da 1. Test con «CA4 (0091)».
- CA5: los tests de la 0055 (falla cerrado, nunca imprime valores) siguen en verde sin cambiar lo que
  esperan.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Leer dentro de los zip (xlsx, docx): con la variable, el autor responde de ese fichero.
- El destino del push (ficha 0088).

## Ideas surgidas (fuera de alcance)

- (developer) En `scanRange`, una línea añadida que empieza por `++ ` sale en el diff como `+++ …` y
  se toma por cabecera de fichero: esa línea no se revisa y cambia la ruta de los hallazgos
  siguientes. Es anterior a la 0091 (lo vio el reviewer en la ronda 2).

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Seguridad] `scanRange` (`scripts/scan-tenant.mjs`, hacia las líneas 220-221) imprime la ruta sin `safePath`: un fichero con un valor en el nombre y otro en el contenido saca `host: <ruta con el valor>:1`. Incumple CA1 y el punto 3 («nunca imprime valores»); los tests no lo ven porque el fichero de CA1 tiene `{}`. Acción: `safePath(file, needles)` en `scanRange` y un test «CA1 (0091)» con valor en el nombre y en el contenido que pase por `expectNoSecrets`.
2. [Seguridad] `binaryContent` hace `readFileSync(resolve(cwd, file.path))` con blob de ceros (rango contra el árbol de trabajo); un `ENOENT`/`EISDIR` lleva la ruta absoluta en `error.message` y el `catch` de `main` imprime su primera línea. Acción: capturar en `binaryContent` y relanzar un error genérico con la ruta por `safePath`; corregir el comentario del `catch`.
3. [Seguridad] `safePath` tapa cada tramo por separado: un `otro-valor` con `/` no está en ningún tramo y la ruta sale entera. Acción: si tras tapar los tramos la ruta completa sigue conteniendo un valor, aviso para la ruta entera; test unitario de `safePath`.
4. [Documentación] «Resultado» dice que con hallazgos y binarios a la vez «sale con 1 y avisa también de los binarios», pero el código hace `return 1` antes. Acción: avisar también de los binarios antes de salir con 1, o corregir la nota.

La lectura «carpeta y tipo» de CA1 es fiel (del secreto solo se busca un trozo; tapar el tramo entero es lo seguro); no es `[ALCANCE]`. Bien: tests con número que fallaban sin el código, sin tocar desde 162599c; los de la 0055 iguales; mensajes nuevos con la ruta tapada; sin valores del tenant; `VIGIA_SCAN_ALLOW_BINARY` solo con `1` y documentada; `--no-renames`; UTF-16LE en las dos alineaciones.

Opcional: partir la línea larga de la cabecera de `scan-tenant.mjs`; reajustar el párrafo de `docs/flujo.md`; para `host` e `id-de-entorno` se podría tapar solo el valor.

### Ronda 2: CAMBIOS

Los cuatro puntos de la ronda 1 están aplicados (a275127, tests en 5c8d1dd): `scanRange` con `safePath` (`scripts/scan-tenant.mjs:233`), con test que falla sin el arreglo; `binaryContent` relanza con `safePath` y `error.code`; `safePath` tapa la ruta entera si aún lleva un valor, con test; el aviso de binarios sale antes del `return 1`. Los tests de 004df1e y los de la 0055, sin tocar. El punto 2 sin test basta (el `ENOENT` solo llega por una carrera o un `EBUSY`/`EACCES`, y el mensaje se arma solo con `safePath` y el código).

1. [Seguridad] `git()` (`scripts/scan-tenant.mjs:80-82`) llama a `execFileSync` sin `stdio`: el stderr de git sale sin tapar. Con un rango contra el árbol de trabajo (`npm run scan:tenant -- HEAD`) y `core.autocrlf=true`, git escribe `warning: in the working copy of '<ruta>', LF will be replaced by CRLF…` con la ruta entera. El pre-push no se ve afectado (rangos `a..b`). Acción: `stdio: ['ignore', 'pipe', 'pipe']` en `git()` y un test «CA1 (0091)» en un repositorio temporal con `core.autocrlf=true` (fichero con LF y `zz99fake` en el nombre, modificado sin commit, `cli('HEAD')`, `expectNoSecrets` sobre stdout y stderr); si el aviso no sale en el git de la máquina, basta el cambio de `stdio` con un comentario.
2. [Seguridad] La extensión que muestra `safePath` (`scripts/scan-tenant.mjs:102-105`) puede ser el final del valor: solo se comprueba que no contenga el valor entero. Con `otro-valor` = `foo.internal` y un fichero `foo.internal` sale `(fichero .internal)`. Acción: mostrar la extensión solo si el nombre sin ella sigue llevando el valor; si no, el aviso sin extensión. Test «safePath (0091)» con un valor que acabe en `.xxxx`.

Opcional: test de la salida combinada del punto 4 (hallazgo y binario sin comprobar a la vez: 1 y el aviso de `VIGIA_SCAN_ALLOW_BINARY`); `-c core.quotePath=false` en el `git diff --unified=0`; partir la línea 16 de la cabecera. Fuera de alcance, para «Ideas surgidas»: en `scanRange`, una línea añadida que empieza por `++ ` sale como `+++ …` y se toma por cabecera de fichero (línea 220).

Sin datos del tenant (valores inventados). `README.md` y `docs/flujo.md` explican lo nuevo.

### Ronda 3: APROBADO

- **Punto 1 de la ronda 2, aplicado.** `git()` (`scripts/scan-tenant.mjs:86-94`) con `stdio: ['ignore', 'pipe', 'pipe']` y `windowsHide`; test «CA1 (0091): con core.autocrlf=true…» con `expectNoSecrets` sobre stdout y stderr, que fallaría sin el arreglo. El comentario del `catch` de `main` cuadra.
- **Punto 2 de la ronda 2, aplicado.** `shownExtension` (líneas 130-137) solo enseña la extensión si el nombre sin ella sigue llevando cada valor y ningún valor la contiene; dos tests «safePath (0091)». También el test de la salida combinada y `-c core.quotePath=false`.
- **Repaso de stdout/stderr, confirmado en el código:** ningún proceso hijo comparte la salida (`git()` con pipe, `gitIsAncestor` con `stdio: 'ignore'`, `mainCheckoutOf` descarta el stderr); errores de disco con `safePath` o `error.code`; hallazgos y binarios siempre por `safePath`. Ninguna vía real por la que se imprima un valor.
- **Criterios y tests.** CA1 a CA4 con sus tests; CA5 se cumple. Desde 004df1e el fichero de tests solo tiene líneas añadidas. Valores inventados.

Opcional (no bloquea; a «Ideas surgidas»): `shownExtension` no mira si la extensión se solapa con otra aparición del mismo valor (`foo-falso.int-foo-falso.internal` deja ver `.internal`). Exige el valor dos veces en el nombre; se cerraría con `lastIndexOf(value) + value.length <= stem.length`.

### Ronda 4 (arreglo de integración): APROBADO

- Correcto y suficiente: en `c398ddd..HEAD` solo cambia `scripts/scan-tenant.test.ts`; `scripts/scan-tenant.mjs` intacto. Todas las llamadas a `git` y al script del test reciben un entorno sin `GIT_*` (`withoutGitVars` en `git()`, `gitIn()`, `cleanEnv`/`cliWith` y el `spawnSync` de la línea 258); el borrado de `GIT_*` de `process.env` al cargar (líneas 56-59) hace falta porque `scan()` corre en el proceso del test. Cubre las variantes de mayúsculas de Windows.
- Ningún `expect`, caso ni dato cambia; solo el entorno.
- No alcanza a otros ficheros: vitest 5.0.3 usa por defecto `forks` con aislamiento (`vitest.config.ts` no fija `pool` ni `isolate`), así que `control-chars.test.ts` conserva el `GIT_INDEX_FILE` del hook. `pre-push.test.ts` y `pre-push-refs.test.ts` ya quitaban las `GIT_*`.
- Sin datos del tenant ni secretos.

Opcional: avisar en el comentario de las líneas 56-59 de que con `isolate: false` o `pool: 'threads'` sin aislamiento el borrado global podría afectar a `control-chars.test.ts` dentro de un hook.

## Verificación

Tests escritos en el commit 162599c, todos en `scripts/scan-tenant.test.ts` (Vitest, repositorio
temporal y `.env` con valores inventados):

- CA1: «CA1 (0091): termina en 1, da un hallazgo de nombre de fichero y no imprime el valor» (el
  mensaje nombra la carpeta `datos/` y el tipo «nombre de fichero») y «con un nombre sin valores
  del .env termina en 0».
- CA2: «CA2 (0091): termina en 1 aunque el contenido no cambie, sin imprimir el valor» (`git mv`).
- CA3: «CA3 (0091): un binario nuevo fuera de build/ termina en 2 y el mensaje nombra
  VIGIA_SCAN_ALLOW_BINARY» y «un binario nuevo dentro de build/ no hace fallar el escaneo».
- CA4: «CA4 (0091): un binario sin valores del .env pasa (0)» y «un binario con un valor del .env
  en latin1 / utf16le termina en 1 sin imprimir el valor».
- CA5: los tests de la 0055 del mismo fichero, sin cambios.

Al escribirlos: 5 fallan (CA1 con valor, CA2, CA3 fuera de build/, CA4 latin1 y UTF-16LE) y 47
pasan.

Verificación 2026-10-12, commit b258f3f, rango `origin/main..fix/0091-scan-tenant-nombres-y-binarios`: **VERDE**

- `npm run check`: 4152 tests (224 ficheros), cobertura ok. En el primer pase `scripts/react-compiler.test.ts` (CA3 0059) agotó los 5000 ms por carga (lo trata la 0100); aislado ×3 pasó y el `check` completo repetido salió verde.
- `test:e2e:affected -- origin/main..HEAD`: «solo docs o tests unitarios»; ningún spec.
- `npm run scan:tenant` en el worktree limpio sobre el rango (15 commits): salida 0, 5 valores buscados, 0 coincidencias, sin nada sospechoso en la salida.

Verificación 2026-10-12 (tras el arreglo de integración), commit 34621d5, rango `origin/main..fix/0091-scan-tenant-nombres-y-binarios`: **VERDE**

- `npm run check`: 4152 tests (224 ficheros), cobertura ok (líneas 93,58 %, ramas 90,03 %).
- `test:e2e:affected`: «solo docs o tests unitarios»; ningún spec.
- Caso del hook: con `GIT_INDEX_FILE` apuntando a una copia del índice, `scan-tenant`, `control-chars`, `pre-push` y `pre-push-refs` pasan (102 tests) y `git status` queda limpio.

## Resultado

Decisiones del developer (`scripts/scan-tenant.mjs`):

- El hallazgo de nombre se escribe con `safePath`: cada carpeta o nombre que lleva un valor se
  cambia entero por un aviso y del nombre queda solo la extensión, si es corta y no lleva valores.
  No se enmascara solo el valor: del secreto de un token solo se busca un fragmento y el resto
  quedaría a la vista. Encaja con la lectura del test-writer (carpeta y tipo).
- Los ficheros salen de `git diff --raw -z --no-renames` (el destino de un renombrado sale como
  añadido) y los binarios de `--numstat -z --no-renames`; el contenido, del blob de destino.
- Con hallazgos y binarios sin comprobar a la vez, sale con 1 (hay fuga segura) y avisa también
  de los binarios. Con la variable, solo se lee el contenido de los binarios fuera de `build/`.
  UTF-16LE se lee en las dos alineaciones.

Ronda 1 (developer), tests nuevos en b8725d0 sin tocar los de 162599c:

- `safePath` también en los hallazgos de contenido (`scanRange`); si tras tapar los tramos la ruta
  aún lleva un valor (uno con «/»), sale «<ruta con un valor del .env>». Tests «CA1 (0091): con un
  valor en el nombre y otro en el contenido…» y «safePath (0091): …».
- `binaryContent` relanza el error de disco con la ruta tapada y solo el código (`ENOENT`…).
- El aviso de binarios sin comprobar sale antes del `return 1`: la nota de arriba ya es cierta.
- Opcionales: cabecera partida y párrafo de `docs/flujo.md` reajustado; tapar solo el valor de
  `host` e `id-de-entorno` no se hace (no es trivial y tapar el tramo entero es lo seguro).

Ronda 2 (developer), tests nuevos en ac42d1f sin tocar los anteriores; código en 8a98960:

- `git()` con `stdio: ['ignore', 'pipe', 'pipe']`: el aviso de `core.autocrlf` (que sale en el git
  de esta máquina) ya no llega al terminal. Test «CA1 (0091): con core.autocrlf=true…».
- `safePath` enseña la extensión solo si el nombre sin ella sigue llevando cada valor encontrado y
  ningún valor del `.env` la contiene (`shownExtension`). Tests «safePath (0091): un valor que
  acaba en .xxxx…» y «…la extensión se muestra».
- Test de la salida combinada (hallazgo y binario sin comprobar: 1 y el aviso de
  `VIGIA_SCAN_ALLOW_BINARY`); ya pasaba con el código de la ronda 1.
- Opcionales: `-c core.quotePath=false` en el `git diff --unified=0` (la ruta sale sin escapes y
  `safePath` la puede tapar) y la línea 16 de la cabecera, partida.

Repaso de todo lo que el escáner escribe a stdout y stderr (ninguno lleva un valor ni un trozo):

- Procesos hijos: `git()` recoge stdout y stderr; `gitIsAncestor` usa `stdio: 'ignore'`;
  `mainCheckoutOf` (`scripts/lib/env-file.mjs`) ignora el stderr. Ningún hijo hereda la salida.
- Errores de git: solo se imprime la primera línea, `Command failed: git <args>`; los args son
  opciones, el rango (lo escribe quien lanza el escáner, o SHA en el pre-push) y hashes de blob.
- Errores de disco: el `.env` y los binarios, solo con `error.code`; la entrada estándar
  (descriptor 0, sin ruta); los de formato de `changedFiles` y `prePushRanges`, textos fijos.
- Resumen y hallazgos: rango, número y tipos de valores, tipo de hallazgo, ruta con `safePath`,
  línea y hash corto del commit; los binarios sin comprobar, con `safePath`.
- `--check-refs`: solo el ref remoto y textos fijos; el hook `pre-push` solo repite refs remotos.

Cierre (doc-writer): 16 commits en la rama (tests 004df1e, 5c8d1dd y ac42d1f; código acf1d6a,
a275127 y 8a98960; docs fe8f15c y ffcb421). Ficheros principales: `scripts/scan-tenant.mjs`,
`scripts/scan-tenant.test.ts`, `README.md` y `docs/flujo.md`. 3 rondas de revisión (CAMBIOS,
CAMBIOS, APROBADO). Sin ADR nuevo ni migración. Las ideas surgidas pasaron a «Mejoras anotadas» del
BACKLOG: las líneas `++ ` de `scanRange`, el solape de la extensión en `shownExtension` y tapar solo
el valor de `host` e `id-de-entorno`. El unitario `react-compiler` volvió a agotar el tiempo en el
primer pase del verifier; se sumó la fecha a su línea del BACKLOG (ficha 0100).

**Integración (Orquestador, 2026-10-12).** Al hacer el `merge --squash` en `integra/20261012-1`, el
pre-commit (`npx vitest related … scripts/scan-tenant.test.ts`) falló y dejó `base.txt` en el índice
del repositorio. Causa, reproducida: el hook hereda `GIT_INDEX_FILE` de git, y los `git` que lanzan
los tests en su repositorio temporal (`git()`, `cleanEnv`) usan ese índice en vez del suyo; con la
variable apuntando a una copia, fallan 57 de 59. Los tests pasan sin la variable. Decisión del
Orquestador (Dani delegó las decisiones esa noche): se arregla en esta ficha, como arreglo de
integración y no como ronda de revisión de diseño: los tests limpian las variables `GIT_*` del
entorno antes de lanzar `git` o el script. Después, revisión del arreglo y verifier.

Arreglo de integración (developer, 53f853e), solo en `scripts/scan-tenant.test.ts`:

- `withoutGitVars` quita del entorno toda variable `GIT_*` (`GIT_INDEX_FILE`, `GIT_DIR`,
  `GIT_WORK_TREE`, `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`…); la usan `git()`,
  `gitIn()`, `cleanEnv` y el `spawnSync` del test «con valores en el .env no avisa…». Como
  `scan()` se llama en el mismo proceso y sus `git` heredan `process.env`, el fichero también borra
  esas variables de su `process.env` al cargar (vitest aísla cada fichero en su worker).
- `scripts/scan-tenant.mjs` no se toca: en el pre-push lo lanza git sobre el repositorio real y sus
  variables son las correctas; fuera de un hook no hay `GIT_*`.
- Los otros tests no tenían el problema: `pre-push.test.ts` y `pre-push-refs.test.ts` ya quitaban
  las `GIT_*`; `affected-e2e-spawn.test.ts` no lanza git; `ci-changes.main.test.ts` usa el evento
  push, que no mira git; `control-chars.test.ts` hace `git ls-files` sobre el repositorio real, donde
  el índice del hook es el correcto.
- Reproducción con `GIT_INDEX_FILE` apuntando a una copia del índice en una carpeta temporal: antes,
  59 de 59 fallaban; después, los 6 ficheros pasan (120 tests), también con `GIT_DIR` y
  `GIT_WORK_TREE` falsos. `npm run check` en verde (4152 tests).
