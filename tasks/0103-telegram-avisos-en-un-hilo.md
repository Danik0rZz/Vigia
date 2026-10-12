---
id: '0103'
titulo: Avisos de Telegram en un hilo del grupo
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0103-telegram-hilo
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#sendmessage; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12), primera parte de «avisos de
Telegram en imagen», con un prototipo probado fuera del repositorio:

- Destino: un grupo con hilos. El chat_id, en `VIGIA_TELEGRAM_CHAT_ID`, y el hilo, en una variable
  nueva (por ejemplo `VIGIA_TELEGRAM_THREAD_ID`). Se envía con `message_thread_id` y como respuesta
  al mensaje que abre el hilo. El bot tiene que ser administrador del grupo; si no, Telegram
  responde «message to be replied not found». Los valores reales los fija Dani con `setx`; no van al
  repositorio.

## Especificación

- Variable nueva de usuario de Windows, `VIGIA_TELEGRAM_THREAD_ID`, leída igual que las otras dos
  (del entorno o del registro, ADR-0009). Es opcional: sin ella, el aviso va al chat como hoy.
- Con la variable, `sendMessage` lleva `message_thread_id` con ese valor y
  `reply_parameters: { message_id: <el mismo valor>, allow_sending_without_reply: false }` (el
  mensaje que abre el hilo tiene ese id). Lo observado en el prototipo (2026-10-12): el grupo **no
  es un foro** (`is_forum: false`), son hilos de respuestas y no temas; solo con
  `message_thread_id` el mensaje cae en el chat principal, así que hace falta responder a un mensaje
  del hilo. Sin el bot como administrador, Telegram responde «message to be replied not found»
  incluso con mensajes escritos después de que entrara. El reintento sin hilo (abajo) deja el aviso
  en el chat principal. Los nombres de los campos, de la documentación oficial de
  `sendMessage` (https://core.telegram.org/bots/api#sendmessage); el developer los comprueba allí y
  anota la fecha en la ficha, como se hizo en el ADR-0009 con `link_preview_options`.
  Comprobado por el developer el 2026-10-12 en la documentación oficial: `sendMessage` tiene
  `message_thread_id` (Integer) y `reply_parameters` (ReplyParameters), y ReplyParameters tiene
  `message_id` (Integer) y `allow_sending_without_reply` (Boolean).
- El valor se valida antes de usarlo (un entero positivo); si no lo es, se envía sin hilo y se avisa
  en la terminal con el prefijo `[aviso telegram]`, sin el valor.
- Si Telegram rechaza el envío por el hilo (por ejemplo, el bot no es administrador), el script
  vuelve a intentarlo **una vez** sin hilo y lo dice en la terminal. Así el aviso llega aunque esté
  mal configurado el hilo, en línea con «nunca para el flujo». Dani (2026-10-12): el aviso siempre
  tiene que llegar; si no se puede enviar como se quería, va el de respaldo.
- El id del hilo se tapa en la salida como el chat_id (`redact`).
- `docs/flujo.md` («Avisos por Telegram», variables) y el README: la variable nueva, que el bot
  tiene que ser administrador del grupo y cómo se fija con `setx`, sin valores reales.

## Carril

Normal (`ligera: no`), con la exclusión `externos` (Telegram):

1. No añade componentes, funciones ni cálculos nuevos: falla, lee una variable nueva y añade el
   reintento sin hilo.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: falla, cambia lo que se envía a un servicio externo.
4. No hay ninguna decisión que preguntar a Dani: falla, el reintento sin hilo (contestada por Dani
   el 2026-10-12).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
Todos en `scripts/notify-telegram.test.ts`, sin red (`fetchImpl` simulado).

- CA1: con `VIGIA_TELEGRAM_THREAD_ID` con un entero positivo, el cuerpo de `sendMessage` lleva
  `message_thread_id` y `reply_parameters.message_id` con ese número (y
  `allow_sending_without_reply: false`); sin la variable, no lleva
  ninguno de los dos (como hoy).
- CA2: la variable se lee también del registro de Windows cuando no está en el entorno (como las
  otras dos).
- CA3: con un valor que no es un entero positivo, se envía sin hilo y la terminal dice
  `[aviso telegram]` sin el valor.
- CA4: si la respuesta con hilo es un error de Telegram, se hace un segundo envío sin
  `message_thread_id` ni `reply_parameters`, solo uno, y el script sale con 0 en los dos casos
  (el segundo envío bien o mal).
- CA5: el id del hilo no aparece en nada de lo que escribe el script (stdout y stderr), igual que el
  chat_id.

## Pruebas a mano para Dani

- Fijar `VIGIA_TELEGRAM_THREAD_ID` con `setx`, mandar un aviso de prueba y ver que llega al hilo.

## Fuera de alcance

- La tarjeta en imagen (0104) y responder al aviso anterior de la misma ficha (0105).
- Cambiar el texto del aviso.

## Ideas surgidas (fuera de alcance)

- (developer) `redact` tapa por subcadena: con un id de hilo corto (por ejemplo, de una o dos
  cifras), también taparía esas cifras en otros textos de la salida (`HTTP 400`). Es seguro pero
  estropea el mensaje; para ids numéricos se podría tapar solo el número completo.

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: los cinco CA tienen su test con el número en `scripts/notify-telegram.test.ts` y fallarían sin el código (CA1 y CA2: el cuerpo lleva `message_thread_id` y `reply_parameters`; CA3: una línea `[aviso telegram]` más que sin la variable; CA4: dos llamadas a `fetchImpl`, la segunda sin hilo; CA5: el id que Telegram repite en su respuesta sale tapado). `git diff e7e09b0..HEAD -- scripts/notify-telegram.test.ts` sale vacío.
- Implementación (`scripts/notify-telegram.mjs`): `parseThreadId` solo acepta dígitos y un entero seguro mayor que 0. La variable se lee con `credential`, del entorno o del registro (ADR-0009). Se reintenta una sola vez y solo si Telegram ha rechazado el envío (`rejected`), no con un error de red; está en «Resultado» y encaja con la especificación. Sale siempre con 0. El id válido y el valor leído entran en `redact` antes de cualquier salida, también en los errores de `sendTelegram`.
- API y externos: Bot API de Telegram, no Dynatrace. `message_thread_id`, `reply_parameters.message_id` y `allow_sending_without_reply` existen en `sendMessage`; comprobado el 2026-10-12 y anotado en la ficha. Sin IPC, esquema ni dependencias.
- Datos y documentación: valores de test inventados, nada del tenant ni secretos. README y `docs/flujo.md` explican la variable, que el bot tiene que ser administrador y `setx`, con marcadores. Comentarios en español, identificadores en inglés.

Opcional:

- `scripts/notify-telegram.mjs:13`: la línea de comentario de la cabecera pasa de unos 130 caracteres; conviene partirla como las vecinas.
- Un id de hilo corto taparía esas cifras en otros textos de la salida (p. ej. `HTTP 400`). Ya está en «Ideas surgidas»; al BACKLOG si se quiere arreglar.

## Verificación

Tests escritos en el commit `e7e09b0`, todos en `scripts/notify-telegram.test.ts` (por `main`, con
`fetchImpl` y registro simulados):

- CA1 → `describe('CA1 (0103): sendMessage con el hilo')` (con la variable y sin ella).
- CA2 → `describe('CA2 (0103): el hilo se lee también del registro')`.
- CA3 → `describe('CA3 (0103): un hilo que no es un entero positivo')` (`hilo-xyz`, `-48151`,
  `48151.5`, `48151abc`, `0`; exige una línea `[aviso telegram]` más que sin la variable).
- CA4 → `describe('CA4 (0103): si Telegram rechaza el envío por el hilo, se reintenta una vez sin hilo')`
  (segundo envío bien, con error de Telegram y con error de red; 200 con `ok: false`; sin reintento
  si el envío con hilo va bien o si no hay hilo).
- CA5 → `describe('CA5 (0103): el id del hilo no sale nunca')`.

Verificación 2026-10-12, commit 803ea75, rango main..feat/0103-telegram-hilo: VERDE

- check: 4238 tests (226 ficheros) en verde; cobertura ok (sentencias 92,98 %, ramas 90,13 %, funciones 90,37 %, líneas 93,75 %).
- e2e: `test:e2e:affected` no seleccionó ninguno (solo docs o tests unitarios; `scripts/` no tiene zona de e2e).

## Resultado

Commits: `e7e09b0` (tests), `0fc140c` (código), `0409b73` (documentación). Ficheros principales: `scripts/notify-telegram.mjs`, `scripts/notify-telegram.test.ts`, `README.md`, `docs/flujo.md`. Rondas de revisión: 1 (aprobada). ADR nuevo: no. Sin migraciones. Idea surgida pasada a «Mejoras anotadas» del BACKLOG.

Decisiones del developer:

- El reintento sin hilo solo se hace cuando Telegram responde con un error (`rejected` en lo que
  devuelve `sendTelegram`), no con un error de red o un tiempo agotado: ahí no es el hilo lo que
  falla y la ficha habla de que Telegram rechace el envío.
- Un valor de `VIGIA_TELEGRAM_THREAD_ID` inválido no entra en `redact` (no se usa ni se imprime, y
  taparlo, un «0», estropearía la salida); el válido sí, desde que se lee, antes de mirar el token.
- Entero positivo: solo dígitos y dentro de `Number.isSafeInteger` (`parseThreadId`).
