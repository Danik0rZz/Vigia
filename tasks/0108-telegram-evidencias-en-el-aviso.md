---
id: '0108'
titulo: Evidencias visuales en el aviso de ficha hecha
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos, seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0105', '0107'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0108-telegram-evidencias
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: '0015' # el de la 0104; completado con las evidencias
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#sendphoto; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12), segunda parte de
«evidencias visuales en el aviso final»: el aviso de «hecha» lleva las capturas de los e2e
**dentro de la misma imagen**, en una sección «Evidencias», cada una con su criterio debajo
(«CA1 (0018) · …»). Una sola tarjeta.

## Especificación

- Campo nuevo y opcional del JSON del aviso, `evidencias`: la ruta del `manifiesto.json` de la 0107.
  Lo pone el Orquestador con la ruta que da el verifier, solo en el aviso de `hecha`.
- La tarjeta de la 0104 gana una sección «Evidencias», debajo del resumen y antes del pie. Por
  cada evidencia del manifiesto: la captura de la zona y la de la ventana entera, a lo ancho de la
  tarjeta (sin agrandarlas si son más pequeñas), y debajo, a la izquierda,
  «CA1 (0018) · <título del test sin el prefijo>» y la `nota` si la hay. Las imágenes van como
  `data:` (la CSP de la 0104 ya lo permite). Diseño del prototipo: cada captura a todo el ancho,
  con borde `#26303b` y radio 10 px; debajo, «CA1 (0018)» en el acento (`#D97757`) con peso 650,
  « · » y el texto en `#cfd8e1` a 15 px; 16 px entre capturas. Si el manifiesto dice
  `estable: false` (0107), debajo de esa evidencia sale «captura tomada con movimiento». Cada evidencia es un bloque (marca de la 0104), para
  que la 0105 parta la imagen entre evidencias y no por la mitad de una.
- **Todas las evidencias, sin tope** (Dani, 2026-10-12): «es la prueba empírica de que está todo
  ok; no puede ni debe tener falta de detalles». Zona y ventana, y todas las que haya. Si no caben
  en una imagen, van en las partes de la 0105.
- **Solo ficheros de la 0107:** el manifiesto y las imágenes tienen que estar dentro de
  `test-results/evidencias/` del repositorio (rutas resueltas, sin `..` ni enlaces fuera) y ser PNG
  (firma); lo demás se ignora y se dice en la terminal. Los títulos del manifiesto pasan por el
  filtro del tenant como el resto de campos.
- **Límites de Telegram:** el alto lo resuelven las partes de la 0105. Si una parte con una sola
  evidencia se pasa aun así de los límites de foto (peso), esa evidencia se reduce de tamaño hasta
  caber; si no hay forma, se envía la parte sin esa evidencia y con la nota «evidencia en
  `test-results/evidencias/<ficha>`», y se dice en la terminal. Nunca se deja de enviar el aviso.
- Sin `evidencias` (fichas sin pantalla, u otro estado), la tarjeta es la de la 0105.
- `.claude/commands/tarea.md`: el campo `evidencias` en el aviso de `hecha`.

## Carril

Normal (`ligera: no`), con las exclusiones `externos` (manda imágenes a Telegram) y `seguridad` (lee
ficheros por una ruta que viene en el JSON):

1. No añade componentes, funciones ni cálculos nuevos: falla.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: falla.
4. No hay ninguna decisión que preguntar a Dani: falla, qué capturas y cuántas (contestada por Dani
   el 2026-10-12: zona y ventana, todas).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
En `scripts/`, con un manifiesto y PNG de prueba en una carpeta temporal, sin red.

- CA1: con un manifiesto de dos evidencias, el HTML de la tarjeta tiene la sección «Evidencias» con
  cuatro `img` en `data:image/png` (zona y ventana de cada una) y, debajo de cada evidencia, su
  criterio, el título y la nota.
- CA2: con 12 evidencias salen las 12, cada una en su bloque marcado.
- CA3: una ruta del manifiesto fuera de `test-results/evidencias/` (con `..` o absoluta a otro
  sitio) o un fichero que no es PNG se ignora y se avisa en la terminal; las demás salen.
- CA4: una evidencia que sola se pasa del peso de foto se reduce hasta caber; si no cabe de ninguna
  forma, la parte sale sin ella y con la nota, y el script sale con 0.
- CA5: sin `evidencias`, el HTML es igual que el de la 0105 para el mismo JSON.
- CA6: un título del manifiesto con un valor del tenant (con un `.env` de prueba) hace que no se
  envíe nada, como con el resto de campos.
- CA7: `tarea.md` pide el campo `evidencias` en el aviso de `hecha`. Test de texto.

## Pruebas a mano para Dani

- El aviso de la primera ficha con pantalla tras esta: ver en el móvil que las evidencias se leen.

## Fuera de alcance

- Evidencias en los avisos de `parada` o `bloqueada`.
- Comparar capturas con las de antes (tests de regresión visual).

## Ideas surgidas (fuera de alcance)

- (developer) En las capturas en varias partes (0105) se ve la barra de desplazamiento de la ventana
  a la derecha de cada parte (la ventana es más baja que la página). Con evidencias habrá más
  partes; esconderla (`overflow: hidden` en la página o en la ventana de captura) es de la 0105.

## Decisiones del developer

- La lectura y comprobación de las evidencias va en un módulo nuevo, `scripts/telegram-evidence.mjs`
  (para que la mezcla con la 0106 en `notify-telegram.mjs` sea sencilla); la tarjeta sigue siendo
  pura: `buildCardHtml(datos, { evidencias })` recibe las imágenes ya leídas en `data:`.
- Una captura que no vale (fuera de la carpeta, sin firma PNG, más de 25 MB) se ignora sola; la
  evidencia sale con la otra. Si no le queda ninguna, la evidencia no sale. Se dice en la terminal.
- Reducir es pintar las capturas más estrechas (60 % y luego 35 % del ancho) y volver a capturar; al
  tercer paso, la evidencia sale sin capturas y con «evidencia en `test-results/evidencias/NNNN`».
  Seis capturas como mucho por aviso.
- Para saber qué evidencias lleva una parte, `telegram-capture.cjs` deja `partes.json`. Sin ese mapa
  (una captura inyectada), se supone una parte por evidencia, con lo de antes delante y el pie
  detrás. Una parte que pesa sin evidencias que reducir sigue yendo al texto de siempre (0105).
- `evidencias` en un aviso que no es de `hecha` se ignora con un aviso en la terminal.
- El rótulo «Evidencias» es su propio bloque (`data-bloque="evidencias"`), para que un corte no lo
  parta por la mitad.

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios y tests.** CA1 a CA7 tienen su test con el número en el nombre (`scripts/notify-telegram-evidencias.test.ts`); nadie los tocó tras `6ff50ea`. Sin el código fallarían. CA4 cubre el criterio tal como está escrito (reducir, volver a capturar y quitar la evidencia con la nota sin caer al texto de respaldo); no mide si la reducción pesa menos: el caso «reduce» lo pasa cualquier HTML distinto que conserve las dos `img`, aunque una implementación que no reduce nada falla. El código estrecha las capturas con CSS (`max-width` 60 % y 35 %: ~36 % y ~12 % de superficie); si aun así no cabe, quita la evidencia con la nota. Comprobarlo con capturas reales le toca al verifier o a la prueba a mano.
- **Seguridad.** `telegram-evidence.mjs` (`checkFile`, `isInside`) resuelve con `realpathSync.native` el manifiesto, cada imagen y la raíz `<cwd>/test-results/evidencias`; rechaza `..`, rutas absolutas a otro sitio, enlaces que salen, directorios, más de 25 MB y lo que no tiene firma PNG con IHDR. Manifiesto con tope de 1 MB y textos de 500 caracteres. En la tarjeta solo se pintan `src` que casan con `^data:image/png;base64,…$`; los textos van por React. `evidenceTexts` mete en el filtro del tenant lo que se pinta. La CSP no se amplía; sin secretos en logs ni errores.
- **Mapa de partes.** `telegram-capture.cjs` escribe `partes.json` (índices de evidencias que tocan cada parte con más de 0,5 px); `evidenceMap` lo valida. Sin mapa supone una parte por evidencia; si no cuadra, no reduce y la parte pesada cae al texto, como en la 0105. Con la captura real el mapa siempre existe. Tope de 6 capturas por aviso.
- **0106 tras el rebase.** Base común `main` (`15b27a7`); el diff de `notify-telegram.mjs` solo añade: siguen `previous`, `reply_parameters`, `allow_sending_without_reply` y la primera parte respondiendo a `previous ?? thread`. No se ha perdido nada. `tarea.md` (CA7) al día. `sendPhoto` no cambia; sin API de Dynatrace.

Opcional:

- Un test de tarjeta que compruebe que `reduccion: 1` y `2` dan la clase `reducida-N` con el `max-width` más estrecho, para que un HTML que no reduce no pase CA4.
- Un test que inyecte `parts.evidences` (mapa explícito con la evidencia en otra parte) para cubrir el camino real de `partes.json`.
- La regla CSS `.evidencia.reducida-3` de `telegram-card.mjs` no se usa (el nivel 3 ya quita las capturas): se puede quitar.
- Los avisos de la terminal sobre ficheros malos llevan el `criterio` antes del filtro del tenant; mejor la posición («la evidencia 2»).

## Verificación

Tests escritos en `0a78419` (`scripts/notify-telegram-evidencias.test.ts`, 12 tests; 10 fallan
porque el script aún no lee las evidencias; pasan ya el de CA5 y el de control de CA6, que guardan
lo que no tiene que cambiar). Sin red ni navegador: `fetchImpl` y `deps.capture` simulados, y el
manifiesto y los PNG en una carpeta temporal. Contrato que fijan:

- `evidencias` es la ruta del manifiesto (en los tests, absoluta); «el repositorio» es `deps.cwd`,
  así que los ficheros válidos están en `<cwd>/test-results/evidencias/`.
- Manifiesto de la 0107: array con `criterio`, `titulo` (con el prefijo «CA1 (0018): »), `nota`,
  `zona` y `ventana` (relativas a la carpeta del manifiesto) y `estable`.
- El HTML se lee del que recibe `deps.capture(html)`, que sigue devolviendo la lista de PNG. Cada
  evidencia es un bloque `data-bloque="evidencia"` de primer nivel, con sus dos `img` y su pie.
  Sin reducir, las imágenes van como `data:image/png;base64,<bytes del fichero>`.
- Los avisos de la terminal van por `deps.stderr` con `[aviso telegram]` y la palabra «evidencia».
- CA4: la captura simulada parte una pieza por evidencia; la evidencia pesa más de 10 MB mientras
  la tarjeta sea la original (hay que cambiarla para reducirla) o, en el caso sin arreglo,
  mientras su bloque lleve alguna imagen. La nota se acepta en la tarjeta o en el pie de la foto.

- CA1 → `CA1 (0108)`: sección «Evidencias», cuatro `img` `data:image/png` con los bytes de cada
  fichero, criterio · título sin prefijo y nota debajo, entre el resumen y el pie.
- CA2 → `CA2 (0108)`: 12 evidencias, 12 bloques marcados, 24 imágenes.
- CA3 → `CA3 (0108)`: un test por caso (`..`, absoluta a otro sitio, no PNG, manifiesto fuera de
  la carpeta), con aviso en la terminal y la evidencia buena entera.
- CA4 → `CA4 (0108)`: se reduce (varias capturas, la evidencia sigue con sus dos imágenes y todas
  las fotos ≤ 10 MB) y, si no cabe, sale sin ella con la nota, sin texto de respaldo y con 0.
- CA5 → `CA5 (0108)`: sin `evidencias`, el HTML es igual a `buildCardHtml(datos)`.
- CA6 → `CA6 (0108)`: un título con el valor del `.env` de prueba no captura ni envía nada (y
  control sin él).
- CA7 → `CA7 (0108)`: un párrafo de `tarea.md` con `` `evidencias` ``, manifiesto, verifier y hecha.

Verificación 2026-10-12, commit 3ef9dd7, rango main..feat/0108-telegram-evidencias: VERDE

- check: 232 ficheros y 4350 tests en verde; cobertura ok (líneas 93,75 %, ramas 90,13 %).
- e2e: `test:e2e:affected` no seleccionó ninguno (solo `scripts/`, `.claude/commands/tarea.md` y la ficha).
- Con carga: 6 ejecuciones a la vez de `scripts/notify-telegram*` y `scripts/telegram-capture` (4 ficheros, 179 tests): las 6 con salida 0, sin intermitencias.
- No se envió nada a Telegram.

## Resultado

Rebase sobre main con la 0106: en scripts/notify-telegram.mjs se conservan la respuesta al aviso anterior (previous, replyTo, remember del message_id de la primera parte) y las evidencias (evidence en sendImage); ningún test cambiado.

Commits (rama `feat/0108-telegram-evidencias`, base `main`): `6ff50ea` tests (12, `scripts/notify-telegram-evidencias.test.ts`); `0d41eda` la tarjeta pinta la sección «Evidencias» y la captura escribe `partes.json`; `adf6d7a` el aviso lee el manifiesto, filtra los textos y reduce la evidencia que no cabe; `5b519b6` `tarea.md` pide el campo `evidencias`.

Ficheros principales: `scripts/telegram-evidence.mjs` (nuevo), `scripts/telegram-card.mjs`, `scripts/telegram-capture.cjs`, `scripts/notify-telegram.mjs`, `.claude/commands/tarea.md`.

Rondas de revisión: 1 (APROBADO). ADR: completado el 0015 (sin ADR nuevo). Sin migraciones. Las cuatro opcionales del revisor y la barra de desplazamiento de la 0105 pasan a «Mejoras anotadas» del BACKLOG.
