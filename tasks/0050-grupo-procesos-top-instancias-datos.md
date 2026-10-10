---
id: '0050'
titulo: 'PROCESS_GROUP: las 20 instancias de más CPU con :sort/:limit, el total real y la lista completa a demanda'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0050-grupo-procesos-top-instancias-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/query` con las transformaciones `:sort` y `:limit` ("Metrics selector transformations", documentación oficial enlazada desde la OpenAPI) y `GET /entities` (`entitySelector=type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<grupo>"))`, `pageSize`, `totalCount`); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read` (ya en uso).
migracion: no
rondas_revision: 1
---

## Petición original

Lote «grupo-procesos-2» (0050 y 0051). Dani (2026-10-10), sobre la página del process group (0032):
"Con grupos grandes, la tabla de instancias enseña las 20 que más CPU consumen, con un aviso de que
hay más y un botón «Ver todas» que abre un modal centrado con una transición de entrada vistosa,
con la lista completa. Ojo: elegir las de más CPU exige `:sort`/`:limit` en la consulta de la 0031,
que hay que probar antes en vivo (solo lectura); y la lista completa sigue topada a ~498 instancias
por el límite de 1000 series, así que el modal debe avisar si está recortada."

Recoge también la mejora anotada en el BACKLOG (surgida en la 0031): con más de unas 498
instancias, quedarse con las de más CPU en vez de un subconjunto cualquiera.

## Especificación

**Hoy** (`src/main/modules/process-group-metrics.ts`): la consulta de marcadores pide CPU y memoria
por instancia (`:parents:splitBy(instancia, host):avg:names`, `resolution=Inf`) y ordena en main.
Con el tope de 1000 series, por encima de unas 498 instancias la respuesta llega recortada
(`partial`) con un subconjunto que no son las de más CPU, e `instances.total` cuenta solo las
recibidas (`docs/notas-api-v2.md`).

**Paso 0, en vivo y solo lectura**, con los grupos de muestra de la 0031 (y, si hay, uno con muchas
instancias):

- que la expresión de CPU por instancia admite `:sort(value(avg,descending))` y `:limit(20)` con
  `resolution=Inf` y devuelve las 20 de más CPU, en orden (comprobado contra ordenar la lista
  completa en el test);
- cómo traer la **memoria de esas 20** (una expresión de memoria con el mismo orden por CPU no es
  posible en una sola: se prueba filtrar la de memoria por los ids de las 20, o pedir la memoria de
  todas y casar por id), y se elige la forma con menos peticiones;
- que `GET /entities` con el selector de instancias del grupo y `pageSize=1` da `totalCount` (el
  total real de instancias), igual al número de instancias de la lista cuando no hay recorte;
- dónde está el tope de la lista completa con CPU, memoria y host por instancia.

Solo comportamientos en el informe; lo observado, a `docs/notas-api-v2.md`.

**Canal `entities:processGroupMetrics` (cambia):** `instances` pasa a ser
`{ items, total, totalKnown }`: `items`, las **20 de más CPU** (con su memoria y su host);
`total`, el total real de instancias del grupo (de `totalCount`), y `totalKnown: false` si no se
pudo saber (sin `entities.read` o error: entonces `total` es el número recibido y la vista lo dice).

**Canal nuevo `entities:processGroupInstances`** (Zod), a demanda (lo llama el modal de la 0051, no
la página): entrada `environmentId`, `entityId` (el de la 0031) y `timeRange`; salida: la lista
completa ordenada por CPU (id, nombre, host, CPU y memoria), `total` y `truncated` (la API recortó:
`partial` o menos instancias que el total real). Errores con `reason`. El simulador de los e2e
responde, también con un grupo recortado.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice si `:sort`/`:limit` funcionan con `Inf` y en qué orden
  vuelven, cómo se trae la memoria de las 20 y si `totalCount` cuadra, sin ids ni nombres. Se salta
  sin `.env.live.local`.
- CA2 (unitario, main): con `fetch` simulado, la consulta de CPU por instancia lleva `:sort` y
  `:limit(20)`; la salida trae 20 instancias en orden de CPU con su memoria y host.
- CA3 (unitario, main): `total` sale de `totalCount`; sin él (403 o error), `totalKnown: false` y el
  número recibido.
- CA4 (unitario, main): `entities:processGroupInstances` devuelve la lista completa ordenada y
  `truncated: true` cuando la respuesta viene recortada o trae menos que el total.
- CA5 (unitario, main): 400 o 404 → error con `reason` en los dos canales.
- CA6 (e2e): el simulador responde a los dos canales (con un grupo de 30 instancias y otro
  recortado) y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0051)

## Fuera de alcance

- Paginar más allá del tope de 1000 series.
- Cambiar los gráficos del grupo («CPU por instancia» sigue con las 5 de más CPU).

## Ideas surgidas (fuera de alcance)

- (developer) `entities:processGroupInstances` no dice si su `total` es el real: sin `totalCount`
  (403 o error en `/entities`) es el número recibido y `truncated` solo refleja el recorte de la
  API. Si el modal de la 0051 necesita distinguirlo, añadir `totalKnown` también a este canal.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA6 con sus tests: expresión exacta, orden por CPU, `pageSize=1`, 403 y 500 en `/entities`,
recorte por ratio y por total, `reason` en los dos canales. Tras `27cbfe6` solo cambia
`process-group-charts.test.ts` (0031/0032), que gana `totalKnown: true` para compilar sin cambiar
lo que comprueba. Expresiones iguales a las probadas en vivo (`:sort(value(avg,descending))`, con
`:limit(20)` en las de la página), 6 y 2 por consulta. `GET /entities` y `totalCount` en la OpenAPI;
fallback del total solo ante `DtError`. Canal `entities:processGroupInstances` con Zod de entrada
(id estricto) y salida, en la cobertura de canales; reutiliza `processGroupMetricsRejected`. Sin
migración ni dependencias; nada del tenant. Lo no probado en vivo (más de ~500 instancias) está
dicho en la ficha y en las notas.

Sugerencias, no bloquean:

- Para la 0051: `instancesTruncated` (`process-group-instances.ts:62`) solo mira `partial`; con
  `totalKnown: true` el marcador diría «al menos 600» aunque sea exacto, y la tabla enseña 20 sin
  avisar de que hay más hasta que entre la 0051.
- `truncated` también es `true` si `totalCount` cuenta instancias sin series: el aviso del modal
  podría hablar de recorte sin haberlo.
- Añadir `totalKnown` a `entities:processGroupInstances` (idea del developer): lo decide la 0051.

## Verificación

Tests escritos en `27cbfe6` (`test(entidades): criterios de la ficha 0050 (#0050)`).

**Paso 0 en vivo (solo lectura, `now-24h`)**, en
`src/main/modules/process-group-top-instances-explore.live.test.ts` (informe en
`live-reports/process-group-top-instances-explore.json`, ignorado). Tres grupos de 51 a 150
instancias, elegidos entre las primeras 500 instancias del tenant por su `isInstanceOf`:

- `<CPU>:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names:sort(value(avg,descending)):limit(20)`
  con `resolution=Inf`: 200, `metricId` igual a la expresión, 20 series de más a menos CPU, las
  mismas y en el mismo orden que ordenar en main la lista completa, con nombre y host en
  `dimensionMap`. También vale con `:names` detrás de `:limit`. Con `:limit(2)` da las 2 de más CPU;
  `:limit` sin `:sort` da unas cualesquiera; `ascending` invierte el orden. La lista sin `:sort` no
  viene ordenada.
- Memoria de las 20: (a) la memoria de todas en la misma consulta (totales + CPU de las 20 +
  memoria, 6 expresiones) trae la de las 20, casada por id; (b) una consulta aparte con
  `:filter(or(eq("dt.entity.process_group_instance","<id>"),…))` también funciona y da los mismos
  valores. **Decisión del test-writer (delegada, refinable): (a)**, una petición menos. Con el tope
  de 1000 series, (a) cabe hasta unas 976 instancias (4 + 20 + N).
- `GET /entities` con el selector del grupo y `pageSize=1`: 200 con `totalCount`, igual al número
  de instancias de la lista y al de series de CPU (sin recorte).
- Tope: `dimensionCountRatio` da un máximo deducido de 100000 por métrica, que no es el de 1000
  series de la respuesta. Con grupos de 150 instancias como mucho **no se pudo comprobar en vivo**
  dónde corta la lista completa (por cálculo, 2·N ≤ 1000: unas 500 instancias) ni si `:limit(20)`
  elige las de más CPU entre todas cuando el grupo pasa del tope.
- Lo observado queda aquí; falta pasarlo a `docs/notas-api-v2.md` (el test-writer no escribe docs).

**Decisiones del test-writer (delegadas, refinables):**

- La consulta de marcadores de `entities:processGroupMetrics` lleva los 4 totales, la CPU por
  instancia con `:sort(value(avg,descending)):limit(20)` y la memoria por instancia de todas (sin
  `:sort`). Si hay menos de 20 instancias con CPU, las que solo traen memoria van al final (como en
  la 0031).
- `GET /entities` lleva el selector del grupo, `pageSize=1` y el mismo `from`/`to` que las métricas.
- Sin `totalCount` (403, 500…), `total` es el número de instancias distintas recibidas (con CPU o
  con memoria), no solo las 20.
- `entities:processGroupInstances`: una consulta con `resolution=Inf` con exactamente
  `<CPU por instancia>:sort(value(avg,descending))` y `<memoria por instancia>` (sin totales), y la
  de `/entities`; salida `{ items, total, truncated }`, con `items` de la forma de los de
  `processGroupMetrics` (id, name, hostId, hostName, cpu, memory). Sin `totalCount` no se fija qué
  hace (la ficha no lo dice).
- CA5 se prueba con el 400/404 en `/metrics/query`; un fallo solo de `/entities` es el caso de CA3.
- Los tests de la 0031 se adaptan al contrato nuevo (tres peticiones, `totalKnown`, la expresión
  con `:sort`/`:limit`).

**Criterio → test:**

| CA  | Test                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1 | `src/main/modules/process-group-top-instances-explore.live.test.ts`, `CA1 (0050): el informe no contiene ningún id ni nombre observado` (pasa en vivo; se salta sin `.env.live.local`) |
| CA2 | `src/main/ipc/handlers/process-group-metrics.test.ts`, `describe CA2 (0050)` (3 tests)                                                                                                 |
| CA3 | mismo fichero, `describe CA3 (0050)` (totalCount; 403 y 500 en `/entities`)                                                                                                            |
| CA4 | mismo fichero, `describe CA4 (0050)` (consultas, lista ordenada, recorte por ratio y por total, entrada); `src/shared/ipc.test.ts`, `CA4 (0050): contrato…`                            |
| CA5 | mismo fichero, `describe CA5 (0050)` (los dos canales con 400 y 404)                                                                                                                   |
| CA6 | `e2e/views.spec.ts`, los cuatro `CA6 (0050): …` (grupo de 30 y grupo recortado, en los dos canales)                                                                                    |

Además, el canal nuevo en `channel-coverage.test.ts` y en `modules.test.ts` (sin secretos).

Ejecución antes del código: unitarios, 21 fallan por lo que falta (canal desconocido, sin
`:sort`/`:limit`, sin `/entities`, sin `totalKnown`); e2e, los 4 de la 0050 fallan (sin
`:sort`/`:limit`, 30 en vez de 20, `UNKNOWN_CHANNEL`) y los de la 0031 y la 0032 siguen en verde con
el simulador ampliado.

**Decisiones del developer (delegadas, refinables):**

- `entities:processGroupInstances` sin `totalCount`: `total` es el número de instancias recibidas
  y `truncated` solo es `true` si la API recortó (ratio > 1). La salida se queda en
  `{ items, total, truncated }`, como fija el test de contrato (sin `totalKnown`; ver "Ideas").
- Un fallo de `/entities` solo se absorbe si es un `DtError` (403, 500, red, respuesta no
  válida): cualquier otro error sigue subiendo. La consulta a `/entities` va en paralelo con las de
  métricas.
- `entities:processGroupInstances` reutiliza el motivo `processGroupMetricsRejected` en el 400/404
  (es la misma consulta de métricas del grupo, más larga): sin textos nuevos.
- Las dos consultas quedan dentro del límite de 10 expresiones por `metricSelector` (6 y 2).
- `process-group-charts.test.ts` (renderer) construía `instances` sin `totalKnown`: se le añade
  `totalKnown: true` para que compile con el contrato nuevo (no cambia lo que comprueba).
- Lo observado en el paso 0 está en `docs/notas-api-v2.md`, "Las instancias de más CPU de un
  process group (ficha 0050)".

### Verifier, 2026-10-10, commit `6fda8ca`, rango `main..feat/0050-grupo-procesos-top-instancias-datos`: VERDE

- check: 3168 tests en 174 ficheros, cobertura ok.
- e2e completo (toca `src/shared/ipc.ts`): 331/331, sin intermitentes.

## Resultado

- Commits (`main..HEAD`): `27cbfe6` tests, `3bdcddc` código, `a29b815` notas de la API y las fichas de revisión y verificación.
- Ficheros principales: `src/main/modules/process-group-metrics.ts`, `src/main/ipc/handlers/modules.ts`, `src/shared/ipc.ts` y `src/shared/modules.ts`; tests en `process-group-metrics.test.ts`, `ipc.test.ts` y `e2e/views.spec.ts`; prueba en vivo `process-group-top-instances-explore.live.test.ts`; `docs/notas-api-v2.md`.
- Rondas de revisión: 1 (aprobada). Verifier en verde (3168 unitarios, 331 e2e).
- ADR nuevo: ninguno. Sin migraciones.
- Pendiente para la 0051: lo del revisor sobre `instancesTruncated` y `truncated`, anotado en su ficha. Sin comprobar en vivo el corte de la lista completa con más de unas 500 instancias.
