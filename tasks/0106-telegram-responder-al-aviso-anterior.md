---
id: '0106'
titulo: Cada aviso de una ficha responde al anterior de la misma ficha
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: telegram-imagen # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0105'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0106-telegram-responder-anterior
adrs: ['0009'] # ADR que aplican, por número
adr_nuevo: # el de la 0104; el doc-writer añade este punto
api: ninguna (Telegram Bot API, https://core.telegram.org/bots/api#replyparameters; no es Dynatrace)
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
