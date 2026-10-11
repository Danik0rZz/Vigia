---
id: '0086'
titulo: 'e2e inestable en el CI: cola de los gráficos de evidencias, «nunca más de 3 consultas a la vez» (views-problema-detalle.spec.ts)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0086-e2e-cola-graficos-evidencias
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani, por el Orquestador (2026-10-11): el test «v0.9.2: carga diferida y cola: una fila plegada no
pide; al desplegar 20 deprisa, nunca más de 3 consultas a la vez» (`e2e/views-problema-detalle.spec.ts`,
zona `@problema-detalle`) falla en el CI de GitHub y no en local. Dani decide ponerlo ya en
cuarentena (`@inestable`, con `arreglo: 0086`) y que esta ficha busque la causa y lo arregle, como
la 0077 y la 0078.

## Especificación

**Datos del fallo.** En el CI, tres veces en tres PR distintas (PR #10, run 38143008404, intento 1;
PR #11, run 38146900333, intento 1; PR #12, run 38152066082, intento 2):
`expect(sim.eventMetricMaxInFlight).toBe(3)` recibe menos de 3. Es la aserción «la cola sí se usa en
paralelo». La otra (`toBeLessThanOrEqual(3)`) no ha fallado. En local, 10 de 10 con 4 workers.

**Cómo es hoy el test.** El simulador responde cada consulta de gráfico de evidencia con un retardo
fijo (`sim.eventMetricDelayMs = 400`) y cuenta las que tiene en vuelo. El test despliega las 20 filas
una a una (`scrollIntoViewIfNeeded` y `click`) y después hace visible cada gráfico, porque cada uno
se pide al verse. Que haya 3 a la vez depende de que el test pida la siguiente antes de que pasen
400 ms desde la anterior.

1. **Causa antes que arreglo.** Explicar en la ficha por qué en el CI no se llega a 3. Hipótesis a
   comprobar, no a dar por buenas:
   - **Ritmo del test frente al retardo fijo:** en el runner del CI (4 núcleos, 4 workers), desplegar
     y desplazar cada fila tarda más de 400 ms, así que cada consulta acaba antes de que salga la
     siguiente. Es un fallo del test, no de la app.
   - **Red de la app (ficha 0079):** `gatedFetch` (`src/main/dynatrace/network.ts`) hace que la
     primera petición a cada host de cada sesión vaya sola y las demás esperen. Comprobar si en este
     test alguna consulta de gráfico es la primera a su host (no debería: antes va el detalle del
     problema) o si otra cosa las serializa.
   - **La cola de la app:** que en algún caso la cola del renderer deje de lanzar en paralelo.

   Cómo acercarse al CI: los artefactos de los runs fallidos (`test-results/`, 7 días), el log de main
   que guarda `e2e/failure-capture.ts`, y en local, el spec con la máquina cargada (la suite entera a
   la vez) o con `--repeat-each`. Nada de subir tiempos sin causa.

2. **Arreglo donde está la causa.** Si es el test, que no dependa del ritmo de quien lo lanza: por
   ejemplo, que el simulador retenga las respuestas de los gráficos hasta que el test las suelte, o
   que el test espere a una condición (que haya 3 en vuelo) en lugar de comprobar un máximo al final.
   Nada de `waitForTimeout` nuevo. Lo que el test garantiza no cambia: nunca más de 3 a la vez y la
   cola usa las 3. Si es la app, se arregla con su test (unitario o e2e) que lo demuestre; si el
   arreglo cambia lo que ve el usuario o toca `gatedFetch` (seguridad de TLS, ficha 0079), se para y
   se pregunta (`[ALCANCE]`): en ese caso la ficha pasa a llevar `exclusiones: [seguridad]`.
3. **Fuera de cuarentena:** se quitan `@inestable` y la anotación `arreglo`, y su fila de «Tests en
   cuarentena» del BACKLOG.

El título del test no cambia; si el cuerpo cambia mucho, se añade «, arreglo (0086)» al final.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la
   duda, no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **puede no cumplirse**, si la causa está en la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo el `[ALCANCE]` del punto 2.

## Criterios de aceptación

- CA1: el test pasa 10 de 10 con `--repeat-each 10` en su spec con los workers de siempre, y 10 de 10
  con el spec entero y `--workers=1`.
- CA2: el test pasa en el CI de la PR de la ficha (ya en el proyecto `e2e`, el que bloquea «CI ok»).
- CA3: el test ya no lleva `@inestable` ni la anotación `arreglo`, y la guarda de la 0075
  (`scripts/e2e-tags.test.ts`) sigue en verde.
- CA4: si la causa estaba en la app, un test (unitario o e2e) que falla sin el arreglo y pasa con él,
  con «(0086)» en el nombre.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Los demás tests de vistas que fallaron una vez y pasaron al repetir (tooltips, tamaño de ventana):
  siguen anotados en el BACKLOG; tienen su ficha si se confirman.
- Cambiar los workers (ficha 0087).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

- 2026-10-11: el test está en cuarentena (`@inestable`, anotación `arreglo: 0086`) desde hoy.
