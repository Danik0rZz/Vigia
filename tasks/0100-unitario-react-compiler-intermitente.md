---
id: '0100'
titulo: Unitario intermitente del React Compiler (CA3 de la 0059), causa y arreglo
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

- (developer) En la primera toma de medidas bajo carga, el e2e `views-entidad.spec.ts:543`,
  «CA1 (0036): … la tarjeta «Información» es la última sección …», agotó su minuto (1 fallo de 369,
  con la tanda de 4,4 min frente a 1,8 min de las otras dos). Sin cambios de código entre tomas:
  candidato a inestable bajo carga, para anotar en el BACKLOG.

## Notas del revisor

### Ronda 1: APROBADO

- **Causa medida antes del arreglo:** tres tomas aisladas y tres bajo carga (`vitest --coverage` + `test:e2e`), con importar, plugin y transformar por separado y el desglose de la importación. El arreglo mueve la importación de la configuración y la obtención del plugin a un `beforeAll`; no sube ningún límite (hook de 10 s frente a 1,7 s en el peor caso; prueba de 5 s frente a 0,55 s). El comentario de `scripts/react-compiler.test.ts:13-18` cita la 0100 y los tiempos.
- **Criterios:** CA1 con los dos tests «CA1 (0100)» de `scripts/react-compiler-0100.test.ts`; el segundo exige el `beforeAll` y fallaba sin el arreglo. Los de la 0059 iguales; los tests no se tocan desde 4099970. CA2, del verifier.
- **Carril y alcance:** solo el test, el test nuevo y la ficha; sin `electron.vite.config.ts`, `vitest.config.*`, dependencias ni app. Sin `[CARRIL]`. Sin datos del tenant.

Opcional: si vuelve a fallar con más carga, una transformación de calentamiento en el `beforeAll`; el test de la 0100 lee el texto de otro test (aceptado, CA1 trata de conservarlo); `views-entidad.spec.ts:543` al BACKLOG (doc-writer).

## Verificación

Tests de la ficha (ligera; commit `test(scripts): CA1 de la 0100, la carga del React Compiler fuera
de la prueba (#0100)`), en `scripts/react-compiler-0100.test.ts`, que lee el texto del test (no el
de la configuración):

- CA1 → «las dos pruebas «CA3 (0059)» conservan sus nombres y sus comprobaciones» (nombres, versión
  exacta en `devDependencies`, importación real de la configuración, plugin `vite:react-babel`,
  `react/compiler-runtime` y `_c(N)`) y «la carga de la configuración y del plugin va en un
  beforeAll, no en la prueba». Al escribirlos: 1 pasa y 1 falla (no había `beforeAll`).
- CA2 → lo ejecuta el verifier (tres `npm run check` con `npm run test:e2e` a la vez).

**Medidas del paso 1** (2026-10-12, copia local del test con `performance.now()`, sin commitear).
«Importar» es `import('../electron.vite.config')`; «plugin», buscarlo y `configResolved`;
«transformar», la primera llamada al `transform` (la segunda, para comparar):

| Toma                                     | Importar | Plugin | Transformar (1.ª) | 2.ª   | Total   |
| ---------------------------------------- | -------- | ------ | ----------------- | ----- | ------- |
| Aislado 1                                | 343 ms   | 0 ms   | 159 ms            | 9 ms  | 503 ms  |
| Aislado 2                                | 337 ms   | 0 ms   | 159 ms            | 9 ms  | 497 ms  |
| Aislado 3                                | 337 ms   | 0 ms   | 154 ms            | 12 ms | 492 ms  |
| `test:coverage` + `test:e2e` a la vez, 1 | 767 ms   | 0 ms   | 410 ms            | 21 ms | 1177 ms |
| `test:coverage` + `test:e2e` a la vez, 2 | 1724 ms  | 0 ms   | 417 ms            | 25 ms | 2141 ms |
| `test:coverage` + `test:e2e` a la vez, 3 | 1313 ms  | 0 ms   | 544 ms            | 31 ms | 1858 ms |

En esas tres tandas, la prueba real (sin cambiar) tardó 2943, 2088 y 2096 ms. Bajo carga se usó
`npx vitest run --coverage` (la parte de pruebas del `check`; con la copia dentro, lint y formato
habrían fallado), lanzada 45 s después de `npm run test:e2e`. Desglose de la importación (aislado,
3 tomas iguales): `electron-vite` (arrastra Vite) ~272 ms, `@tailwindcss/vite` ~50 ms,
`@vitejs/plugin-react` ~4 ms y el resto de la configuración ~9 ms.

**Causa:** la carga en frío. Importar la configuración y la primera transformación (que carga Babel
y el compilador) son el 98 % del tiempo y crecen de 2 a 5 veces con la máquina cargada; la
transformación en sí son ~10-30 ms. No sobra trabajo que se pueda quitar sin dejar de cargar la
configuración real: lo caro es `electron-vite`, del que sale `defineConfig`.

**Arreglo** (commit `fix(scripts): la carga de la configuración del React Compiler pasa a un
beforeAll (#0100)`): importar la configuración, tomar el plugin y prepararlo para build van en un
`beforeAll`; la prueba solo transforma (0,4-0,55 s en el peor medido, frente a 5 s). Sin límite
propio: el peor medido del hook (1,7 s) queda lejos de los 10 s de `hookTimeout` por defecto.

Verificación 2026-10-12, commit dede004, rango `integra/20261012-2..fix/0100-unitario-react-compiler`: **VERDE**

- `npm run check`: 4139 tests (225 ficheros), cobertura ok (líneas 93,58 %, ramas 90,03 %, funciones 89,94 %, sentencias 92,83 %).
- `test:e2e:affected`: «solo docs o tests unitarios»; ningún spec.
- CA2: cinco `npm run check` seguidos en verde, sin ningún fallo del unitario; tres con el e2e completo a la vez (check 1 con `npm run test:e2e`, 369 passed; checks 4 y 5 con `test:e2e:nobuild` en bucle, dos pasadas de 369 passed) y dos sin carga.
- `core.bare` del checkout principal: `false` antes, durante y después de todas las pasadas.

## Resultado

- Commits: `4099970` (test CA1), `665e526` (arreglo), `7bdbe75`, `dede004`, `192ce23` (fichas) y el de cierre.
- Ficheros: `scripts/react-compiler.test.ts` (importación de la configuración y plugin en un `beforeAll`), `scripts/react-compiler-0100.test.ts` (nuevo).
- Causa: carga en frío (`electron-vite` y Babel); sin límite propio.
- Rondas de revisión: 1 (APROBADO). Verificación VERDE; CA2 con cinco `check` seguidos.
- ADR nuevo: ninguno. Sin migraciones. BACKLOG: quitados los dos sospechosos del unitario; anotados `views-entidad.spec.ts:543` (sospechoso) y el calentamiento (mejora).
