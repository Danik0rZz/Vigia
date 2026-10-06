# ADR-0009: Avisos del flujo de agentes por Telegram

Estado: aceptado (2026-10-07). Ficha: 0004

## Contexto

Dani quiere enterarse en el móvil de cuándo termina `/tarea` o `/cerrar-version` (bien, bloqueada,
parada esperando una decisión suya o fallida), sin estar delante de la terminal. Enviar texto a un
servicio externo es "publicar algo nuevo hacia fuera" (`docs/flujo.md`): lo pidió y lo aprobó Dani.
El repositorio es público y nada del tenant de pruebas ni nombres de clientes puede salir de la
máquina; las credenciales del bot son un secreto más.

## Decisión

- Un script del repositorio, `scripts/notify-telegram.mjs` (Node, `fetch`, sin dependencias
  nuevas), que el Orquestador llama desde los comandos `/tarea` y `/cerrar-version` con un JSON en
  su scratchpad. Usa `sendMessage` de la Telegram Bot API, en texto plano (sin `parse_mode`) y con
  1 500 caracteres como mucho.
- **Opcional y nunca para el flujo:** el script siempre sale con 0. Sin credenciales, con un error
  de red, un tiempo agotado (10 s) o una respuesta de error de Telegram, avisa en la terminal con el
  prefijo `[aviso telegram]` y el flujo sigue.
- **Credenciales fuera del repositorio:** `VIGIA_TELEGRAM_TOKEN` y `VIGIA_TELEGRAM_CHAT_ID`, del
  entorno o, en Windows, de las variables de usuario del registro (`reg.exe` por ruta absoluta desde
  `%SystemRoot%`, sin shell), porque `setx` no llega a las sesiones ya abiertas.
- **El token no sale nunca:** toda salida pasa por una función que tapa el token (entero y su parte
  tras `:`) y el chat_id; de los errores solo se imprime la primera línea, sin pila ni causa. El
  chat_id tampoco se imprime.
- **Filtro del tenant antes de enviar:** las mismas reglas que `scan:tenant` (`extractNeedles` sobre
  `.env.live.local`, buscado en el directorio actual y en el checkout principal), sobre el mensaje y
  sobre todos los campos completos antes de recortar. Si hay coincidencia, no se envía y se avisa
  con el tipo, nunca con el valor. Sin `.env.live.local` se envía y se avisa de que no se ha podido
  filtrar. El filtro es la red de seguridad: el resumen lo redacta el Orquestador sin datos del
  tenant ni nombres de clientes, que el filtro no conoce.
- **Sin vista previa de enlaces:** `link_preview_options: { is_disabled: true }`. La primera versión
  usaba `disable_web_page_preview`, que ya no figura en `sendMessage`; se comprobó en la
  documentación oficial (https://core.telegram.org/bots/api#sendmessage) el 2026-10-07 y se cambió
  en la ronda 1, con el visto bueno de Dani.

## Alternativas descartadas

- Credenciales en un fichero del repositorio o en `.env`: el repositorio es público y los agentes
  tienen denegado leer `.env*`.
- Que un fallo del aviso pare la tarea: el aviso es una comodidad, no una puerta de calidad.
- Formato Markdown o HTML de Telegram: un resumen con `_` o `*` se interpretaría como formato o
  haría fallar el envío.
- Recibir órdenes desde Telegram: fuera de alcance; se estudiará aparte.
- Avisar desde el CI: sus logs son públicos y no lleva secretos.

## Consecuencias

- Dani recibe un mensaje corto al final de cada tarea o versión, con la decisión que se espera de
  él si la tarea está parada.
- Cada clon o máquina que quiera avisos necesita las dos variables; sin ellas todo funciona igual.
- Un cambio en la Bot API puede romper el envío sin que nada falle: solo se ve el aviso en la
  terminal.
- Los nombres de clientes no se filtran de forma automática: depende de cómo redacta el
  Orquestador el resumen.
