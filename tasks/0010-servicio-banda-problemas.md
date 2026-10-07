---
id: '0010'
titulo: 'SERVICE: franja de los problemas de la entidad sobre el gráfico de tasa de error'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: ['0007', '0009']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0010-servicio-banda-problemas
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /problems` con `problemSelector=affectedEntities("id")`, `from`, `to`, `pageSize` y `sort`; campos `problemId`, `displayId`, `title`, `status`, `severityLevel`, `startTime` y `endTime` del esquema `Problem`; `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `problems.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio» (0006 a 0010). En el ejemplo de Dynatrace que pasó Dani, el gráfico de tasa de error
lleva encima una franja roja con el periodo del problema. A la pregunta de si iba en este lote o en
una ficha aparte, Dani: "Lo quiero en este lote" (2026-10-07). La petición completa está en la ficha 0006.

## Especificación

**Canal IPC nuevo `entities:problems`** (en `src/shared/ipc.ts`, con Zod):

- Entrada: `environmentId`, `entityId` (misma validación que `entities:problemCounts` de la 0007)
  y `timeRange` (el rango global).
- Main hace un `GET /problems` con `problemSelector=affectedEntities("<id>")`, el `from`/`to` del
  rango, `pageSize=100` y `sort=-startTime`. Si `totalCount` es mayor que lo recibido, la salida lo
  dice (`truncated`), como `problems:list`.
- Salida: lista de `{ problemId, displayId, title, status, severityLevel, startTime, endTime }`
  (`endTime` `null` o `-1` si sigue abierto, normalizado a `null`), `totalCount`, `truncated` e
  `invalid` (elementos que no cumplen el esquema).
- La prueba en vivo de la 0007 se amplía (solo lectura, solo comportamientos): que la lista con
  `affectedEntities` y rango da 200 y que los `startTime`/`endTime` cuadran con el estado.
- Errores con `reason` (ADR-0005). Sin refresco solo (ADR-0004). El simulador de los e2e responde.

**Franja en el gráfico «Tasa de error»** (0009), como en el ejemplo de Dynatrace:

- Encima del área del gráfico, una franja con un tramo por problema, del inicio al fin (los
  abiertos, hasta el final del rango), recortado al rango visible. Abiertos en el color de error del
  tema y cerrados en un tono apagado; siempre con un icono o texto además del color.
- Si se solapan, se dibujan en filas (como mucho 3; si hay más, la última dice «+N»).
- Tooltip con ratón y con foco: id visible (P-…), título, estado, inicio y fin (o «Activo»).
- Al pulsar un tramo (o Enter con el foco), se abre el detalle del problema (`/problems/<id>`), y
  «Volver» regresa a la página del servicio.
- Sin problemas en el rango, no hay franja (ni hueco). Si el canal falla, la franja enseña un aviso
  compacto con Reintentar y el gráfico sigue.
- Si la lista viene recortada (`truncated`), una nota pequeña lo dice.
- Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, main): con `fetch` simulado, una petición a `/problems` con
  `affectedEntities("<id>")`, el `from`/`to` del rango, `pageSize=100` y `sort=-startTime`; la
  salida normaliza `endTime` (`-1` → `null`) y marca `truncated` si `totalCount` es mayor.
- CA2 (unitario, main): un elemento que no cumple el esquema cuenta en `invalid` y no rompe la
  lista; un 400 acaba en error con `reason`.
- CA3 (unitario): el cálculo de tramos recorta al rango, lleva los abiertos hasta el final y reparte
  los solapados en filas (máximo 3 y «+N»).
- CA4 (e2e): en la página de un SERVICE del simulador con un problema abierto y uno cerrado, salen
  dos tramos con su estado (atributo y texto), y el tooltip enseña id, título, estado, inicio y fin.
- CA5 (e2e): pulsar un tramo (y Enter con el foco) abre el detalle de ese problema; «Volver» vuelve
  a la página del servicio sin pedir otra vez sus datos.
- CA6 (e2e): sin problemas no hay franja; si el canal falla, aviso con Reintentar y el gráfico de
  tasa de error sigue visible.
- CA7 (live, solo lectura): el informe dice si la consulta funciona y si las fechas cuadran con el
  estado, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA8 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un servicio real que haya tenido un problema en el rango, que la franja cae donde sube la tasa
  de error y coincide con lo que enseña Dynatrace; que al pulsarla abre el problema.

## Fuera de alcance

- La franja en los otros tres gráficos.
- Eventos que no son problemas (despliegues, cambios de configuración).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
