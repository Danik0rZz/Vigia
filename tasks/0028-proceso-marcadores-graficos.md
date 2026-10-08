---
id: '0028'
titulo: 'PROCESS_GROUP_INSTANCE: marcadores y gráficos de la página del proceso'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: proceso
depende_de: ['0027', '0018']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0028-proceso-marcadores-graficos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:processMetrics` de la 0027 y los canales de problemas de las fichas 0007 y 0010)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «proceso» (0027 a 0029). La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

En `ProcessEntityPage.tsx` se quita «Página en construcción». Mismos componentes que el host
(0018). Lo que no tenga métrica según la 0027 no se pinta.

**Marcadores** (cinco como mucho, centrados): CPU (media; debajo, máxima), Memoria (media; debajo,
máxima), Red (entrada media; debajo, salida), Disponibilidad o Recursos (el que haya, según la 0027) y Problemas (abiertos; cerrados). Umbrales de color de CPU como en el host (80 y 90 %, con
texto).

**Gráficos** (rejilla 2×2, sin líneas de rejilla): CPU (con la franja de problemas encima), Memoria,
Red (entrada y salida) y Salud de red o Recursos (el que haya). Tooltip, «Abrir en Métricas»,
exportar, errores por panel, rango global y «Actualizar», como en el host. Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): la página de un proceso del simulador enseña sus marcadores y gráficos con los valores
  y series del simulador; no enseña «Página en construcción».
- CA2 (e2e): con papeles `null`, sus marcadores y gráficos no salen y el resto sí.
- CA3 (e2e): la franja de problemas sale sobre la CPU y abre el problema.
- CA4 (e2e): rango global, «Actualizar» y errores por panel como en el host.
- CA5 (e2e): desde la tabla de procesos del host (0019), pulsar un proceso abre esta página con sus
  datos.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con procesos reales, que marcadores y gráficos cuadran con Dynatrace en el mismo rango.
- Que el marcador de Recursos (descriptores de fichero, en %) cuadra con Dynatrace: si sale 100
  veces más pequeño, la métrica es una fracción y hay que corregirlo.

## Fuera de alcance

- La información del proceso (0029) y las métricas de tecnología.

## Ideas surgidas (fuera de alcance)

- (developer) Recursos (descriptores de fichero) sin color de nivel: la ficha solo fija umbrales
  para la CPU. Si Dani los quiere, los del host (80 y 90 %) encajan.

**Decisiones del developer (2026-10-08):**

- Qué se pinta lo decide `processLayout` (`src/renderer/src/pages/entities/process-charts.ts`): un
  papel tiene datos si alguna de sus series trae un punto no nulo o su marcador tiene valor. CPU y
  memoria salen siempre (sin datos, «—», como en el host). Mientras carga o si el canal falla, se
  pinta lo que saldría con todos los papeles (los avisos con Reintentar salen en su sitio).
- El marcador de disponibilidad lleva los umbrales de Dani del lote «monitores» (error < 95 %,
  aviso < 99 %, con texto), con `availabilityLevel`; los textos de nivel se reutilizan de
  `entities.host.markers.levels` y `entities.monitor.markers.levels`.
- Ejes: CPU y recursos de 0 a 100 %; retransmisiones en % desde 0 sin tope (valores pequeños);
  memoria en bytes (`formatBytes`); red en bits/s (bytes × 8, `toBits`).
- «Abrir en Métricas»: las métricas del canal con
  `:filter(eq("dt.entity.process_group_instance","<id>")):splitBy(...)`, como el host con su
  dimensión (la de `tech.generic.*` según `docs/notas-api-v2.md`).
- Tests unitarios propios, aparte de los de la ficha: `process-charts.test.ts`.

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `c45fe8d` (`test(proceso): criterios de la ficha 0028`). Fallan porque la página
no existe (los `process-*` no aparecen: `element(s) not found`; `entities.process` sin textos), no
por el test: 9 e2e en rojo y los 3 unitarios de CA6 en rojo. Los e2e vecinos que se tocaron
(`CA7 (0008)`, ya sin PROCESS_GROUP_INSTANCE en construcción; `CA6 (0027)` y `CA3 (0019)`, con
el simulador ampliado) siguen en verde.

Cómo leen los tests la decisión del Orquestador de la 0027: el canal tiene métrica para los seis
papeles, así que «papel `null`» es el papel sin datos (series vacías y marcador a `null`), lo que
el simulador da con `sim.processEmpty`; ese papel no se pinta. Con la decisión de abajo, ajustada
en los tests (`d920e69`): con todos los datos, el cuarto marcador es Disponibilidad (Recursos no sale) y los
gráficos son exactamente CPU, Memoria, Red y Salud de red (CA1, CA4 y CA5); sin uno, sale el otro
(CA2). Recursos, «0,9 %» (0,9 en el simulador); la red, en bits por segundo como el host: bytesRx y
bytesTx llegan en BytePerSecond (`docs/notas-api-v2.md`), así que 2560 y 384 B/s salen como
«20,5 kbit/s» y «3,1 kbit/s». Nombres (testids) en el comentario del bloque de la 0028 de
`e2e/views.spec.ts`; textos en `entities.process.markers` y `entities.process.charts`.

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-08:**

- «Papel `null`» = papel sin datos (series vacías y marcador a `null`), como lo leen los tests.
- Con todos los datos, el cuarto marcador es **Disponibilidad** (antes que Recursos: dice si el
  proceso está vivo) y el cuarto gráfico es **Salud de red** (antes que Recursos); sin datos del
  primero, sale el segundo. Los tests lo fijan.
- Recursos se pinta como porcentaje tal cual (la métrica dice Percent): 0,9 → «0,9 %». Si con
  procesos reales resulta ser fracción, se corrige (prueba a mano).
- La red, como en el host: bits por segundo con `formatBitRate` (si la métrica viene en bytes, se
  multiplica por 8 según la unidad del catálogo de la 0027). Los tests lo fijan.

Cambios en el simulador: `processMetricsFail`, `processEmpty`, los problemas del proceso
(`processBandProblems`, uno abierto y uno cerrado) y las métricas del proceso también para los
procesos de la tabla del host (0019).

| Criterio | Test                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0028): la página de un proceso enseña sus marcadores y sus cuatro gráficos con los valores y las series del simulador, sin «Página en construcción»` |
| CA2      | `e2e/views.spec.ts` › los cuatro `CA2 (0028): …` (sin red ni salud de red; sin disponibilidad; sin recursos; sin disponibilidad, recursos ni salud de red)                       |
| CA3      | `e2e/views.spec.ts` › `CA3 (0028): la franja de problemas sale sobre el gráfico de CPU con los problemas del proceso, y pulsar un tramo abre el problema`                        |
| CA4      | `e2e/views.spec.ts` › `CA4 (0028): cambiar el rango global vuelve a pedir los datos; …` y `CA4 (0028): si falla el canal de métricas, …`                                         |
| CA5      | `e2e/views.spec.ts` › `CA5 (0028): desde la tabla de procesos del host, pulsar un proceso abre su página con sus marcadores y gráficos`                                          |
| CA6      | `src/renderer/src/locales/process-page.test.ts` › `CA6 (0028): textos de la página del proceso en es y en`                                                                       |

## Resultado

(pendiente)
