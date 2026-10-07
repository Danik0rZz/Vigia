---
id: '0008'
titulo: 'SERVICE: marcadores arriba de la página (peticiones, tiempos y problemas)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: ['0006', '0007']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0008-servicio-marcadores
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:serviceMetrics` de la 0006 y `entities:problemCounts` de la 0007)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio» (0006 a 0010). "Para tener un cuadro de mandos chulo, podríamos mostrar arriba de la
página a modo de marcadores el total de peticiones OK, KO, tiempos de respuesta y problemas abiertos
y cerrados para esa entidad", ligados al rango de tiempo de la app. La petición completa está en la
ficha 0006.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote:** tiempos con **mediana**, p90 y p99 (no la
media); OK = total − KO; marcador de tasa de error del rango (KO / total); la franja de problemas
sobre la tasa de error va en este lote (ficha 0010). Dani autoriza las lecturas de solo lectura del
tenant de pruebas que hagan falta para validar (`npm run test:live`).

En `ServiceEntityPage.tsx` se quita «Página en construcción» y, debajo de la cabecera
(`EntityPageFrame`), va una fila de **marcadores** (tarjetas con el estilo de las de Inicio):

| Marcador            | Valor                                                       |
| ------------------- | ----------------------------------------------------------- |
| Peticiones OK       | `totals.ok`, con separador de miles                         |
| Peticiones KO       | `totals.errors`, en color de error si es mayor que 0        |
| Tasa de error       | `totals.errorRate` en %, con un decimal                     |
| Tiempo de respuesta | mediana grande y, debajo, p90 y p99 (ms o s según el valor) |
| Problemas           | abiertos (en color de error si > 0) y cerrados              |

- El color nunca es la única señal: siempre hay texto (como en los SLO de Inicio).
- Cada marcador se carga por su lado: mientras carga, un esqueleto; si falla su canal, un aviso
  compacto con Reintentar en su sitio (`PanelBoundary`/`ModuleState`) y el resto sigue.
- Sin datos: «—», nunca 0 inventado (0 solo si Dynatrace dice 0).
- Ligado al **rango global** de la barra superior: al cambiarlo, se piden datos nuevos. Botón
  «Actualizar» en la cabecera de la página, como en el resto de vistas (ADR-0004); sin refresco
  solo.
- Debajo de los marcadores, una línea pequeña con el rango y la resolución que se ve («Últimas 2 h ·
  datos por minuto»).
- Formato de números y fechas con el idioma de la interfaz (es y en). Textos en es y en.
- Con el teclado: los marcadores no son interactivos; los tooltips de p90/p99 (si los hay) se abren
  con el foco.

**Tasa de error del marcador:** es KO / total del rango (de la 0006), no la media de los puntos de
la serie.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): al abrir la página de un SERVICE (desde «Analizar entidad» de una evidencia del
  simulador) salen los cinco marcadores con los valores del simulador, ya formateados, y no sale
  «Página en construcción».
- CA2 (unitario): el formato de los tiempos (de ms a «850 ms» o «1,2 s»; en inglés «1.2 s»), de los
  recuentos con separador de miles y de la tasa con un decimal, en es y en.
- CA3 (e2e): con KO > 0 y problemas abiertos > 0, esos marcadores llevan la clase de error y
  texto; con 0, no llevan la clase.
- CA4 (e2e): cambiar el rango global vuelve a pedir los dos canales con el rango nuevo; volver a la
  página sin cambiar nada no pide datos; «Actualizar» sí.
- CA5 (e2e): si el canal de métricas falla, los marcadores de métricas enseñan el aviso con
  Reintentar y el de problemas sigue con su dato (y al revés).
- CA6 (e2e): un servicio sin datos enseña «—» en los marcadores de métricas, no 0.
- CA7 (e2e): las páginas de los otros tipos de entidad siguen en construcción (no cambian).
- CA8 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con servicios reales, que los marcadores cuadran con lo que enseña Dynatrace para el mismo rango
  (peticiones, errores, tasa, mediana/p90/p99 y problemas).
- Que se lee bien en claro y en oscuro y con la ventana pequeña.

## Fuera de alcance

- Pulsar un marcador para ir a otra vista (por ejemplo, a Problemas filtrada).
- Comparación con el periodo anterior (variación de los KPI: sin definir, BACKLOG).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
