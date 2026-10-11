---
id: '0096'
titulo: 'e2e inestables en el CI: tooltips que no llegan a abrirse (evidencia de 45 días y grid de Problemas)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0096-e2e-tooltips-en-el-ci
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Orquestador (2026-10-11), con el camino que Dani aprobó en la 0086 («si se confirma, va a cuarentena
con su ficha de arreglo»): un segundo test de vistas falla en el CI y pasa al relanzar; hace falta
su ficha de arreglo para ponerlo en cuarentena. Que el Planificador valore si se junta con otro de
la misma familia (tooltips que no llegan a abrirse).

## Especificación

**Los dos tests.**

- **A, confirmado (va a cuarentena con `arreglo: 0096`):** `e2e/views-problema-detalle.spec.ts`,
  «v0.10.2: evidencia de 45 días: últimos 7 por defecto, etiquetas de fecha variadas (no «00:00»),
  nota y sin línea de inicio» (`@problema-detalle`). Mueve el ratón sobre el lienzo del gráfico
  (ECharts) y espera el tooltip `.vigia-chart-tooltip` con fecha y hora; falla con «element(s) not
  found». Tres fallos: CI de la PR #12 (run 38152066082, intento 1, y run 38157462342, intento 1) y
  una vez en local con 8 workers (developer de la 0085). Pasa al relanzar.
- **B, sospechoso (un fallo):** `e2e/views-problemas.spec.ts`, «grid de Problemas: ARIA, orden por
  columna, barra de estado y afectados» (`@problemas`). Pasa el ratón por la barra de estado con
  `hoverFresh` y espera el tooltip de Radix (`role="tooltip"`) con «Cerrado»; no aparece. Un fallo:
  CI de la PR #12, run 38152066082, intento 1. No se pone en cuarentena todavía: si vuelve a fallar
  antes de que acabe esta ficha, entra en cuarentena con la misma `arreglo: 0096`, sin ficha nueva.

Se juntan porque el síntoma es el mismo (el tooltip no se abre tras mover el ratón, en el CI) y
puede tener la misma causa (eventos de ratón, foco o tamaño de la ventana en el runner); los
mecanismos son distintos (ECharts sobre canvas y Radix), así que la causa se busca para cada uno.

1. **Causa antes que arreglo**, para cada test. Hipótesis a comprobar: el ratón se mueve antes de
   que el gráfico o la barra estén estables (animación, redimensionado); el punto elegido (60 % del
   ancho del lienzo) cae fuera de la serie con otros tamaños; el tooltip se abre y se cierra antes de
   comprobarlo; la ventana no tiene el foco o el tamaño esperado en el CI. Cómo acercarse al CI: los
   artefactos de los runs fallidos (`test-results/`, 7 días), el log de `e2e/failure-capture.ts` y en
   local la suite en paralelo o `--repeat-each`. Nada de subir tiempos sin causa ni `waitForTimeout`.
2. **Arreglo donde está la causa.** Si es el test, se espera a una condición de la interfaz antes de
   mover el ratón o se apunta a un punto que tenga dato. Si es común a los dos, se arregla en el
   ayudante (`hoverFresh`, `moveToNeutral` o uno nuevo en `e2e/views/helpers.ts`). Si es la app, con
   su test que lo demuestre; si cambia lo que ve el usuario, se para y se pregunta (`[ALCANCE]`).
3. **Fuera de cuarentena:** se quitan `@inestable` y `arreglo` del test A (y del B si entró), y su
   fila de «Tests en cuarentena» del BACKLOG; en la línea de «Sospechosos de inestables» del BACKLOG
   se quitan los dos.

Los títulos no cambian; si el cuerpo cambia mucho, se añade «, arreglo (0096)» al final.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la
   duda, no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **puede no cumplirse**, si la causa está en la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo el `[ALCANCE]` del punto 2.

## Criterios de aceptación

- CA1: los tests A y B pasan 10 de 10 con `--repeat-each 10` en su spec con los workers de siempre, y
  10 de 10 con su spec entero y `--workers=1`.
- CA2: los dos pasan en el CI de la PR de la ficha (en el proyecto `e2e`, el que bloquea «CI ok»).
- CA3: ninguno lleva `@inestable` ni la anotación `arreglo`, y la guarda de la 0075
  (`scripts/e2e-tags.test.ts`) sigue en verde.
- CA4: si la causa estaba en la app, un test (unitario o e2e) que falla sin el arreglo y pasa con él,
  con «(0096)» en el nombre.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- El test de la cola de gráficos (0086) y los workers (0087).
- Otros tests con tooltips que no han fallado.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
