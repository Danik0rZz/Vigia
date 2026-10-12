---
id: '0105'
titulo: Enviar el aviso de Telegram como imagen, con pie de texto buscable
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: L # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos, seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0103', '0104'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0105-ci
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: '0015' # el de la 0104; el doc-writer lo completa con la captura y el envío
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#sendphoto; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 3
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
  HTML de la 0104 en una ventana oculta de 800 px a escala 2 (sale de 1600 px de ancho, como el
  prototipo), mide el alto con `document.documentElement.scrollHeight` en el evento `load` (después
  de que carguen las imágenes; medido antes sale menor, se vio en el prototipo), ajusta la ventana a
  ese alto, captura con `webContents.capturePage()` y guarda el PNG en una carpeta temporal.
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
  - `<b>Estado:</b> <icono> <texto>` (✅ OK para `hecha` y `cerrada`, ⏸️ Pausa, espera a Dani
    para `parada`, ⛔ Bloqueada para `bloqueada` y `fallida`, 🔄 En proceso para `en_proceso`). En
    el pie sí van emoji; en la imagen, símbolos de texto (0104).
  - `<b>Título:</b> <b><u>…</u></b>`.
  - `<b>Tarea:</b> NNNN` (o `<b>Versión:</b> X.Y.Z`).
  - `<b>Ficha:</b>`, `<b>PR:</b>` y `<b>CI:</b>` con sus enlaces (abajo).
  - `Ficha`, `PR` y `CI` como `<a href>`: la ficha, al fichero en GitHub de la rama `rama` si viene
    y, si no, de `main`; la PR, de `pr`; el CI, de `ci`. Solo URLs `https://github.com/` del
    repositorio; cualquier otra no se pone.
  - Todo escapado para el HTML de Telegram (`<`, `>`, `&`, y las comillas en los atributos).
- **Imagen alta, en partes** (decidido por el Planificador, porque Dani quiere detalle sin recortar
  y Telegram tiene límites): Telegram reduce las fotos grandes y una tarjeta muy alta se leería mal
  en el móvil. Si la tarjeta pasa de un alto máximo, el script de captura la parte. El developer
  fija ese máximo y lo anota, con los límites de la documentación (ancho más alto hasta 10 000 px,
  proporción hasta 20) y con lo que se lee en el móvil. Dato del prototipo: Telegram aceptó una foto
  de 1600×3750 px. Al partir, el script de
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

- CA1: `buildCaption(datos)` da las líneas de la especificación, en ese orden, con sus rótulos en
  `<b>`, el emoji y el texto de cada estado, el título en `<b><u>` y los enlaces de Ficha, PR y CI; sin `pr` ni `ci`, esas líneas
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
  PNG válido (firma PNG), de 1600 px de ancho (800 a escala 2) y con el alto del contenido, incluida
  una imagen `data:` de la tarjeta (no se mide antes de que cargue) (más alto con un
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

## Decisiones del developer

- **Documentación de `sendPhoto` comprobada el 2026-10-12** (https://core.telegram.org/bots/api#sendphoto):
  campos `chat_id`, `message_thread_id`, `photo`, `caption`, `parse_mode` y `reply_parameters`
  (JSON en multipart); foto de hasta 10 MB, ancho más alto hasta 10 000 px y proporción hasta 20;
  pie de 0 a 1 024 caracteres después de interpretar las entidades. El título del pie se corta a
  300 caracteres para no pasar nunca de ese límite.
- **Alto máximo de cada parte: 3 200 px de imagen** (1600 × 3200, proporción 2; `DEFAULT_MAX_HEIGHT`
  en `scripts/telegram-capture.cjs`): Telegram reduce las fotos a unos 2 560 px por el lado largo, y
  a 1 280 px de ancho la tarjeta se lee en el móvil. Tope duro de 8 400 px (ancho más alto 10 000):
  un bloque más alto que eso se corta, porque Telegram no lo aceptaría.
- **Multipart hecho a mano** (`multipart` en `notify-telegram.mjs`), no `FormData`: el `FormData` de
  Node cambia los saltos de línea de los campos por CRLF al enviarlo, y el pie tiene que llegar tal
  cual (CA3). Sigue sin dependencias.
- **Escala 2 con `force-device-scale-factor`** y captura por partes desplazando la página (la
  ventana, del alto de la parte más alta): no depende del alto de la pantalla.
- **Tiempo máximo de la captura: 45 s** (`CAPTURE_TIMEOUT_MS`); el script de captura se corta solo
  a los 60 s y se mata al pasar el tiempo.
- **Enlace de la ficha:** al fichero `tasks/NNNN-….md`, buscado en `tasks/` de la carpeta desde la
  que se lanza y en la del checkout del script; si no se encuentra, a la carpeta `tasks/`. Una
  `rama` con caracteres raros o `..` se cambia por `main`.
- **Primera parte rechazada en el hilo:** se reintenta una vez sin hilo, como el texto (0103); si
  tampoco, el texto de siempre.
- **Para el Orquestador (test de CA6, sin tocar):** el script de medida del test (`MEASURE` en
  `scripts/telegram-capture.test.ts`) mide a la escala de la pantalla. En una pantalla al 150 %
  (esta máquina) los bordes se ajustan a píxeles físicos y la tarjeta corta mide 419 px en lugar
  de 421, y CA6 falla por 4 px de imagen (tolerancia 3). A escala 1 forzada mide 421, igual que la
  captura a escala 2; en el CI (pantalla al 100 %) pasa. Arreglo propuesto para el test:
  `app.commandLine.appendSwitch('force-device-scale-factor', '1')` en `MEASURE`.

## Ideas surgidas (fuera de alcance)

- (developer) Con `estado: hecha`, la rama de la ficha ya la ha borrado GitHub al fusionar y el
  enlace de la ficha daría 404: `tarea.md` podría pedir `rama` vacía (main) en ese aviso.
- (developer) `.claude/agents/planner.md` también manda avisos: podría pedir el resumen en Markdown
  y los campos nuevos como `tarea.md`.

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios y tests.** CA1 a CA11 tienen su test con el número en el nombre y fallarían sin el código: el pie compara líneas exactas, CA2 prueba dominios parecidos y `javascript:`, CA4 un caso por cada fallo y CA7 levanta un servidor TCP local que cuenta conexiones. El developer no tocó los tests tras `ce821b4`; el único cambio posterior es `eb04939`, del test-writer, anotado en la ficha: `force-device-scale-factor=1` solo en el script de medida de los tests. No afloja el criterio: la tolerancia sigue igual (`TOL = 1.5`), la captura de verdad sigue a escala 2 y la referencia ya no depende del escalado de la pantalla.
- **Aislamiento de la captura (CA7), `scripts/telegram-capture.cjs`.** `sandbox: true`, `contextIsolation`, sin preload, `nodeIntegration` por defecto (falso). Sesión propia en memoria; `onBeforeRequest` cancela todo lo que no sea `data:` o el propio documento (comparado por ruta resuelta, así que los demás `file:` también se cancelan). Permisos denegados en petición y comprobación. Bloqueados `window.open`, `will-navigate`, `will-redirect`, `will-frame-navigate` y `will-attach-webview`, sin herramientas de desarrollo. Perfil temporal que se borra al salir y sin `ELECTRON_RUN_AS_NODE`. La medida la ejecuta el script, no la página.
- **Multipart de `sendPhoto` a mano (`scripts/notify-telegram.mjs`).** Separador con `randomUUID()`, no inyectable desde el pie; nombres con comillas y saltos escapados; `reply_parameters` como JSON. Campos de la documentación oficial de `sendPhoto`. Los errores pasan por `redact` (token, chat_id e hilo). El filtro del tenant cubre el pie y todos los campos de la tarjeta, incluidos `duracion`, `rama`, `pr` y `origen`, y actúa antes de capturar.
- **Decisiones del developer: razonables y documentadas.** 3 200 px por parte y tope duro de 8 400 px respetan los límites de Telegram; captura con tiempo máximo de 45 s y corte del script a los 60 s; reintento sin hilo de la primera parte como en la 0103. Comentarios en español, identificadores en inglés, sin dependencias nuevas. `flujo.md`, `tarea.md` y `cerrar-version.md` cumplen la especificación y CA11. Sin datos del tenant ni nombres de clientes.

Opcional (no bloquea):

1. `sendImage`: si la primera parte falla por tiempo agotado o red (no por rechazo de Telegram), se envía el texto; si la foto llegó tarde, el aviso sale dos veces. Aceptable porque el aviso nunca para el flujo; conviene anotarlo.
2. En la ventana de captura, `<link rel="dns-prefetch">` y `preconnect` no pasan por `webRequest`. Hoy no tiene efecto (la tarjeta escapa todo y su CSP es estricta). Para cerrarlo: `app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND')` en `telegram-capture.cjs`.

### Ronda 2 (arreglo de CI): APROBADO

- **Criterios:** el diff (`main..fix/0105-ci`) solo toca `scripts/telegram-capture.cjs` y la ficha. Los tests de CA6, CA7 y CA9 siguen como estaban: no se afloja ningún criterio; el fallo de CA7 se arregla en el código.
- **Aislamiento:** `webPreferences` igual (sandbox, `contextIsolation`, sin `nodeIntegration`, `webSecurity`, sin devTools ni webgl, partición en memoria), y también la cancelación en `onBeforeRequest`, los permisos denegados, `will-navigate`, `will-redirect`, `will-frame-navigate`, ventanas nuevas y `<webview>`. Lo único nuevo en la página es una propiedad no enumerable (`__vigiaCapturaFrames`) para marcar los fotogramas; si la página la manipula, como mucho la captura falla con error. Todo tiene tiempo máximo: `evaluate` 5 s, `waitFor` 15 s y el `SELF_TIMEOUT_MS` del proceso.
- **La causa encaja:** la página de CA7 intenta navegar con un `setTimeout`; si la navegación cancelada cae mientras `executeJavaScript` espera una promesa (`await document.fonts.ready`), no se resuelve nunca. Explica que fallara solo con la máquina cargada (CI de `main`). Con el arreglo, todo lo que se ejecuta en la página es síncrono y las esperas se hacen preguntando desde el script (`document.fonts.status === 'loaded'` y una marca tras dos `requestAnimationFrame`). La reproducción de la ficha (25 de 60 colgadas antes, 60 de 60 después, también navegando cada milisegundo) cuadra.
- **Legibilidad y datos:** comentarios en español, identificadores en inglés; los errores llegan a `fail` con solo su primera línea. Sin secretos ni datos del tenant.

Opcional: `document.fonts.status === 'loaded'` no es exactamente `document.fonts.ready`: justo tras `did-finish-load` podría estar en `loaded` antes de que empiece una fuente pedida tarde. En esta tarjeta (peticiones canceladas, fuentes locales o del sistema) no hay riesgo práctico; para más margen, exigir que la medida dé lo mismo en dos sondeos seguidos.

### Ronda 3 (arreglo de CI, segunda parte): APROBADO

- `git diff 95718b7..fix/0105-ci` (c1b6c34 y 83d0e73): el único cambio de código está en `scripts/notify-telegram-image.test.ts`, 6 líneas que precargan `telegram-card.mjs` con `await import()` al cargar el fichero. No cambia ninguna aserción, doble ni timeout de CA3: comprueba lo mismo (sendPhoto con multipart/form-data, foto, pie e hilo). Sin la precarga el test pasa igual, solo más lento: no tapa ningún fallo de lógica.
- La precarga se aprovecha: `notify-telegram.mjs:646` importa `./telegram-card.mjs` con ruta relativa, el mismo módulo, que se carga una vez.
- No oculta problemas del aviso real: la importación queda fuera de `withTimeout` (líneas 650-654), que solo envuelve `deps.capture`; una carga lenta no dispara el timeout de captura ni cambia el respaldo a texto. El aviso real se lanza una vez por proceso, sin requisito de latencia.
- Lo apuntado en la ficha se ajusta al diff. Sin datos del tenant ni secretos.

Opcional: los 4,3 s son con la transformación de Vitest; si preocupa lo que tarda el aviso en Node normal, medirlo aparte.

## Verificación

Tests escritos en `ce821b4` (fallan hasta que exista el código). Contrato que fijan (detalle en la
cabecera de cada fichero): `buildCaption` exportada de `notify-telegram.mjs`; `main` con
`deps.capture(html)` (promesa con los PNG en orden; sin ella, texto) y `deps.captureTimeoutMs`;
`electron scripts/telegram-capture.cjs --html <f> --out <dir> [--max-height <px de la imagen>]`, que
deja `parte-1.png`, `parte-2.png`… y sale con 0.

- CA1: `scripts/notify-telegram-image.test.ts`, «CA1 (0105): buildCaption da las líneas del pie».
- CA2: ídem, «CA2 (0105): escapado y enlaces solo al repositorio».
- CA3: ídem, «CA3 (0105): sendPhoto con la captura bien».
- CA4: ídem, «CA4 (0105): si falla la imagen, el texto de siempre» (falla, tiempo, 10 MB, ancho más
  alto, proporción y error de `sendPhoto`).
- CA5: ídem, «CA5 (0105): VIGIA_TELEGRAM_TEXTO=1» (con un control sin la variable).
- CA6: `scripts/telegram-capture.test.ts`, «CA6 (0105): captura con el Electron del proyecto».
- CA7: ídem, «CA7 (0105): la ventana de captura, cerrada» (servidor TCP local que cuenta conexiones y
  marca de `require`; y `sandbox: true` sin `nodeIntegration: true` en el fuente).
- CA8: `notify-telegram-image.test.ts`, «CA8 (0105): …» (título, rama, pr, duración y resumen).
- CA9: `telegram-capture.test.ts`, «CA9 (0105): …» (posiciones de `data-bloque` medidas con un
  Electron propio del test).
- CA10: `notify-telegram-image.test.ts`, «CA10 (0105): varias partes».
- CA11: ídem, «CA11 (0105): tarea.md y cerrar-version.md piden el resumen en Markdown…».
- Arreglo del test (ronda de revisión): el script de medida de CA6 y CA9 fuerza
  `force-device-scale-factor` a 1; con la escala de la pantalla (150 %) medía 419 px CSS en vez de 421. CA6, CA7 y CA9 pasan en esta máquina.

Verificación 2026-10-12, commit f4f5994, rango main..feat/0105-telegram-aviso-en-imagen: VERDE

- check: 229 ficheros, 4304 tests, cobertura dentro del umbral. En el primer pase falló por timeout de 5 s «CA3 (0105)» (`scripts/notify-telegram-image.test.ts`, multipart/form-data); aislado ×3 con los 37 tests del fichero pasó siempre (~0,7 s) y un segundo `npm run check` completo salió verde. Intermitente, probablemente por la carga de la máquina con 229 ficheros a la vez; si se repite, subir su timeout o revisar el servidor local que levanta.
- e2e: `test:e2e:affected`, un único pase: 370 pasan, ninguno falla (1,6 min).
- No se envió nada a Telegram.

Verificación del arreglo de CI 2026-10-12, commit c941fdb, rango main..fix/0105-ci: VERDE

- check: 4323 tests (231 ficheros) en verde; cobertura ok (sentencias 92,98 %, ramas 90,13 %, funciones 90,37 %, líneas 93,75 %).
- e2e: `test:e2e:affected` no seleccionó ninguno (solo `scripts/` y la ficha).
- Con carga: `scripts/telegram-capture.test.ts` y `scripts/notify-telegram-image.test.ts` en dos tandas en paralelo, 6 y 12 ejecuciones a la vez: las 18 con salida 0 y 41 tests cada una, sin fallos ni timeouts.
- No se envió nada a Telegram y no quedaron procesos en segundo plano.

## Resultado

- Commits: `ce821b4` y `790b288` (tests), `4d9b502` (código), `0ad9c04` (flujo y comandos), `eb04939` (medida a escala 1). Rondas de revisión: 1 (APROBADO). Verificación en verde.
- Ficheros principales: `scripts/notify-telegram.mjs`, `scripts/telegram-capture.cjs`, `scripts/notify-telegram-image.test.ts`, `scripts/telegram-capture.test.ts`, `docs/flujo.md`, `.claude/commands/tarea.md` y `cerrar-version.md`.
- ADR: completado el ADR-0015 (captura y envío). Sin migraciones.
- Ideas y sospechosos pasados al BACKLOG: aviso duplicado si la foto llega tarde, `host-resolver-rules`, rama vacía con `hecha`, aviso del Planificador y el timeout de «CA3 (0105)».

### Arreglo del CI de main (rama `fix/0105-ci`)

- **Fallo:** en el CI de main tras la PR #32 (run 38264967328, Windows), «CA7 (0105): las
  peticiones https:// metidas en la página no salen…» agotó el tiempo de la captura (60 s) dos
  veces seguidas; en la PR y en local pasaba.
- **Causa:** no era el evento `load` (la hipótesis del Orquestador): `did-finish-load` llegaba
  siempre. La página de CA7 intenta navegar (`location.href` en un `setTimeout`) y, con la máquina
  cargada, el intento cae mientras `executeJavaScript` espera la promesa de la medida
  (`await document.fonts.ready`). La navegación se cancela bien, pero Electron no resuelve nunca esa
  promesa, ni las de las llamadas siguientes que devuelven promesas; las síncronas sí responden.
  Reproducido aquí con 12 capturas a la vez: 25 de 60 se colgaban (y 29 de 60 con reintentos).
- **Arreglo** (`2f5853a`, `scripts/telegram-capture.cjs`): todo lo que se ejecuta en la página es
  síncrono y con tiempo máximo (`evaluate`, 5 s); las esperas (fuentes cargadas y dos fotogramas
  tras desplazar) se hacen preguntando desde el script cada 25 ms (`waitFor`, 15 s como mucho).
  Con la misma carga, 60 de 60 capturas bien (y 60 de 60 con una página que intenta navegar cada
  milisegundo). El aislamiento de la ventana no cambia (sandbox, sin `nodeIntegration`, peticiones
  canceladas, sin navegación); los tests no se han tocado.
- **Comprobado:** `scripts/telegram-capture.test.ts` (CA6, CA7 y CA9) 10 veces seguidas en verde;
  `npm run check` en verde (4 323 tests); `test:e2e:affected` main..HEAD: ningún e2e afectado.
- **Timeout de «CA3 (0105): multipart/form-data…»** (`c1b6c34`, solo el test): era el primero que
  envía la foto y pagaba la carga en frío de `telegram-card.mjs` (React, react-markdown,
  highlight.js), que el script importa la primera vez que la necesita: 4,3 s aislado, más de 5 s
  con carga. El fichero de tests ahora precarga la tarjeta antes de los tests; CA3 baja a unos
  40 ms y comprueba lo mismo. No es un fallo del código. 18 ejecuciones del fichero (6 a la vez,
  3 veces) en verde y `npm run check` en verde.

- **Cierre del arreglo:** `fix/0105-ci`, rondas de revisión: 3 (APROBADO), verificación en verde. Ficheros: `scripts/telegram-capture.cjs` y `scripts/notify-telegram-image.test.ts`. Sin ADR nuevo ni migraciones. El «CA3 (0105)» sale de los sospechosos del BACKLOG; opcionales del reviewer y la mejora del flujo, en «Mejoras anotadas».
