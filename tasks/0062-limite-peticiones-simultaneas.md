---
id: '0062'
titulo: 'Main limita las peticiones simultáneas a Dynatrace por entorno'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-robustez
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0062-limite-peticiones-simultaneas
adrs: [2, 4]
adr_nuevo:
api: ninguna nueva
migracion: no
rondas_revision: 0
---

## Petición original

Lote «auditoria-robustez» (0060 a 0062), de la revisión de código del 2026-10-09 (hallazgo S-07). La
revisión no se guarda en el repositorio: esta ficha lleva lo necesario.

## Especificación

**El problema.** El renderer frena las peticiones (`src/renderer/src/lib/request-queue.ts`), pero main
no tiene límite propio: `createDtClient` atiende todas las que lleguen. Una página de host lanza en
paralelo cinco canales con hasta nueve peticiones; con un renderer en bucle o un «Reintentar» mal
acotado, el límite lo pone Dynatrace con 429, contra la cuota del cliente. El propio código aplica el
principio contrario en otro sitio («el renderer ya frena, pero main no se fía»).

**Arreglo:** un semáforo **por entorno** dentro de `createDtClient`, alrededor de `send`: como mucho
**6** peticiones en vuelo y el resto en cola FIFO, inyectable para los tests. Registrar en el log
(nivel `debug`) cuando la cola pase de 20 pendientes. Las peticiones canceladas salen de la cola. El
reintento de 429 que ya existe no cambia.

## Criterios de aceptación

- CA1 (unitario): con 10 peticiones simultáneas y un `fetch` que no resuelve, solo 6 llegan a
  `fetchFor`; al resolver una, entra la séptima.
- CA2 (unitario): dos entornos no se frenan entre sí (6 y 6).
- CA3 (unitario): una petición cancelada en cola no llega a `fetchFor` y libera su sitio.
- CA4 (unitario): con más de 20 en cola se registra una línea `debug`.
- CA5 (e2e): las páginas de entidad y Problemas siguen cargando (sus e2e pasan).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar la cola del renderer.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `df6eb44` (`src/main/dynatrace/client.concurrency.test.ts`). Comprobado antes que
el problema sigue en `main` (`createDtClient` no limita nada). Sin tiempo real: cada `fetch` es una
promesa que el test resuelve o rechaza a mano.

- CA1 → `describe('CA1 (0062) …')`: 10 simultáneas → 6 a `fetchFor`; al resolver una entra la 7.ª;
  orden FIFO al liberar sitios en desorden; una que falla (`NETWORK`) libera su sitio; tras vaciarse
  vuelve a admitir 6.
- CA2 → `describe('CA2 (0062) …')`: 6 y 6 con A lleno; liberar en A no deja pasar a B ni al revés;
  tres entornos con 6 cada uno.
- CA3 → `describe('CA3 (0062) …')`: cancelada en cola no llega a `fetchFor` y la siguiente ocupa su
  turno; cancelada antes de pedirla; cancelar una en vuelo libera su sitio; varias canceladas
  mantienen el orden del resto.
- CA4 → `describe('CA4 (0062) …')`: 6 + 20 en cola no registra; 6 + 21 registra `debug` sin el
  token; la cola de un entorno no cuenta para el umbral de otro.
- CA5 → sin test nuevo: lo cubren los e2e existentes de entidades y Problemas (los afectados).

Decisiones tomadas en nombre de Dani (refinables):

- **Cancelación:** `DtRequestOptions` no tenía forma de cancelar desde fuera. Los tests pasan
  `signal?: AbortSignal` en las opciones de `dtRequest`: abortada en cola, se rechaza sin llegar a
  `fetchFor`; abortada en vuelo, se aborta el `fetch` y libera su sitio. No se fija el código del
  error de una cancelada.
- **Log:** `DtClientDeps.logger` gana `debug(...)`. El test exige al menos una línea al pasar de 20
  pendientes (no exactamente una) y que no lleve el token.
- **Límite:** los tests usan el 6 por defecto, sin fijar el nombre de la dependencia inyectable.

Ejecución tras escribirlos: 13 fallan y 2 pasan ya (orden FIFO y umbral por entorno: sin límite no
pueden fallar, y vigilan que no se rompan cuando lo haya).

## Resultado

(pendiente)
