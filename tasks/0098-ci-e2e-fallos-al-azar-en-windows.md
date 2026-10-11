---
id: '0098'
titulo: 'CI: por qué el runner de Windows falla al azar en los e2e desde el 2026-10-11, y su arreglo común'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0098-ci-e2e-fallos-al-azar
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani, por el Orquestador (2026-10-11): ficha nueva, por delante de la 0086 y la 0096, para
investigar por qué el runner de Windows del CI falla al azar desde hoy. En las últimas PR, casi cada
ejecución falla en un e2e distinto y ajeno a la ficha. Hipótesis a medir: tiempos de espera
ajustados al runner, la 0079 (`gatedFetch`), la 0070 (reparto de specs y arnés) o carga del runner;
comparar duraciones de runs antes y después de la 0070 y la 0079 con `node scripts/ci-times.mjs <run>`.

## Especificación

**Los fallos vistos** (todos pasan al relanzar):

- `views-problema-detalle.spec.ts`: la cola de gráficos (0086, en cuarentena), la evidencia de 45
  días (0096, en cuarentena), «v0.10.0: tabla de evidencias…» y «v0.10.0: tabla virtualizada…» (0097).
- `views-problemas.spec.ts`: «grid de Problemas: ARIA…» (tooltip «Cerrado», dentro de la 0096).
- `shell.spec.ts`: «CA2 (0021)… 1024×720».
- `views-portapapeles.spec.ts`: «captura del gráfico al portapapeles» (PR #12, run 38160295714,
  intento 2).
- Unitario: `scripts/react-compiler.test.ts`, CA3 (0059), por tiempo.
- Los de git real de la 0088 (ya arreglados en su ficha).

**Dato de la 0086:** su fallo era del test: el retardo fijo del simulador (400 ms) era más corto que
cada despliegue de fila en el runner de Windows. Se arregló con una compuerta en el simulador
(`sim.eventMetricGate`, como `detailGate`) en vez de esperas fijas. Buscar en los specs de vistas
otros tests que dependan de un retardo fijo del simulador frente al ritmo del runner.

1. **Medir antes de cambiar nada.** Con `node scripts/ci-times.mjs <run>`, duraciones del job y de los
   pasos de e2e en runs de antes y de después de la 0070 y la 0079, y qué falla en cada uno. Una
   pista para empezar, no un diagnóstico: antes de la 0070 casi todas las vistas iban en un único
   spec (un worker); desde la 0070, cada spec de vistas lanza su app y su simulador, así que en el
   runner (4 núcleos, 4 workers) hay hasta 4 apps Electron a la vez donde antes había una. Comprobar
   también si el reloj de los tests (esperas de 5 s de `expect`, tiempos de tooltips y animaciones)
   va justo con esa carga, y si `gatedFetch` alarga el arranque de las vistas.
2. **Diagnóstico escrito en «Resultado»:** la causa común (o que no la hay), con los números que la
   sostienen, y qué fallos explica y cuáles no.
3. **Arreglo común, si lo hay**, en el sitio de la causa: configuración de Playwright o del CI
   (workers del CI, tiempos de `expect`), el arnés de vistas o la app. Cada cambio con su porqué en
   la ficha. Límites:
   - nada de reintentos (`retries` sigue en 0) ni de subir tiempos «por si acaso»: solo un valor
     medido y justificado;
   - si el arreglo toca `gatedFetch` o la verificación de certificados (0079), o la definición de
     «CI ok» (`.github/workflows/ci.yml`), se para y se pregunta (`[ALCANCE]`) y el reviewer marca la
     exclusión `seguridad`: la ficha pasa a ir sola en su PR, como dijo la 0077;
   - menos workers en el CI es una salida válida si los números lo sostienen.
4. **Lo que no explique la causa común** se anota en «Resultado» para el Planificador (una ficha de
   arreglo por test confirmado, como la 0086). Las fichas 0086, 0096 y 0097 siguen: si el arreglo
   común las resuelve, su developer lo comprueba y lo dice en su ficha.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la
   duda, no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **puede no cumplirse**, si la causa está en la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo los `[ALCANCE]` del punto 3.

## Criterios de aceptación

- CA1: si el arreglo cambia la configuración (workers o tiempos de Playwright, el CI o el arnés), un
  test unitario en `scripts/` con «(0098)» en el nombre fija el valor nuevo (como el de workers de la
  0070). Si el arreglo está en la app, un test que falla sin él y pasa con él, con «(0098)».
- CA2: el job de e2e del CI de la PR de la ficha pasa tres veces seguidas sin ningún fallo en el
  proyecto `e2e` (la primera ejecución y dos relanzamientos con `gh run rerun`), y los tiempos de las
  tres se apuntan en «Verificación».
- CA3: `npm run check` y la guarda de la 0075 siguen en verde.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Arreglar uno por uno los tests sueltos que no explique la causa común (cada uno, su ficha).
- `retries` distinto de 0.
- Cambiar el runner del CI (otro sistema o máquina más grande): si hiciera falta, se le propone a
  Dani (configuración de GitHub y coste).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
