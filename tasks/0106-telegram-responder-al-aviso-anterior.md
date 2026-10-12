---
id: '0106'
titulo: Cada aviso de una ficha responde al anterior de la misma ficha
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0105'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0106-ci
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: # el de la 0104; el doc-writer añade este punto
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#replyparameters; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 3
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12), dentro de «avisos de
Telegram en imagen», como punto por decidir: que los avisos de una ficha respondan al anterior de
la misma ficha (con el `message_id` que devuelve Telegram).

## Especificación

Dani dijo que sí el 2026-10-12: «que se vayan contestando, así podemos ver el camino de cada
cambio». Con una tarjeta en varias partes (0105), el `message_id` que se guarda es el de la primera
parte.

- Al enviar bien un aviso con `ficha` (o versión), el script guarda el `message_id` que devuelve
  Telegram (`result.message_id` de `sendPhoto` o `sendMessage`) en un fichero local que no se
  versiona y que comparten el checkout principal y los worktrees: en la carpeta común de git
  (`git rev-parse --git-common-dir`), por ejemplo `vigia-telegram-avisos.json`, con
  `{ "<ficha>": <message_id> }` y solo las últimas 200 entradas. No guarda ni el chat_id ni el
  token.
- El aviso siguiente de esa misma ficha va como respuesta a ese mensaje
  (`reply_parameters: { message_id, allow_sending_without_reply: true }`, para que llegue aunque el
  mensaje anterior se haya borrado), en vez de responder al que abre el hilo; el
  `message_thread_id` de la 0103 se mantiene. Los nombres de los campos, de la documentación
  oficial; el developer los comprueba allí y anota la fecha.
- Si el fichero no existe, no se puede leer o está mal, se envía como si fuera el primero y se dice
  en la terminal; nunca para el flujo.

## Carril

Normal (`ligera: no`), con la exclusión `externos`:

1. No añade componentes, funciones ni cálculos nuevos: falla, guarda y lee un fichero nuevo.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: falla.
4. No hay ninguna decisión que preguntar a Dani: falla, si la quería (dijo que sí el 2026-10-12).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
En `scripts/notify-telegram.test.ts`, sin red y con una carpeta temporal en vez de la de git.

- CA1: tras un envío bien de la ficha 0001, el fichero tiene su `message_id`; el siguiente aviso
  de la 0001 lleva `reply_parameters.message_id` con ese valor y `allow_sending_without_reply`.
- CA2: un aviso de otra ficha no responde al de la 0001 (responde al que abre el hilo, 0103, o a
  ninguno).
- CA3: con el fichero corrupto o sin permiso de lectura, el aviso sale sin respuesta y el script
  sale con 0.
- CA4: el fichero no pasa de 200 entradas (se quitan las más antiguas) y no contiene el token ni el
  chat_id.
- CA5: el fichero está fuera del árbol de trabajo (en la carpeta común de git), así que `git status`
  no lo ve.

## Pruebas a mano para Dani

- Dos avisos seguidos de la misma ficha de prueba: el segundo sale como respuesta al primero.

## Fuera de alcance

- Agrupar los avisos de un lote entero en un mismo hilo.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: los cinco CA tienen tests con su número en `scripts/notify-telegram.test.ts` (commit f0598c9) y fallarían sin el código: comprueban el `reply_parameters` exacto, el contenido del fichero, el recorte a 200 entradas y que `git status` salga limpio en un repositorio temporal con worktree. `git diff f0598c9..HEAD -- scripts/` solo muestra cambios en `notify-telegram.mjs`.
- Fichero compartido: `saveReply` relee antes de escribir, escribe en `<fichero>.<pid>.tmp` y hace `renameSync`; si falla, borra el temporal y solo avisa. Solo guarda `{ clave: message_id }`, sin token ni chat_id (CA4). La carpeta sale de `git rev-parse --git-common-dir`, absoluta y sin shell. Con el fichero ausente, corrupto, con otra forma o ilegible, el aviso sale como el primero, lo dice y sale con 0 (ADR-0009). En los tests solo se toca la carpeta de git si se pasa `deps.gitCommonDir`.
- Con la 0103 y la 0105: `message_thread_id` se mantiene y `reply_parameters` apunta al aviso anterior (`allow_sending_without_reply: true`); sin aviso anterior, como antes (al que abre el hilo). El reintento sin hilo va sin respuesta, en texto e imagen. Con la imagen en partes, la primera responde al aviso anterior y las demás a la primera de su aviso; se guarda el `message_id` de la primera. El texto de respaldo también responde al anterior.
- API: `reply_parameters.message_id`, `allow_sending_without_reply` y `result.message_id` existen en la Bot API; comprobado el 2026-10-12. Sin Dynatrace, IPC, esquema ni dependencias. Sin datos del tenant ni secretos.

Opcional:

1. `saveReply`: si dos worktrees guardan a la vez, el último `rename` gana y se pierde la entrada del otro; en Windows el `rename` puede fallar con EPERM si otro proceso tiene el fichero abierto. Como mucho, un aviso que no responde al anterior; se podría dejar escrito en el comentario de la función.
2. El recorte a 200 ordena por `message_id` y supone un solo chat; si cambia `VIGIA_TELEGRAM_CHAT_ID`, los ids del chat viejo pueden quedar mal ordenados. Lo cubre `allow_sending_without_reply: true`.

### Ronda 2: APROBADO

- `7c3737b..feat/0106-telegram-responder-anterior` es un solo commit (3bbc3ef): 6 líneas en `scripts/notify-telegram.test.ts` (89-94) que precargan `telegram-card.mjs` con `await import`, protegida con `existsSync`. No cambia ninguna aserción, `it`/`describe` ni mock. Es el mismo patrón que c1b6c34 (0105).
- CA1 (0106) sigue probando lo mismo: la precarga solo saca de su tiempo la primera importación y el script reutiliza el módulo en caché.
- La nota de «Verificación» coincide con el commit; sin datos del tenant ni secretos.

### Ronda 3 (arreglo de CI): APROBADO

- **Alcance:** en `integra/20261012-13..fix/0106-ci` solo cambian `scripts/notify-telegram.test.ts` (f980d07, 10 líneas) y la ficha; `notify-telegram.mjs` no se toca.
- **CA5 no se afloja:** sigue pidiendo con `toBe` que `resolveGitCommonDir` dé exactamente la carpeta `.git` del checkout principal, desde el worktree y desde el repositorio; solo cambia la función que normaliza las rutas, aplicada a los dos lados. Con otra carpeta (p. ej. `.git/worktrees/wt`) seguiría fallando. Los otros dos tests de CA5 no cambian.
- **`realpathSync.native` (deducido, no probado):** en Windows pasa por libuv `uv_fs_realpath`, que usa `GetFinalPathNameByHandleW` y devuelve los nombres largos (`RUNNER~1` → `runneradmin`), sin el prefijo `\?\`; `realpathSync` en JavaScript recorre con `lstat` y no amplía los nombres 8.3, que es el fallo del CI. La prueba real será «CA5 (0106)» en verde en el CI de la PR #35.
- **Ficha:** la nota explica el motivo y el run sin datos del tenant; `en_revision` con `rama: fix/0106-ci` es coherente.

## Verificación

Tests escritos en el commit 03b96ff, en `scripts/notify-telegram.test.ts` (fallan hasta que exista el código):

- CA1: `CA1 (0106): …` (tres tests: sendMessage, con hilo de la 0103 y sendPhoto en varias partes).
- CA2: `CA2 (0106): …` (sin hilo, sin `reply_parameters`; con hilo, responde al que abre el hilo).
- CA3: `CA3 (0106): …` (JSON corrupto, con otra forma, que no es un objeto, ilegible y que no existe).
- CA4: `CA4 (0106): …` (201 fichas dejan 200 sin la más antigua; sin token ni chat_id).
- CA5: `CA5 (0106): …` (`resolveGitCommonDir` desde un worktree, `git status` limpio en los dos y la entrada usa `--git-common-dir`).

Contrato que fijan los tests: `deps.gitCommonDir()` en `main` (sin él no se lee ni se guarda nada), `resolveGitCommonDir(cwd)` exportada y los problemas del fichero en stderr con «[aviso telegram]». El fichero ilegible se simula con una carpeta en su lugar (en Windows, quitar el permiso de lectura con chmod no impide leer).

Tras la ronda 1, `CA1 (0106): con sendPhoto en varias partes…` pasaba de los 5 s con la máquina cargada (5,2 a 8,4 s en 6 de 6 ejecuciones con 6 suites a la vez): era el único test del fichero que envía la foto y pagaba la primera carga de `telegram-card.mjs`. Se precarga al cargar el fichero (como en la 0105, c1b6c34), sin tocar aserciones: con 6 ejecuciones a la vez del fichero baja a unos 40 ms, y `npm run check` en verde.

Verificación 2026-10-12, commit edb45e9, rango main..feat/0106-telegram-responder-anterior: VERDE

- check: 4338 tests (231 ficheros), cobertura ok (líneas 93,75 %, ramas 90,13 %, funciones 90,37 %, sentencias 92,98 %).
- e2e: `test:e2e:affected` no seleccionó ninguno (solo `scripts/` y la ficha).
- Con carga: `scripts/notify-telegram.test.ts` con 6 y con 12 ejecuciones a la vez: las 18 con 126 de 126 y salida 0.
- Una verificación anterior (commit 7c3737b) vio fallar una vez por timeout «CA1 (0106)» en un check completo; arreglado en 3bbc3ef (precarga de la tarjeta).

Reabierta por el CI de la PR #35 (run 38276010784): «CA5 (0106): resolveGitCommonDir da la carpeta .git…» comparaba la ruta de `os.tmpdir()` (corta 8.3, `RUNNER~1`, en el runner de Windows) con la de git (larga) usando `realpathSync`, que no desdobla los nombres cortos. Ahora compara `realpathSync.native` en los dos lados, con la misma aserción (commit de tests de esta línea, `test(scripts): … (#0106)`). Ningún otro test de la 0105, 0106 ni 0107 compara rutas de `tmpdir()`.

Verificación del arreglo de CI 2026-10-12, commit 9a8bdee, rango integra/20261012-13..fix/0106-ci: VERDE

- check: 231 ficheros, 4338 tests, cobertura ok (sentencias 92,98 %, ramas 90,13 %, funciones 90,37 %, líneas 93,75 %).
- e2e: `test:e2e:affected` no seleccionó ninguno. La ruta corta 8.3 no se puede reproducir aquí: lo confirma el CI de la PR #35.

## Resultado

- Commits: tests f0598c9; código a42654f; ronda 2 (precarga de la tarjeta en el test) 3bbc3ef; fichas y cierre en los commits `docs(tasks)`.
- Ficheros principales: `scripts/notify-telegram.mjs` (guardar y leer `vigia-telegram-avisos.json` en `git rev-parse --git-common-dir`, `reply_parameters`), `scripts/notify-telegram.test.ts` (CA1 a CA5). Documentado en `docs/flujo.md`, ADR-0015, `CHANGELOG.md` y `BACKLOG.md`.
- Arreglo de CI (rama `fix/0106-ci`, commit f980d07): «CA5 (0106)» comparaba como texto la ruta corta 8.3 de `os.tmpdir()` del CI (`RUNNER~1`) con la larga que devuelve git. Ahora usa `fs.realpathSync.native` en los dos lados. Run 38276010784.
- Rondas de revisión: 3 (todas APROBADO; la tercera, el arreglo de CI). Verifier: VERDE.
- ADR nuevo: ninguno; completa el ADR-0015 (punto «Responder al aviso anterior»).
- Sin migraciones.
- Ideas al BACKLOG («Mejoras anotadas»): dos opcionales del revisor (carrera entre worktrees al guardar; recorte con un solo chat) y sospechosos de inestables solo con carga extrema.
