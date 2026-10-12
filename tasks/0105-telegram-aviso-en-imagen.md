---
id: '0105'
titulo: Enviar el aviso de Telegram como imagen, con pie de texto buscable
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: L # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos, seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0103', '0104'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0105-telegram-aviso-en-imagen
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: # el de la 0104; el doc-writer lo completa con la captura y el envío
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#sendphoto; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12), tercera parte de «avisos
de Telegram en imagen»:

- La tarjeta se captura con un navegador sin ventana y se manda con `sendPhoto`. El alto se mide
  cuando ha cargado todo.
- Pie en texto (`parse_mode` HTML): Estado con icono (🔄 En proceso, ⏸️ Pausa, ✅ OK, ⛔ Bloqueada),
  Título en negrita y subrayado, «Tarea: NNNN», y Ficha, PR y CI como enlaces; lo que no aplica no
  sale. Así se puede buscar y pulsar.
- Por decidir: el navegador (mejor el Chromium de Playwright que Edge), y que si falla la imagen se
  mande el aviso de texto de siempre (el aviso nunca para el flujo).

## Especificación

- **Navegador: Electron, el que ya está instalado** (decidido por Dani el 2026-10-12: además se ve
  como en la app). En esta máquina el Chromium de Playwright no está descargado (los e2e usan Electron), y
  descargarlo es una dependencia y un servicio externo más; Edge depende de cada máquina. Electron
  44 ya está fijado en `devDependencies` y tiene `webContents.capturePage()`. Un script aparte (por
  ejemplo `scripts/telegram-capture.cjs`) se lanza con el binario de Electron del proyecto: abre el
  HTML de la 0104 en una ventana oculta, mide el alto del contenido tras cargar, ajusta la ventana a
  ese alto y guarda el PNG en una carpeta temporal.
- **Ventana de la captura cerrada a todo:** `sandbox`, sin `nodeIntegration`, sin preload, todas las
  peticiones que no sean el propio documento o `data:` canceladas (`session.webRequest`), sin
  permisos (`setPermissionRequestHandler` que dice que no) y sin navegación ni ventanas nuevas. Si
  la medida necesita JavaScript, lo ejecuta el script de captura, no la página (que no lleva
  scripts, 0104).
- **Envío:** `sendPhoto` con `multipart/form-data` (`fetch` y `FormData` de Node, sin dependencias),
  con `photo`, `caption`, `parse_mode: "HTML"` y los campos del hilo de la 0103. Los nombres, de la
  documentación oficial de `sendPhoto`; el developer los comprueba allí y anota la fecha. Límites
  que da Telegram para fotos y que el developer confirma: hasta 10 MB, ancho más alto hasta 10 000
  px y proporción hasta 20; el pie, hasta 1 024 caracteres.
- **Pie (`caption`):** una línea por dato, lo que no aplica no sale:
  - `Estado: <icono> <texto>` (✅ OK para `hecha` y `cerrada`, ⏸️ Pausa para `parada`, ⛔
    Bloqueada para `bloqueada` y `fallida`, 🔄 En proceso para `en_proceso`).
  - El título, en `<b><u>…</u></b>`.
  - `Tarea: NNNN` (o `Versión: X.Y.Z`).
  - `Ficha`, `PR` y `CI` como `<a href>`: la ficha, al fichero en GitHub de la rama `rama` si viene
    y, si no, de `main`; la PR, de `pr`; el CI, de `ci`. Solo URLs `https://github.com/` del
    repositorio; cualquier otra no se pone.
  - Todo escapado para el HTML de Telegram (`<`, `>`, `&`, y las comillas en los atributos).
- **Imagen alta, en partes** (decidido por el Planificador, porque Dani quiere detalle sin recortar
  y Telegram tiene límites): Telegram reduce las fotos grandes y una tarjeta muy alta se leería mal
  en el móvil. Si la tarjeta pasa de un alto máximo (el developer lo fija tras comprobar en la
  documentación cómo reduce Telegram las fotos y lo anota; orientativo, 2 560 px), el script de
  captura la parte entre bloques (las marcas de la 0104), nunca por la mitad de un bloque, y se
  envían en orden: la primera con el pie y las demás como respuesta a la primera, con
  «(2/3)», «(3/3)» en su pie. Un bloque que por sí solo pasa del máximo va en su propia parte.
- **El resumen, con detalle:** `tarea.md` y `cerrar-version.md` piden al Orquestador un resumen en
  Markdown con lo relevante (qué cambia, criterios y cómo se probaron, decisiones tomadas, ideas
  surgidas y lo que queda para Dani), no una línea, sin datos del tenant ni nombres de clientes.
- **Filtro del tenant:** el pie y todos los campos pasan por el filtro de hoy antes de capturar
  nada; si encuentra algo, no se envía ni la imagen ni el texto (como hoy).
- **Si falla la imagen** (no está Electron, la captura falla o tarda más de un tiempo máximo, la
  imagen se pasa de los límites o Telegram rechaza la foto), se envía el aviso de texto de siempre
  (`sendMessage`, ADR-0009) y se dice en la terminal con `[aviso telegram]`. El script sigue saliendo
  siempre con 0.
- **Se puede apagar:** con `VIGIA_TELEGRAM_TEXTO=1`, siempre el aviso de texto.
- `docs/flujo.md` («Avisos por Telegram») y `.claude/commands/tarea.md` y `cerrar-version.md`: los
  campos nuevos del JSON (`duracion`, `rama`, `pr`), que el aviso es una imagen con su pie y que el
  de texto queda de respaldo.

## Carril

Normal (`ligera: no`), con las exclusiones `externos` (Telegram) y `seguridad` (abre contenido de
los agentes en un navegador):

1. No añade componentes, funciones ni cálculos nuevos: falla, captura y envío nuevos.
2. No elimina nada visible para el usuario: cumple, el de texto se queda de respaldo.
3. No toca datos, API ni lógica: falla.
4. No hay ninguna decisión que preguntar a Dani: falla, el navegador (contestada por Dani el
   2026-10-12: Electron).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
En `scripts/`, sin red (`fetchImpl` simulado), salvo CA6, que usa Electron de verdad.

- CA1: `buildCaption(datos)` da las líneas de la especificación, en ese orden, con el icono de
  cada estado, el título en `<b><u>` y los enlaces de Ficha, PR y CI; sin `pr` ni `ci`, esas líneas
  no salen.
- CA2: un título con `<`, `>`, `&` y comillas sale escapado en el pie, y una URL de `ci` o `pr`
  que no es `https://github.com/<el repositorio>/…` no sale como enlace.
- CA3: con la captura bien, se llama a `sendPhoto` con `multipart/form-data`, la foto, el pie y
  `parse_mode: "HTML"`, y con los campos del hilo si está la variable de la 0103.
- CA4: si la captura falla, tarda más del máximo o la imagen se pasa de los límites, o si
  `sendPhoto` responde con error, se envía el texto de siempre con `sendMessage` y la salida es 0;
  cada caso, un test.
- CA5: con `VIGIA_TELEGRAM_TEXTO=1` no se captura nada y se envía el texto.
- CA6: el script de captura, con el Electron del proyecto y una tarjeta de prueba de la 0104, da un
  PNG válido (firma PNG), del ancho de la tarjeta y con el alto del contenido (más alto con un
  resumen largo que con uno corto).
- CA7: en la ventana de captura, una petición a una URL `https://` metida en la página no sale
  (queda cancelada) y la ventana tiene `sandbox` y no tiene `nodeIntegration`.
- CA8: con un hallazgo del filtro del tenant no se captura ni se envía nada, como hoy.
- CA9: con una tarjeta más alta que el máximo, el script de captura da varias imágenes, ninguna más
  alta que el máximo (salvo un bloque que solo ya lo pasa), y los cortes caen entre bloques: se
  comprueba con las posiciones de las marcas de la 0104. Con Electron de verdad, como CA6.
- CA10: con varias partes, se envía la primera con el pie entero y las siguientes como respuesta a
  la primera (`reply_parameters.message_id` con el que devolvió Telegram), con «(n/N)» en su pie y
  en orden; si falla una parte que no es la primera, las demás se siguen enviando y se dice en la
  terminal.
- CA11: `tarea.md` y `cerrar-version.md` piden el resumen en Markdown con lo relevante de la
  especificación. Test de texto.

## Pruebas a mano para Dani

- Mandar un aviso de prueba y ver en el móvil la imagen, el pie y que los enlaces se pulsan.
- Buscar en el grupo por «Tarea: NNNN» y que aparezca.

## Fuera de alcance

- Responder al aviso anterior de la misma ficha (0106) y las evidencias (0107 y 0108).
- Avisos en otros momentos (cada ronda, CI en rojo): ya está en «Mejoras anotadas».

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
