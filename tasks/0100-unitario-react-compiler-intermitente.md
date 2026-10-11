---
id: '0100'
titulo: Unitario intermitente del React Compiler (CA3 de la 0059), causa y arreglo
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0100-unitario-react-compiler
adrs: ['0013'] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Petición del Orquestador (2026-10-12), con prioridad por decisión de Dani: «hay que atajar cuanto
antes los test que hacen que se hagan check completos». Arreglar el unitario intermitente
`scripts/react-compiler.test.ts`, «CA3 (0059): el plugin de React del renderer compila los
componentes con el React Compiler». Causa antes que arreglo: no subir el límite sin medir.

## Especificación

**Hechos (del Orquestador y del BACKLOG, «Mejoras anotadas», surgió en 0090):**

- Falló el 2026-10-11 y el 2026-10-12 por el límite de 5000 ms de Vitest (el de por defecto) en el
  primer `npm run check` de tres verifiers seguidos (0098, 0096 y 0099) y en el developer de la 0096
  con el e2e corriendo a la vez. Aislado pasa 3 de 3; el `check` repetido sale en verde.
- Cada fallo obliga a repetir el `check` entero (unos 3-4 min).

**Qué hace el test hoy** (leído en el fichero): no es un build de Vite. Importa
`electron.vite.config.ts` entero (todos los plugins de main, preload y renderer), busca el plugin
`vite:react-babel` y le pasa un componente de 4 líneas. Todo eso (la importación de la configuración,
la carga de Babel y del React Compiler, y la transformación) va dentro del mismo `it`, que tiene
5 s. Sospecha que hay que confirmar midiendo: lo caro es la carga en frío (la configuración y
Babel), no la transformación.

**Qué hace el developer, en este orden:**

1. **Medir**, sin cambiar nada: el tiempo de la importación de la configuración, el de obtener el
   plugin y el de la transformación, por separado (por ejemplo con `performance.now()` en una copia
   local del test, sin commitear). Aislado y dentro de `npm run check` con `npm run test:e2e`
   corriendo a la vez (la situación en la que falla). Tres tomas de cada. Los números van a la
   sección «Verificación» de esta ficha.
2. **Arreglar según la causa**, con esta regla de decisión:
   - Si sobra trabajo (algo que se carga y el test no necesita), quitarlo, siempre que el test siga
     comprobando la configuración real del renderer (es lo que pide la 0059: no leer el texto de la
     configuración, sino cargarla).
   - La preparación cara (importar la configuración y obtener el plugin) pasa a un `beforeAll`, para
     que el tiempo de carga no cuente como tiempo de la prueba, con un `hookTimeout` propio solo si
     las medidas lo piden.
   - Si aun así hace falta un límite propio (`testTimeout` o `hookTimeout`, como el de 60 s de la
     0088 en los tests de git real), va en ese fichero solo, con un comentario que cite esta ficha y
     los tiempos medidos bajo carga, y con margen razonable sobre el peor medido (no un número a
     ojo).
3. Quitar la línea de sospechoso del BACKLOG («Mejoras anotadas», el unitario
   `scripts/react-compiler.test.ts`) al cerrar (lo hace el doc-writer).

**Lo que no cambia:** lo que comprueba el test (las dos pruebas de la 0059, con sus nombres y sus
`expect`), `electron.vite.config.ts`, `vitest.config.*` y las dependencias. Si la causa estuviera en
la configuración de Vite o pidiera tocar dependencias, se para: es `[ALCANCE]` (y quitaría el carril
rápido).

## Carril

Rápido (`ligera: sí`). S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios
externos: el cambio queda dentro de `scripts/react-compiler.test.ts`.

1. No añade componentes, funciones ni cálculos nuevos: cumple; en la app no cambia nada y en el test
   se reordena la preparación (`beforeAll`) o se ajusta un límite. Si el arreglo pidiera algo más
   que eso, se para (ver arriba).
2. No elimina nada visible para el usuario: cumple; es un test.
3. No toca datos, API ni lógica: cumple; no toca código de la app ni la configuración del build.
4. No hay ninguna decisión que preguntar a Dani: cumple; la regla de decisión está escrita arriba y
   lo que se salga de ella es `[ALCANCE]`.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1: las dos pruebas «CA3 (0059)» de `scripts/react-compiler.test.ts` siguen con sus nombres y
  comprobando lo mismo: versión exacta en `devDependencies`, y que el plugin del renderer, cargado de
  la configuración real, devuelve un código con `react/compiler-runtime` y `_c(N)`.
- CA2: el unitario pasa en tres `npm run check` seguidos con `npm run test:e2e` corriendo a la vez
  (la situación en la que fallaba). Lo ejecuta el verifier y anota los resultados en la ficha.

(Que el comentario de un límite propio cite la 0100 y los tiempos medidos es una regla de la
especificación, paso 2; la revisa el reviewer, no es un criterio.)

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Otros tests lentos o intermitentes del `check`: si la medida enseña alguno, se anota en el
  BACKLOG.
- Cambiar `electron.vite.config.ts`, `vitest.config.*` o el límite global de Vitest.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente; aquí van también las medidas del paso 1)

## Resultado

(pendiente)
