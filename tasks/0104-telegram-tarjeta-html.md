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
  etiqueta y su clase de color; con `tipo: "version"` sale «Versión …» en vez de «Ficha …».
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
