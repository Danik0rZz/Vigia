---
id: '0108'
titulo: Evidencias visuales en el aviso de ficha hecha
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos, seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0105', '0107'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0108-telegram-evidencias
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: # el de la 0104; el doc-writer añade las evidencias
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#sendphoto; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
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
  `data:` (la CSP de la 0104 ya lo permite). Cada evidencia es un bloque (marca de la 0104), para
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
