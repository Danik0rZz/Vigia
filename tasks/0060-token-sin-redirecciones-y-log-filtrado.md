---
id: '0060'
titulo: 'El token nunca sigue una redirección, y el log tiene un filtro final de secretos'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-robustez
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0060-token-sin-redirecciones-y-log-filtrado
adrs: [2, 5]
adr_nuevo:
api: ninguna nueva (cambia cómo se llama a `fetch`)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «auditoria-robustez» (0060 a 0062), de la revisión de código del 2026-10-09 (hallazgos S-02 y
S-03). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario.

## Especificación

**1. Redirecciones (S-02).** `src/main/dynatrace/client.ts` (`send`) y `src/main/dynatrace/oauth.ts`
(`requestToken`) llaman a `fetch` sin `redirect`, que por defecto es `follow`. Si la API o un proxy
responde con una 3xx, la petición se reenvía a donde diga el servidor. Chromium quita
`Authorization` al cambiar de origen, pero dónde viaja una petición con `Api-Token` o `Bearer` no
debería decidirlo la respuesta; y en el SSO, un 307 reenviaría el cuerpo con el `client_secret`.
Ninguna función de Vigía necesita seguir redirecciones. El precedente: `src/test/live-client.ts` ya
usa `redirect: 'error'`.

- Pasar `redirect: 'error'` en los dos `fetch`. La 3xx rechaza con un `TypeError`; en `send()` se
  convierte en `DtError('NETWORK', …)` con un `reason` nuevo `redirectRefused` (clave en
  `src/shared/error-reasons.ts` y textos es/en: «La URL del entorno redirige a otra dirección;
  usa la URL final»).
- Antes de cerrar, una pasada de `npm run test:live` (solo lectura) confirma que ninguna llamada
  real pasa por una 3xx.

**2. Filtro del log (S-03).** `src/main/logging.ts` configura electron-log y captura excepciones no
controladas (`errorHandler.startCatching`), pero no tiene `log.hooks`: la regla «nunca secretos en el
log» se cumple llamada a llamada (`maskSecrets`, `redactQueryEcho`, `maskErrorDetails`). Una excepción
de una librería con un token en el mensaje iría al fichero sin filtro.

- Función pura `maskLogMessage(message)` (nuevo `src/main/log-mask.ts`): cadenas → `maskSecrets`;
  `Error` → copia con `message` y `stack` enmascarados (sin perder `name` y `cause`); objetos planos
  → sus valores de texto enmascarados. Registrada con `log.hooks.push(...)` en `initLogging`.
- `src/main/CLAUDE.md`: el hook es la última barrera, no un permiso para registrar secretos.

## Criterios de aceptación

- CA1 (unitario): las llamadas a `fetch` del cliente y del OAuth llevan `redirect: 'error'`.
- CA2 (unitario): un `fetch` simulado que rechaza por redirección produce `DtError` `NETWORK` con
  `reason` `redirectRefused`, sin la URL con credenciales en el mensaje.
- CA3 (unitario): `maskLogMessage` enmascara un `Api-Token …` dentro de un `Error` (mensaje y pila),
  conserva la parte pública de un `dt0c01.<pública>.<secreta>`, no cambia valores que no son texto y
  conserva `name` y `cause`.
- CA4 (unitario): `initLogging` registra el hook (con electron-log simulado).
- CA5 (unitario): textos del `reason` nuevo en es y en (paridad de `check`).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar qué se registra en el log.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `95dc88c` (`test(dynatrace): criterios de la ficha 0060`); fallan porque falta el
código (sin `redirect`, sin `redirectRefused`, sin `log-mask.ts` ni hook).

- CA1: `src/main/dynatrace/redirect.test.ts`, «CA1 (0060)» (fetch simulado: cliente clásico,
  plataforma, OAuth, POST y reintento tras 429; y el `fetch` del SSO) y «CA1 y CA2 (0060): contra
  servidores locales» (servidores HTTP falsos en 127.0.0.1 con el `fetch` real de Node: 3xx al
  mismo origen, a otro puerto, a otro host y a otro esquema con credenciales en la URL; el destino
  no recibe nada, y un 307 del SSO no reenvía el `client_secret`).
- CA2: `redirect.test.ts`, «CA2 (0060)» y el bloque de servidores locales.
- CA3: `src/main/log-mask.test.ts`, «CA3 (0060)».
- CA4: `src/main/logging.test.ts`, «CA4 (0060)» (electron y electron-log simulados).
- CA5: `redirect.test.ts`, «CA5 (0060)» (y la paridad general de `src/main/error-reasons.test.ts`).

Decisiones del test-writer (Dani delegó; conservadoras y refinables):

- El rechazo por redirección no es siempre un `TypeError`: `session.fetch` de Electron 44 rechaza
  con `Error("Attempted to redirect, but redirect policy was 'error'")` (visto en el binario) y el
  `fetch` de Node con `TypeError('fetch failed')` y causa `unexpected redirect`. CA2 exige
  `redirectRefused` para las dos formas, y `network` para cualquier otro fallo de red.
- «Sin la URL con credenciales»: el error (mensaje y parámetros del `reason`) no contiene el token,
  `Api-Token` ni la contraseña de un `Location` con `usuario:clave@`.
- En el OAuth, CA2 solo exige `NETWORK` y que no salga el `client_secret`; el `reason` lo decide el
  developer (`ssoUnreachable` o `redirectRefused`).
- `maskLogMessage` recibe el `LogMessage` de electron-log (el argumento de `log.hooks`) y devuelve
  el mensaje con `data` enmascarado; en los objetos planos solo se prueban los valores de primer
  nivel.
- El esquema se prueba de http a https: el `fetch` de Node no confía en un certificado autofirmado
  sin tocar el TLS global. El de https a http es el mismo mecanismo.
- `npm run test:live`: no hace falta un test en vivo nuevo; `src/test/live-client.ts` ya fuerza
  `redirect: 'error'`, así que la pasada de solo lectura de la suite actual falla si alguna llamada
  real pasa por una 3xx. La lanza el verifier antes de cerrar.

## Resultado

(pendiente)
