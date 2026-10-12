---
id: '0104'
titulo: Tarjeta HTML del aviso de Telegram
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0104-telegram-tarjeta-html
adrs: ['0009', '0011'] # ADR que aplican, por número
adr_nuevo: Avisos de Telegram con tarjeta en imagen (amplía el ADR-0009)
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Pedida por Dani a través del Orquestador (sesión vigia-c0, 2026-10-12), segunda parte de «avisos de
Telegram en imagen». Prototipo probado fuera del repositorio:

- Tarjeta HTML oscura. Cabecera «Vigía · Orquestador» y fecha; «Ficha NNNN» y título a la
  izquierda, etiqueta de estado a la derecha; cuatro cajitas con el contenido centrado (Revisión,
  Verifier, CI, Duración); resumen en Markdown (títulos, CLAVE en código, listas, bloques de código
  coloreados); decisión pendiente en caja ámbar; pie con rama y PR. Sin rótulos en mayúsculas.
- Por decidir: Markdown y resaltado con librerías locales y no de CDN, y limitar el HTML del
  resumen, porque lo escriben los agentes.

Gusto de Dani (2026-10-12): nada de rótulos en mayúsculas ni con espaciado entre letras; texto a la
izquierda; solo se centra el contenido de las cajitas de datos.

## Especificación

Esta ficha solo **construye el HTML** de la tarjeta a partir del JSON del aviso; capturarlo y
enviarlo es la 0105. Así se revisa y se prueba sin navegador ni red.

- Módulo nuevo en `scripts/` (por ejemplo `scripts/telegram-card.mjs`) con una función pura
  `buildCardHtml(datos)` que devuelve un documento HTML completo, con el CSS en línea y sin nada
  externo (ni fuentes, ni imágenes, ni scripts por URL). Fuente del sistema.
- **Contenido**, de los campos del JSON de hoy (`tipo`, `ficha`, `titulo`, `estado`, `rondas`,
  `verifier`, `ci`, `resumen`, `decision`) y de tres nuevos y opcionales: `duracion` (texto, lo
  pone el Orquestador), `rama` y `pr` (URL).
  - Cabecera: «Vigía · Orquestador» (o «Vigía · Planificador» si `origen: "planificador"`, campo
    opcional) y la fecha y hora local.
  - «Ficha NNNN» (o «Versión X.Y.Z» con `tipo: "version"`) y el título, a la izquierda; la
    etiqueta de estado, a la derecha, con su color: `hecha` y `cerrada`, OK (verde); `parada`,
    pausa (ámbar); `bloqueada` y `fallida`, bloqueada (rojo); `en_proceso`, en proceso (azul).
  - Cuatro cajitas con el contenido centrado: Revisión (rondas), Verifier, CI (sin enlace en la
    imagen: «en verde», «en rojo», «sin pasar» o «—») y Duración (o «—»).
  - Resumen en Markdown, a la izquierda: títulos, negrita, código en línea, listas, tablas de GFM y
    bloques de código con colores.
  - Decisión pendiente, si hay `decision`, en una caja ámbar.
  - Pie con la rama y el número de la PR, lo que haya.
  - Lo que no viene no sale (ni caja vacía ni rótulo suelto), salvo las cuatro cajitas, que van
    siempre con «—».
- **Markdown y resaltado con lo que ya está instalado**, sin dependencias nuevas: `react-markdown`,
  `remark-gfm`, `rehype-sanitize` y `lowlight`/`highlight.js` (están en `devDependencies`),
  pintado con `react-dom/server`. Nada de CDN.
- **El resumen no puede meter HTML** (lo escriben los agentes): sin `rehype-raw`, el HTML crudo
  del Markdown no se interpreta; `rehype-sanitize` con una lista blanca corta (la del ADR-0011 como
  referencia): sin `script`, `style`, `iframe`, `img`, `form` ni atributos `on*`, `style` o `src`, y
  los enlaces se quedan como texto (en la imagen no se pulsan). Los demás campos se escapan.
- **CSP en la propia página:** `<meta http-equiv="Content-Security-Policy">` con
  `default-src 'none'; style-src 'unsafe-inline'; img-src data:` (las imágenes `data:` las usará
  la 0108).
- **Sin recortar el detalle:** Dani (2026-10-12) quiere que el aviso sea una evolución importante,
  con información relevante y resúmenes en Markdown con más detalle que el texto básico de antes.
  El resumen no se recorta para que quepa: solo hay un tope de seguridad alto (orientativo, 20 000
  caracteres, contra un JSON roto), y al pasarlo se corta con «…». Que la imagen sea muy alta lo
  resuelve la 0105 partiéndola.
- **Diseño del prototipo** (lo vio y aceptó Dani; detalles pasados por la sesión del prototipo el
  2026-10-12). Es la referencia; el developer puede ajustar lo que no se vea igual en Electron:
  - Página de 800 px de ancho con 28 px de margen (la 0105 la captura a escala 2: 1600 px). Fuente
    `"Segoe UI", system-ui`; código en `Consolas, monospace`.
  - Colores: fondo `#0f1419`; tarjeta `#171d24` con borde `#26303b` y radio 16 px; texto `#e6edf3`;
    texto apagado `#8b98a5`; acento (punto de la cabecera, viñetas, códigos) `#D97757`.
  - Cabecera: punto de 10 px en el acento y «Vigía · Orquestador» a la izquierda, fecha a la
    derecha, línea debajo.
  - Título: «Ficha NNNN» (15 px, apagado) y el título (28 px, peso 650) a la izquierda; etiqueta de
    estado a la derecha, en píldora (15 px, peso 650, sin saltar de línea). Colores (fondo / texto /
    borde): hecha y cerrada `#123524` / `#4ade80` / `#1f6b43`; parada `#3a2a0e` / `#fbbf24` /
    `#7a5a16`; en proceso `#10283f` / `#60a5fa` / `#1e4f7f`; bloqueada y fallida `#3b1418` /
    `#f87171` / `#7f2a31`.
  - **Texto de la etiqueta con símbolos, no emoji** (en Windows los emoji salen con su propio
    color): «✓ OK», «❚❚ En pausa · espera a Dani», «● En proceso», «✕ Bloqueada». Los emoji van
    solo en el pie de Telegram (0105).
  - Cuatro cajitas en rejilla de 4 columnas, hueco 12 px: fondo `#11171d`, borde `#26303b`, radio
    12 px; contenido centrado (rótulo de 13 px apagado, valor de 20 px peso 650; verde `#4ade80`,
    ámbar `#fbbf24`, rojo `#f87171`).
  - Resumen: 17 px, interlineado 1.55, color `#cfd8e1`; `h3` de 19 px con línea inferior
    `#26303b`; negrita en `#e6edf3`; cursiva en `#e2c08d`; viñetas y números en el acento; código
    en línea `#f0a37f` sobre `#2a1f1b` con borde `#4a3128` y radio 6 px; bloque de código sobre
    `#0d1117` con borde y radio 10 px, colores tipo «github-dark», con `white-space: pre-wrap` y
    `overflow-wrap: anywhere` (si no, las líneas largas se cortan por la derecha: pasó en el
    prototipo); cita con barra izquierda de 3 px en el acento sobre `#141a20`.
  - Decisión: caja con barra izquierda de 4 px `#fbbf24`, fondo `#2a2112`, título «Decisión que se
    espera» en ámbar, y la pregunta con sus opciones.
  - Pie: rama a la izquierda y PR a la derecha, monoespaciada, 14 px, apagado.
- ADR nuevo (doc-writer): por qué pasamos del texto plano del ADR-0009 a una tarjeta en imagen, qué
  se permite en el HTML y por qué no se usa el formato de Telegram para el resumen.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (pinta en HTML un texto que escriben los
agentes):

1. No añade componentes, funciones ni cálculos nuevos: falla, es un módulo nuevo.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: falla, lógica nueva de presentación y de saneado.
4. No hay ninguna decisión que preguntar a Dani: cumple; las del diseño ya las dio en la petición.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
Unitarios en `scripts/telegram-card.test.ts`, sobre el HTML que devuelve `buildCardHtml`.

- CA1: con un JSON completo, el HTML tiene la cabecera, «Ficha NNNN», el título, la etiqueta de
  estado, las cuatro cajitas con su valor, el resumen, la caja de decisión y el pie con rama y PR.
- CA2: sin `decision`, `rama`, `pr` ni `duracion`, no hay caja de decisión ni pie, y la cajita de
  Duración enseña «—».
- CA3: cada estado (`hecha`, `cerrada`, `parada`, `bloqueada`, `fallida`, `en_proceso`) da su
  etiqueta con el símbolo del diseño (sin emoji) y su clase de color; con `tipo: "version"` sale «Versión …» en vez de «Ficha …».
- CA4: el Markdown del resumen da `h2`/`h3`, `code`, `ul`/`ol`, tabla y un bloque de código con
  las clases de color de `lowlight`.
- CA5: un resumen con `<script>`, `<img src=…>`, `<iframe>`, un atributo `onerror`, un enlace
  `javascript:` y un `style` no deja ninguno en el HTML de salida; un título o una decisión con `<`,
  `>` y `&` salen escapados.
- CA6: el HTML no tiene ninguna URL `http:`, `https:` ni `//` en atributos `src` o `href`, ni
  `<link>` ni `<script>`, y lleva la CSP de la especificación.
- CA7: el CSS no tiene `text-transform: uppercase` ni `letter-spacing`; el título y el resumen van
  alineados a la izquierda y solo las cajitas, centradas.
- CA8: un resumen de 10 000 caracteres sale entero; uno más largo que el tope de seguridad se corta
  con «…».
- CA9: cada bloque de primer nivel de la tarjeta (cabecera, cajitas, cada bloque del resumen,
  decisión, pie) lleva una marca (por ejemplo `data-bloque`) para que la 0105 pueda partir la
  imagen entre bloques.

## Pruebas a mano para Dani

- Abrir en el navegador el HTML de un aviso de prueba y ver que se parece al prototipo y le gusta.

## Fuera de alcance

- Capturar la imagen y enviarla (0105), responder al aviso anterior (0106) y las evidencias (0107 y
  0108).
- Cambiar el aviso de texto de hoy.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
