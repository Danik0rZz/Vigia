---
id: '0047'
titulo: 'SERVICE: la página se adapta al conjunto de métricas del serviceType'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-tipos
depende_de: ['0046']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0047-servicio-vista-por-tipo
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `serviceType`, `metricSet` y `metricKeys` que añade la 0046 a `entities:serviceMetrics`)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio-tipos» (0046 a 0048). Dani (2026-10-10): según el `serviceType` del servicio aplican
unas métricas u otras. La petición completa está en la ficha 0046.

## Especificación

En la página del servicio (`ServiceMarkers.tsx`, `ServiceCharts.tsx` y `service-charts.ts`):

- **Solo actividad** (`QUEUE_LISTENER_SERVICE`): no salen los marcadores ni los gráficos de tiempos,
  errores y tasa; quedan Peticiones, Problemas y el gráfico de actividad (sin la parte KO). Una nota
  pequeña lo explica («Este tipo de servicio solo mide actividad»).
- **Cliente** y **Unificadas**: los mismos marcadores y gráficos; una nota pequeña bajo los
  marcadores dice de dónde salen («Medido desde los clientes» / «Métricas unificadas»), con un
  tooltip que lo explica en es y en.
- **Tipo de servicio** visible: el `serviceType` en la cabecera, junto al tipo de entidad (por
  ejemplo «Servicio · Base de datos»), con un nombre legible en es y en para los tipos de la tabla
  de la 0046 y el código tal cual para los demás.
- **«Abrir en Métricas»** de cada gráfico usa las claves de `metricKeys` (no las `.server` fijas
  de hoy).
- Si llega el aviso de la 0046 (sin `entities.read`), una nota discreta dice que se usan las
  métricas de servidor por defecto.

## Criterios de aceptación

- CA1 (e2e): un servicio `QUEUE_LISTENER_SERVICE` del simulador enseña solo Peticiones y Problemas,
  el gráfico de actividad y la nota; no enseña tiempos, errores ni tasa.
- CA2 (e2e): un servicio `DATABASE_SERVICE` enseña los marcadores y gráficos completos, la nota de
  cliente y «Base de datos» en la cabecera.
- CA3 (e2e): «Abrir en Métricas» del gráfico de tiempos de un servicio de cliente abre Métricas con
  `builtin:service.response.client`; el de uno unificado, con su métrica unificada.
- CA4 (e2e): un servicio `WEB_SERVICE` se ve como hoy (los e2e del servicio siguen pasando).
- CA5 (unitario): nombres legibles de los tipos de la tabla en es y en; un tipo desconocido sale
  tal cual.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con servicios reales de varios tipos (web, base de datos, cola…), que los números cuadran con
  Dynatrace.

## Fuera de alcance

- Cambiar los papeles de la página o sus umbrales.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
