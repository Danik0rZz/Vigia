---
id: '0069'
titulo: 'e2e: sacar el simulador y los ayudantes de views.spec.ts a un arnés común'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0069-e2e-vistas-arnes-comun
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10): «partir `views.spec.ts` por zonas (los
tests del portapapeles, juntos y en serie) y medir con más workers». Esta ficha es el primer paso:
preparar el terreno sin mover ningún test.

## Especificación

`e2e/views.spec.ts` tiene unas 17 900 líneas: las primeras ~5 300 son el Dynatrace simulado
(HTTPS en 127.0.0.1), los fixtures, los ayudantes y los ganchos (`beforeAll` lanza la app una vez
por worker, `beforeEach` la deja como al principio, `afterEach` y `afterAll`), y el resto son 261
tests. Para repartir los tests en varios specs (0070), todo lo que no es un test tiene que poder
importarse.

- Se mueve a uno o varios módulos de `e2e/` que **no** acaben en `.spec.ts` ni `.test.ts` (Playwright
  no los toma como tests): por ejemplo `e2e/views/harness.ts`, `e2e/views/simulator.ts` y
  `e2e/views/fixtures.ts`. El reparto lo decide el developer y lo explica en la cabecera.
- Los ganchos se registran con una función que cada spec de vistas llama una vez, arriba del todo:
  `setupViewsApp()` (no empieza por `use`, para no chocar con `react-hooks/rules-of-hooks`; ver la
  mejora anotada sobre `useCiWindow`). Sigue llamando a `useCiWindow` como ahora.
- El estado compartido (app, página, simulador, carpeta de exportación) se lee con accesores o un
  objeto exportado; el developer elige y lo comenta.
- `views.spec.ts` se queda con los 261 tests **sin tocar sus títulos ni sus cuerpos** (solo cambian
  los `import`). El comentario de cabecera pasa al arnés y se actualiza.
- **Guarda** (`scripts/e2e-views-harness.test.ts`, o dentro de la de la 0067 si encaja): todo spec
  que importe el arnés de vistas llama a `setupViewsApp()` exactamente una vez, en el nivel
  superior, y ningún spec de vistas declara su propio `beforeAll` de lanzar la app. Así, un spec
  nuevo de la 0070 que se olvide del arnés falla en `check` y no en un e2e confuso.
- `e2e/areas.json`: los módulos nuevos del arnés van como globs del área `views` (cambiarlos lanza
  los specs de vistas, como hoy cambiar `views.spec.ts`).

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade `setupViewsApp` y la
   guarda.
2. No elimina nada visible para el usuario: se cumple; solo `e2e/` y `scripts/`.
3. No toca datos, API ni lógica: se cumple para la app; reorganiza el código de los e2e.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: los 261 tests de `views.spec.ts` siguen con el mismo título y el mismo cuerpo (el diff de
  `views.spec.ts` solo quita código que no es un `test(...)` y cambia los `import`) y pasan en el e2e
  de `views`.
- CA2: la guarda pasa en el repositorio y, con specs de ejemplo, falla si un spec que importa el
  arnés no llama a `setupViewsApp()`, la llama dos veces o la llama dentro de un `describe` o de un
  test.
- CA3: la etiqueta de zona de la 0067 sigue en todos los tests (su guarda sigue en verde).

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Repartir los tests en specs por zona y medir los workers (0070).
- Cambiar o arreglar tests.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
