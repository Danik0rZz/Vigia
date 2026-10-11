---
id: '0097'
titulo: 'e2e inestable en el CI: tabla de evidencias virtualizada, la altura de una fila desplegada al pintar su gráfico (views-problema-detalle.spec.ts)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0097-e2e-altura-fila-con-grafico
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Orquestador (2026-10-11), con el camino que Dani aprobó en la 0086 («si se confirma, va a cuarentena
con su ficha de arreglo»): otro test de `e2e/views-problema-detalle.spec.ts` falla en el CI y pasa al
relanzar; hace falta su ficha de arreglo para ponerlo en cuarentena.

## Especificación

**El test** (va a cuarentena con `arreglo: 0097`): «v0.10.0: tabla virtualizada: desplegar una fila
con gráfico recalcula la altura (la siguiente no se solapa)» (`@problema-detalle`). Falla en
`expect(await bottomOf(detail)).toBeGreaterThan(loadingBottom)`. Dos fallos en el CI: PR #16 (run
38159322552, intento 1) y PR #12 (run 38160295714, intento 1). Pasa al relanzar.

**Cómo es hoy el test.** Despliega una fila, mide el borde inferior del detalle mientras el gráfico
carga (`loadingBottom`), espera a que el gráfico sea visible y a que la siguiente fila no se solape
(con `expect.poll`), y entonces comprueba **una sola vez, sin esperar**, que el detalle ha crecido.
Si en el runner el gráfico ya es visible pero el detalle aún no tiene su altura final (o la
siguiente fila «no se solapa» porque todavía nada ha crecido), la comprobación llega antes de tiempo.

Ya son 4 fallos en el CI y bloquea las PR (la de la 0088 cayó dos veces seguidas por él).

**Pista de la 0086:** su fallo era del test (el retardo fijo del simulador era más corto que cada
despliegue de fila en el runner de Windows) y se arregló con una compuerta en el simulador
(`sim.eventMetricGate`, como `detailGate`) en vez de esperas fijas. Este test usa también un retardo
fijo (`sim.eventMetricDelayMs = 600`) para ver el estado «cargando»: la compuerta probablemente sirve
aquí (retener la respuesta, medir con el detalle cargando, soltarla y esperar a que crezca).

Por qué es una ficha aparte de la 0086: el mecanismo es otro (la medida de la fila en la tabla
virtualizada, no la cola de consultas), y así cada arreglo se revisa y se deshace por separado.

1. **Causa antes que arreglo.** Confirmar si es solo eso (la aserción sin espera) o si la tabla
   tarda en volver a medir la fila, o si la mide mal alguna vez (la app). Cómo acercarse al CI: los
   artefactos de los runs fallidos (`test-results/`, 7 días), el log de `e2e/failure-capture.ts` y en
   local la suite en paralelo o `--repeat-each`. Nada de subir tiempos sin causa ni `waitForTimeout`.
2. **Arreglo donde está la causa.** Si es el test, se espera a la condición (que el detalle crezca),
   sin cambiar lo que garantiza: el detalle crece al pintar el gráfico y la siguiente fila no se
   solapa ni antes ni después. Si es la app, con su test que lo demuestre; si cambia lo que ve el
   usuario, se para y se pregunta (`[ALCANCE]`).
3. **Fuera de cuarentena:** se quitan `@inestable` y `arreglo`, y su fila de «Tests en cuarentena»
   del BACKLOG.

El título no cambia; si el cuerpo cambia mucho, se añade «, arreglo (0097)» al final.

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
- CA2: el test pasa en el CI de la PR de la ficha (en el proyecto `e2e`, el que bloquea «CI ok»).
- CA3: el test ya no lleva `@inestable` ni la anotación `arreglo`, y la guarda de la 0075
  (`scripts/e2e-tags.test.ts`) sigue en verde.
- CA4: si la causa estaba en la app, un test (unitario o e2e) que falla sin el arreglo y pasa con él,
  con «(0097)» en el nombre.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Los otros inestables del mismo spec (0086 y 0096).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

- 2026-10-11 (developer): el test queda en cuarentena (`@inestable`, `arreglo: 0097`) con su fila en «Tests en cuarentena» del BACKLOG, a la espera del arreglo de esta ficha.
