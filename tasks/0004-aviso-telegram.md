---
id: '0004'
titulo: Aviso por Telegram al terminar /tarea o /cerrar-version
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0004-aviso-telegram
adrs: [7]
adr_nuevo: Avisos del flujo de agentes por Telegram (servicio externo, opcional y filtrado)
api: ninguna de Dynatrace. Telegram Bot API, método `sendMessage` (https://core.telegram.org/bots/api#sendmessage)
migracion: no
rondas_revision: 1
---

## Petición original

Aviso por Telegram al terminar una tarea o una versión. Dani quiere recibir un mensaje en Telegram
cada vez que termine `/tarea` o `/cerrar-version`, con un resumen de lo hecho.

- Cuándo: `/tarea` integrada y con push a `main`; `/tarea` que acaba en `bloqueada` tras 3 rondas;
  `/tarea` que se para por un ROJO del verifier que no se resuelve; `/tarea` que se para porque
  hace falta una decisión de Dani (por ejemplo un `[ALCANCE]`); fin de `/cerrar-version`, salga
  bien o no.
- Qué lleva: número y título de la ficha, estado final, resumen del briefing del doc-writer,
  rondas de revisión, resultado del verifier, enlace al CI si lo hay y, si está parada, qué decisión
  se espera de Dani. En español, corto, legible en el móvil.
- Cómo: un script del repo (`scripts/notify-telegram.mjs`) que llama a `sendMessage` de la Bot API.
  Token y chat_id en variables de entorno del usuario de Windows (`VIGIA_TELEGRAM_TOKEN` y
  `VIGIA_TELEGRAM_CHAT_ID`), nunca en el repo, en logs ni en mensajes de error. `/tarea` y
  `/cerrar-version` añaden el paso que lo llama.
- Si falla: sin variables, aviso en la terminal y la tarea no falla. Si Telegram no responde, un
  error visible sin el token y el flujo sigue.
- Seguridad: antes de enviar, el texto pasa por el filtro de restos del tenant con las mismas reglas
  que `scan:tenant`; si encuentra algo, no se envía y se avisa. Nada del tenant ni nombres de
  clientes.
- Tests unitarios con `fetch` simulado: envío correcto, variables ausentes, error de red, bloqueo por
  restos del tenant y el token en ninguna salida.
- Fuera de alcance: recibir órdenes o lanzar tareas desde Telegram (se estudiará aparte).
- Manual: que llega un mensaje real al móvil tras una tarea.

Dani ya ha fijado las dos variables en su usuario de Windows con `setx`.

## Especificación

**Decisión de Dani:** enviar avisos a un servicio externo (Telegram) es "publicar algo nuevo hacia
fuera" (`docs/flujo.md`, "Quién decide"); lo pide Dani y la ficha la aprueba Dani. Dani la aprobó el 2026-10-06 con la
propuesta para cuando no hay `.env.live.local` (se envía y se avisa).

**1. Script `scripts/notify-telegram.mjs`** (ESM, sin dependencias nuevas; `fetch` de Node).

- Uso: `node scripts/notify-telegram.mjs <ruta-a-un-json>`. El Orquestador escribe el JSON en su
  scratchpad. Campos (todos texto salvo `rondas`):
  `tipo` (`tarea` | `version`), `ficha` (número, en `tarea`), `titulo`, `version` (en `version`),
  `estado` (por ejemplo `hecha`, `bloqueada`, `parada`, `cerrada`, `fallida`), `resumen`, `rondas`
  (número), `verifier` (`VERDE` | `ROJO` | `sin pasar`), `ci` (URL o vacío), `decision`
  (qué se espera de Dani, o vacío).
- Lógica en funciones exportadas y puras, como `scan-tenant.mjs` (para los tests):
  `buildMessage(datos)`, `checkTenantLeftovers(texto, needles)` y
  `sendTelegram({ token, chatId, text, fetchImpl })`. `main(argv, deps)` las une y **siempre
  sale con 0**: el aviso es opcional y nunca para el flujo. Lo que pasa se dice en la terminal
  (stderr) con un prefijo `[aviso telegram]`.
- **Mensaje:** texto plano (sin `parse_mode`, así nada del resumen se interpreta como formato),
  como mucho **1 500 caracteres** (si el resumen no cabe, se recorta con «…»). Orden:
  1. Una línea con icono y lo esencial: `✅ 0004 · <título> — hecha` / `⛔ … — bloqueada` /
     `⏸ … — parada: decisión de Dani` / `📦 v0.11.0 — cerrada` / `❌ v0.11.0 — fallida`.
  2. `Rondas: N · Verifier: VERDE`.
  3. Si hay `decision`: `Decide Dani: <texto>`.
  4. El resumen.
  5. Si hay `ci`: la URL.
- **Credenciales:** de `process.env`. Si faltan y es Windows, de las variables de usuario del
  registro (`reg query HKCU\Environment /v <nombre>`), porque `setx` solo llega a los procesos que
  se abren después y las sesiones de Claude Code ya abiertas no las ven. Sin ellas: aviso
  «sin VIGIA_TELEGRAM_TOKEN o VIGIA_TELEGRAM_CHAT_ID: no se envía» y salida 0.
- **El token no sale nunca:** ni en stdout, ni en stderr, ni en el texto de un error (la URL de la
  Bot API lo lleva dentro: `https://api.telegram.org/bot<token>/sendMessage`). Todo texto que se
  imprime pasa antes por una función que sustituye el token y el chat_id por `***`. El chat_id
  tampoco se imprime.
- **Envío:** `POST` a `sendMessage` con JSON `{ chat_id, text, disable_web_page_preview: true }`,
  con un tiempo máximo de 10 s (`AbortSignal.timeout`). Un 200 con `ok: true` es éxito; cualquier
  otra cosa (código, `ok: false`, tiempo agotado, error de red) es un aviso con el código o el
  `description` de Telegram (filtrados), y salida 0.
- **Filtro del tenant:** reutiliza `extractNeedles` de `scripts/scan-tenant.mjs` sobre
  `.env.live.local`, que se busca en el directorio actual y, si no está, en el checkout principal
  (primera entrada de `git worktree list`). La comparación, sin mayúsculas, como en `scan:tenant`.
  Si hay coincidencia: no se envía y se avisa con el **tipo** de coincidencia (nunca el valor).
  Sin `.env.live.local`: se envía, igual que `scan:tenant` pasa sin él (no hay nada con qué
  comparar), y se avisa en la terminal de que no se ha podido filtrar.
- Nunca lee ni imprime el contenido de `.env.live.local` más allá de lo que hace `scan-tenant.mjs`.

**2. Comandos.**

- `.claude/commands/tarea.md`: un paso «Aviso» que llama al script en estos puntos:
  - tras el push del paso 9 (y con el enlace del CI del paso 10): `estado: hecha`;
  - al quedar `bloqueada` (tres rondas sin aprobar, también cuando la última fue un ROJO del
    verifier): `estado: bloqueada`, con el motivo en `resumen` y `verifier` con su último
    resultado;
  - al pararse esperando a Dani (un `[ALCANCE]` que no está delegado, o cualquier "para y
    pregunta"): `estado: parada`, con la pregunta en `decision`. Si el `[ALCANCE]` lo decide el
    Planificador por delegación, no se avisa (no espera a Dani).
- `.claude/commands/cerrar-version.md`: el aviso al final, `cerrada` (con la ruta del zip no: es una
  ruta local; basta el número de versión y el CI) o `fallida` (ROJO del verifier u otra parada,
  con el motivo).
- El `resumen` lo redacta el Orquestador a partir del briefing del doc-writer, en pocas líneas y
  sin datos del tenant ni nombres de clientes (el filtro es la red de seguridad, no la única
  defensa: no conoce los nombres de clientes).
- `.claude/settings.json`: permiso `Bash(node scripts/notify-telegram.mjs *)` (y su equivalente
  `PowerShell(…)`) para que el aviso no pida confirmación.

**3. Documentación** (doc-writer): sección corta en `docs/flujo.md` (qué avisa, variables, que es
opcional y cómo probarlo), ADR nuevo, y una nota en el README de cómo fijar las variables con
`setx` y que hay que abrir una terminal nueva (o confiar en la lectura del registro).

**4. Primer envío real.** Al cerrar la tarea, el Orquestador manda un aviso de prueba con el
propio script (`estado: hecha` de esta ficha, el aviso normal del paso 10). Si llega al móvil,
Dani lo confirma (prueba a mano).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
Todos en `scripts/notify-telegram.test.ts`, con `fetch` simulado y sin red.

- CA1: con token, chat_id y datos de una tarea hecha, se hace un único `POST` a
  `https://api.telegram.org/bot<token>/sendMessage` con `chat_id`, `text` y
  `link_preview_options: { is_disabled: true }` (sin `disable_web_page_preview`, que ya no está en
  la Bot API; cambio de la ronda 1, aprobado por Dani el 2026-10-07), y el resultado es éxito.
- CA2: `buildMessage` produce, para `hecha`, `bloqueada`, `parada` (con `decision`), `cerrada` y
  `fallida`, la primera línea con su icono, número o versión, título y estado (también en las
  versiones: `📦 v0.11.0 · <título> — cerrada`); la línea de rondas y verifier; `Decide Dani:` solo
  si hay `decision`; y la URL del CI solo si hay `ci`.
- CA3: un resumen largo deja el mensaje en 1 500 caracteres como mucho, acabado en «…», sin
  perder la primera línea ni la del CI.
- CA4: sin `VIGIA_TELEGRAM_TOKEN` o sin `VIGIA_TELEGRAM_CHAT_ID` (ni en el entorno ni en el
  registro simulado), no se llama a `fetch`, se avisa en stderr y `main` devuelve 0.
- CA5: si faltan en `process.env` pero el registro simulado las tiene, se envía con ellas.
- CA6: un error de red, un tiempo agotado, un HTTP 401 y un 200 con `ok: false` acaban en aviso
  en stderr y `main` devuelve 0.
- CA7: si el texto contiene un valor que `extractNeedles` saca de un `.env` de prueba (inventado),
  no se llama a `fetch`, se avisa con el tipo de coincidencia y el valor no sale en ninguna salida.
- CA8: sin `.env.live.local` en el directorio ni en el checkout principal, se envía y se avisa de
  que no se ha filtrado.
- CA9: en todos los casos anteriores (también cuando el error simulado lleva la URL con el token
  dentro o un `description` que lo repite), ni el token ni el chat_id aparecen en stdout, stderr ni
  en el valor que devuelve `main`.
- CA10: un JSON de entrada que no existe o no es válido acaba en aviso y `main` devuelve 0, sin
  llamar a `fetch`.
- CA11: `.claude/commands/tarea.md` y `.claude/commands/cerrar-version.md` contienen el paso que
  llama a `node scripts/notify-telegram.mjs` en cada punto de la especificación (hecha, bloqueada,
  parada; cerrada y fallida), y `.claude/settings.json` lo permite. (Test que lee los ficheros y
  busca la llamada y los estados.)
- CA12 (ronda 1, aprobado por Dani): el filtro del tenant se aplica también a los campos completos
  (`titulo`, `resumen`, `decision`, `ci`) antes de recortar. Un valor del `.env` de prueba que el
  recorte a 1 500 caracteres partiría por la mitad bloquea el envío igual (no se llama a `fetch`).
- CA13 (ronda 1, aprobado por Dani): en Windows, la lectura del registro ejecuta `reg.exe` por su
  ruta absoluta (`%SystemRoot%\System32\reg.exe`), nunca por nombre, con los argumentos en array y
  sin shell.

## Pruebas a mano para Dani

- Tras esta tarea (o la siguiente), llega un mensaje real al móvil, se lee bien y no lleva nada del
  tenant ni de clientes.
- Con las variables quitadas un momento, una tarea termina igual, con el aviso en la terminal.

## Fuera de alcance

- Recibir órdenes desde Telegram o lanzar tareas desde allí (Remote Control o Channels, aparte).
- Avisos de otros momentos (cada ronda de revisión, CI en rojo después del push).
- Formato enriquecido (Markdown o HTML de Telegram), botones o adjuntos.
- Filtrar nombres de clientes de forma automática (no hay una lista en el repositorio que se pueda
  usar; lo evita el Orquestador al redactar el resumen).
- Cambios en la app Vigía.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO, con cambios aceptados por Dani para una ronda 2

- Criterios: los 11 CA con su test; los tests no cambian después de `1380222`. Diff limitado al script,
  los dos comandos, `settings.json` (solo las dos reglas allow) y la ficha.
- Seguridad: toda salida pasa por `redact` (split/join, sin regex): token, su parte tras `:` y
  chat_id. De los errores solo la primera línea de `message`, sin stack ni `cause`. El filtro mira el
  mensaje que se envía y solo imprime el `kind`. `.env.live.local` se lee como en `scan-tenant.mjs`;
  si falla, no se envía. `reg` y `git` con `execFileSync`, argumentos en array y sin shell.
- API: contrastada de memoria. El Orquestador la comprobó en https://core.telegram.org/bots/api
  (2026-10-07): `sendMessage` ya no lista `disable_web_page_preview`; se usa
  `link_preview_options` (`LinkPreviewOptions.is_disabled`).
- Sugerencias que Dani aceptó (2026-10-07) para la ronda 2:
  1. [ALCANCE] `link_preview_options: { is_disabled: true }` en lugar de `disable_web_page_preview` (CA1).
  2. [Seguridad] Filtrar también los campos completos antes de recortar (CA12).
  3. [Seguridad] `reg.exe` por ruta absoluta (CA13).
  4. [Legibilidad] El título también en la primera línea de las versiones (CA2).

## Verificación

Tests escritos en `1380222` (test-writer, antes del código), todos en
`scripts/notify-telegram.test.ts`.

Firmas que fijan los tests (la ficha no las daba):

- `buildMessage(datos)` devuelve un string. En `version`, el campo `version` va sin «v»
  (`0.11.0`). Desde la ronda 2, la primera línea de una versión lleva el título
  (`📦 v0.11.0 · <título> — cerrada`).
- `readRegistry(nombre, { execFile, env })` exportada (ronda 2, CA13): `execFile(fichero, args,
opciones)` hace de `execFileSync` (devuelve la salida de texto de `reg.exe`) y `env` de
  `process.env` (de él sale `SystemRoot`). Devuelve el valor de `REG_SZ` o `undefined` si
  `execFile` lanza; no lanza.
- `checkTenantLeftovers(texto, needles)` devuelve la lista de tipos (`kind`) que coinciden; vacía
  si no hay nada.
- `sendTelegram({ token, chatId, text, fetchImpl })` no lanza: devuelve `{ ok: true }` o
  `{ ok: false, error }` (sin token ni chat_id en `error`). Envía con cabecera
  `content-type: application/json` y un `signal` (`AbortSignal`).
- `main(argv, deps)` (síncrona o asíncrona) devuelve 0. `argv[0]` es la ruta del JSON.
  `deps = { env, platform, readRegistry(nombre), cwd, mainCheckout(), fetchImpl, stdout(texto), stderr(texto) }`:
  `env` en lugar de `process.env`; `readRegistry` en lugar de `reg query HKCU\Environment`
  (string, undefined o su promesa; solo con `platform: 'win32'`); `.env.live.local` se busca en
  `cwd` y si no en `mainCheckout()` (ruta del checkout principal o undefined); los avisos van por
  `deps.stderr` (los tests también recogen `console.*` y `process.std*.write`).
- Textos comprobados: prefijo `[aviso telegram]`; «sin VIGIA_TELEGRAM_TOKEN o
  VIGIA_TELEGRAM_CHAT_ID: no se envía»; aviso de no filtrado que contenga «filtr»; el tipo de
  coincidencia (`host` o `id-de-entorno`) al bloquear.
- CA11: los estados se buscan a 6 líneas o menos de una mención de `notify-telegram.mjs`; en
  `tarea.md`, también la palabra `decision`. Permisos exactos `Bash(node scripts/notify-telegram.mjs *)`
  y `PowerShell(node scripts/notify-telegram.mjs *)`.

Criterio → test (`describe` con el número):

- CA1: `CA1 (0004): envío correcto` (sendTelegram y main).
- CA2: `CA2 (0004): buildMessage` (cinco estados, línea 2, `Decide Dani:` y CI).
- CA3: `CA3 (0004): longitud máxima`.
- CA4: `CA4 (0004): sin credenciales` (sin token, sin chat_id, sin ninguna).
- CA5: `CA5 (0004): credenciales del registro`.
- CA6: `CA6 (0004): fallos del envío` (red, tiempo agotado, 401, `ok: false`).
- CA7: `CA7 (0004): filtro de restos del tenant` (directorio actual y checkout principal).
- CA8: `CA8 (0004): sin .env.live.local`.
- CA9: `CA9 (0004): el token y el chat_id no salen nunca` (todos los escenarios anteriores, más el
  error con la URL y un `description` que repite token y chat_id).
- CA10: `CA10 (0004): JSON de entrada` (inexistente, no válido, sin argumento).
- CA11: `CA11 (0004): pasos en los comandos y permiso`.
- CA12: `CA12 (0004): filtro sobre los campos completos, antes de recortar` (el valor en 61
  posiciones alrededor del recorte, con un test que comprueba que en alguna queda partido, y en
  `titulo`, `decision` y `ci`).
- CA13: `CA13 (0004): lectura del registro con reg.exe por ruta absoluta` (con `SystemRoot`
  inventado, `D:\WinFalso`).

Ejecución antes del código: 64 tests, 64 fallan; 60 por «No existe scripts/notify-telegram.mjs» y
los 4 de CA11 porque los comandos y `settings.json` aún no tienen el paso.

Ronda 2 (tests en `19ad163`, CA1, CA2, CA12 y CA13): sobre el código de la ronda 1, 73 tests, 9
fallan por lo esperado. CA1 ×2 por el cuerpo, que aún lleva `disable_web_page_preview`; CA2 ×3
porque las versiones van sin título; CA12 ×1 porque, con el valor partido en la posición 1370, se
envía; CA13 ×3 porque `readRegistry` no está exportada.

Decisiones del developer (código en `8dcce79` y `286649b`; los 64 tests pasan):

- Un `.env.live.local` sin valores cuenta como "no se ha podido filtrar" (se envía y se avisa),
  igual que `scan:tenant` avisa de que su revisión no está activa.
- `redact` tapa el token entero, su parte tras `:` y el chat_id; sin credenciales leídas no hay nada
  que tapar. El chat_id nunca se imprime, ni siquiera en el aviso de éxito.
- El JSON se rechaza (aviso y 0) si no es un objeto o `tipo` no es `tarea` ni `version`; el resto de
  campos ausentes salen vacíos. Un estado sin icono propio lleva `•`. El `version` se escribe con
  una sola «v» aunque venga con ella.
- Las credenciales se leen antes del filtro: sin ellas no se lee `.env.live.local`.

Ronda 2 (developer, código en `47259b9`; los 73 tests pasan):

- El filtro mira el mensaje y todos los campos de texto del JSON sin recortar (`ficha`, `titulo`,
  `version`, `estado`, `resumen`, `rondas`, `verifier`, `ci` y `decision`).
- La ruta de `reg.exe` sale de `SystemRoot` (si no está, de `windir`). Si no hay ninguna de las dos,
  no se lee el registro: nunca se llama a `reg` por nombre.
- Una versión sin `titulo` deja la primera línea como antes (`📦 v0.11.0 — cerrada`).

## Resultado

(pendiente)
