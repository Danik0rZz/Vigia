---
id: '0040'
titulo: 'DISK: página del disco, a la que se llega pulsando un disco del host'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host-2
depende_de: ['0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0040-pagina-disco
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics` (`metricSelector=builtin:host.disk.*`), `GET /metrics/{metricId}`, `GET /metrics/query` y `GET /entities/{entityId}` (0014); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scopes `metrics.read` y `entities.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host-2» (0039 a 0042). Dani (2026-10-09): "Cuando se haga clic sobre un disco, nos debería
llevar a una página como la de HOST. Las métricas son las de `builtin:host.disk.*`."

## Especificación

**Tipo nuevo.** `DISK` entra en el registro de páginas de entidad (`registry.ts`), con su nombre
(«Disco» / «Disk») y su página. En la tabla de discos del host (0019), cada fila enlaza a
`#/entities/DISK/<id>` con el nombre; «Volver» regresa al host.

**Análisis de métricas (paso 0, en vivo y solo lectura),** con la regla de la 0022: catálogo de
`builtin:host.disk.*`, cuáles tienen datos para 3 discos de los hosts de muestra
(`entitySelector=entityId("<disco>")` o filtro por `dt.entity.disk`), y elección por papel:

| Papel       | Qué se busca                                              |
| ----------- | --------------------------------------------------------- |
| Uso         | % usado (`usedPct`, ya confirmada)                        |
| Espacio     | usado y libre en bytes (`used` y `avail`, ya confirmadas) |
| Rendimiento | bytes leídos y escritos por segundo (ya confirmadas)      |
| Latencia    | tiempo de lectura y escritura, si existen                 |
| Cola        | longitud de la cola, si existe                            |
| Inodos      | inodos libres, si existen                                 |

**Canal `entities:diskMetrics`** (Zod): entrada `environmentId`, `entityId`
(`^DISK-[0-9A-F]{16}$`) y `timeRange`; series y totales por papel (`null` si no hay métrica);
errores con `reason`; simulador.

**Página** (orden de las fichas 0036 y 0037):

- **Marcadores:** Uso (% máximo del rango; aviso 80 %, error 90 %, con texto), Libre (último dato),
  Lectura y Escritura (medias), Latencia o Cola (el que haya) y Problemas.
- **Gráficos** (2×2, sin rejilla): Uso % (con la franja de problemas), Espacio (usado y libre
  apilados), Lectura y escritura, y Latencia o Cola.
- **Tarjeta «Información»** al final: lo que traiga la entidad `DISK` (claves vistas en el paso 0),
  con su relación con el host («Disco de»).

## Criterios de aceptación

- CA1 (live, solo lectura): el informe trae el catálogo, qué métricas tienen datos y las claves de
  la entidad, sin ids ni nombres. Se salta sin `.env.live.local`.
- CA2 (unitario): el registro tiene `DISK` con su página y su nombre en es y en.
- CA3 (unitario, main): consultas con las métricas elegidas, el id y el rango; transformación por
  papel con papeles `null`; 400/404 → error con `reason`.
- CA4 (e2e): pulsar un disco en la tabla del host abre su página con su nombre; «Volver» regresa
  al host sin volver a pedir sus datos.
- CA5 (e2e): la página del disco del simulador enseña marcadores, gráficos e información con sus
  valores.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un host real, pulsar un disco y comprobar que su página cuadra con Dynatrace.

## Fuera de alcance

- Interfaces de red como página propia.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
