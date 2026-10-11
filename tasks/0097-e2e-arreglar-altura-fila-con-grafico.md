---
id: '0097'
titulo: 'e2e inestable en el CI: tabla de evidencias virtualizada, la altura de una fila desplegada al pintar su gráfico (views-problema-detalle.spec.ts)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

- (developer) Con el spec entero, `--workers=1` y `--repeat-each 10`, «v0.10.0: tabla de evidencias:
  estado propio por evento en un problema cerrado, columnas y celdas» falló 2 de 10 en local
  (2026-10-12); solo pasó 15/15 y el spec entero con `--repeat-each 4`, 4/4. No se capturó el error
  (la tanda siguiente borró `test-results/`). Es otro test y otro mecanismo: si vuelve a salir,
  su ficha.

## Notas del revisor

### Ronda 1: APROBADO

- **Causa demostrada, en el test.** En los dos fallos del CI el valor recibido era el esperado (796 y 725 px): el detalle «cargando» se medía con el gráfico ya pintado porque el retardo fijo de 600 ms se agotaba en el runner. Reproducido en local con 40 ms (6 de 6). La tabla mide bien. CA4 no aplica.
- **Arreglo en la causa, sin subir tiempos.** Quita `eventMetricDelayMs = 600`, sin `waitForTimeout`; retiene la consulta con `sim.eventMetricGate` (0086), mide con «cargando», la suelta en un `finally` y espera el crecimiento con `expect.poll`. Se mantienen la comprobación de solape y la de una sola consulta.
- **CA3.** Sin `@inestable` ni `arreglo`, fuera de «Tests en cuarentena» y con «, arreglo (0097)» en el título.
- **Reglas.** Sin `src/`, IPC, API ni dependencias; sin datos del tenant.
- **Los 2 fallos de 470 en «tabla de evidencias: estado propio por evento en un problema cerrado…» (línea 581).** CA1 se cumple tal como está escrito (su sujeto es el test de esta ficha, 10 de 10). Esos fallos son algo nuevo y van aparte: ese test no usa la compuerta ni los mini gráficos, y con `--workers=1` el `finally` deja la compuerta en `null`. Sin captura no se puede saber si ya fallaba antes.

Opcional: al relanzar ese spec, guardar `test-results/` antes de la siguiente tanda.

## Verificación

Test-writer (2026-10-12): no se escriben tests antes de conocer la causa; ningún criterio se puede
escribir hoy como un test que falle por falta de código (ficha de causa y arreglo, como la 0086).

- CA1 es una medición, no un test nuevo. La hacen el developer antes de entregar y el verifier:
  `npm run test:e2e:nobuild -- e2e/views-problema-detalle.spec.ts -g "recalcula la altura" --repeat-each 10`
  con los workers de siempre (10/10), y `npm run test:e2e:nobuild -- e2e/views-problema-detalle.spec.ts --workers=1`
  (el spec entero, 10/10, con `--repeat-each 10`). Como el test está en cuarentena, mientras lleve
  `@inestable` solo corre en `--project=inestables`.
- CA2 lo comprueba el verifier en el CI de la PR de la ficha: el test corre en el proyecto `e2e`
  (ya sin `@inestable`) y pasa.
- CA3: hoy el test lleva `@inestable` y `arreglo: 0097` (`views-problema-detalle.spec.ts:309-312`),
  y `npx vitest run scripts/e2e-tags.test.ts` pasa (27/27 el 2026-10-12). Tras el arreglo, el test
  lleva solo `{ tag: '@problema-detalle' }`, sale su fila de «Tests en cuarentena» del BACKLOG y la
  guarda sigue en verde. Lo comprueba el verifier (`--list --project=e2e` lo incluye;
  `--project=inestables`, no).
- CA4 depende de dónde esté la causa. Si está en la app (medida de la fila en la tabla
  virtualizada), el developer escribe el test que la demuestra (unitario junto al código o e2e en
  `views-problema-detalle.spec.ts`, con «(0097)» en el nombre) y el verifier comprueba que falla sin
  el arreglo (revirtiendo solo el cambio de producción) y pasa con él. Si la causa está en el test
  (aserción sin espera o retardo fijo del simulador), CA4 no aplica y la ficha lo dice en «Resultado».

Verificación 2026-10-12, commit 448e04b, rango `integra/20261011-20..fix/0097-e2e-altura-fila-con-grafico`: **VERDE**

- `npm run check`: 4137 tests, cobertura ok (líneas 93,58 %, ramas 90,03 %). En el primer pase falló por timeout `CA3 (0059)` de `scripts/react-compiler.test.ts` (sospechoso ya anotado); aislado ×3 pasó y el `check` completo repetido salió verde.
- `test:e2e:affected`: 62 passed en 54,3 s, un pase; incluye «tabla de evidencias: estado propio por evento en un problema cerrado…» (ok).
- CA2 (CI de la PR): lo comprueba el Orquestador tras abrir la PR.

## Resultado

- 2026-10-11 (developer): el test queda en cuarentena (`@inestable`, `arreglo: 0097`) con su fila en «Tests en cuarentena» del BACKLOG, a la espera del arreglo de esta ficha.
- 2026-10-12 (developer): **causa en el test, no en la app.** Los dos fallos del CI tienen
  `Received` igual a `Expected` (796 y 725): `loadingBottom` se midió con el gráfico ya pintado.
  El retardo fijo (`eventMetricDelayMs = 600`) cuenta desde la petición, y entre que «cargando» se
  ve y se mide pasan varias llamadas a Playwright, que en el runner saturado se comen esos 600 ms.
  Reproducido en local con el mismo síntoma exacto bajando el retardo a 40 ms (6 de 6 fallos, con
  `Received` = `Expected`). La tabla mide bien: con el gráfico, el detalle crece 76 px y la
  siguiente fila baja con él; la tabla no desplaza el scroll al crecer (`scrollTop` del
  contenedor a 0 antes y después). **Arreglo:** el test retiene la consulta con
  `sim.eventMetricGate` (ficha 0086), espera a tenerla en vuelo, mide con «cargando» (y comprueba
  que sigue cargando), la suelta en un `finally` y espera con `expect.poll` a que el detalle crezca;
  la comprobación de que la siguiente no se solapa, antes y después, sigue igual. Sale de
  cuarentena (sin `@inestable` ni `arreglo`), su fila de «Tests en cuarentena» del BACKLOG fuera y
  el título acaba en «, arreglo (0097)». CA4 no aplica (la causa no estaba en la app).
  Medición (CA1): `-g "recalcula la altura" --repeat-each 10`, 10/10; con respuesta instantánea
  tras soltar la compuerta (retardo 0, solo en local), 6/6; spec entero `--workers=1 --repeat-each 10`,
  el test 10/10 (468 pasan; 2 fallos de otro test, en «Ideas»).
- Commits: `f1cd723` (arreglo), más los de ficha, revisión y verificación. Fichero principal: `e2e/views-problema-detalle.spec.ts`. Una ronda de revisión (APROBADO). ADR nuevo: ninguno. Sin migraciones. CA2 queda pendiente del CI de la PR. Ver nota del BACKLOG sobre el test de la línea 581 (sospechoso, sin captura).
