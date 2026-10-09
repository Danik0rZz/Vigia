---
id: '0060'
titulo: 'El token nunca sigue una redirección, y el log tiene un filtro final de secretos'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(pendiente)

## Resultado

(pendiente)
