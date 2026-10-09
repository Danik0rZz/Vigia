---
id: '0050'
titulo: 'PROCESS_GROUP: las 20 instancias de más CPU con :sort/:limit, el total real y la lista completa a demanda'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
