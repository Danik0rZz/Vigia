---
id: '0024'
titulo: 'Monitores: marcadores y cuatro gráficos en las páginas de browser monitor y HTTP monitor'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0022', '0018']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0024-monitores-marcadores-graficos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:monitorMetrics` de la 0022 y los canales de problemas de las fichas 0007 y 0010)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «monitores» (0022 a 0026). "Haz lo mismo" que con SERVICE y HOST, con las métricas clave de
cada entidad. La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

En `BrowserMonitorEntityPage.tsx` y `HttpMonitorEntityPage.tsx` se quita «Página en construcción».
Las dos usan los mismos componentes (los comunes que sacó el lote «host», 0018), con los textos de
su tipo. Lo que no tenga métrica según la 0022 no se pinta.

**Marcadores** (cinco, centrados, con separador de miles):

| Marcador       | Valor principal             | Debajo                                                             |
| -------------- | --------------------------- | ------------------------------------------------------------------ |
| Disponibilidad | % del rango, con un decimal | color: error < 95 %, aviso < 99 %, con texto                       |
| Duración       | media (ms o s)              | mediana                                                            |
| Ejecuciones    | correctas                   | fallidas (en color de error si > 0)                                |
| Localizaciones | cuántas                     | cuántas por debajo del 100 % (de la 0023, cuando esté; antes, «—») |
| Problemas      | abiertos                    | cerrados                                                           |

**Gráficos** (rejilla 2×2, una columna si es estrecha, sin líneas de rejilla):

1. **Disponibilidad** (%), línea, con la **franja de problemas** encima (la de la 0010).
2. **Duración** (ms o s), línea.
3. **Ejecuciones:** correctas (verde) y fallidas (rojo) apiladas en barras.
4. **Rendimiento:** en browser, las métricas de experiencia que eligió la 0022 (LCP, visually
   complete…); en HTTP, los tiempos de DNS/TCP/TLS o los códigos de respuesta si los hay. Si no hay
   ninguna, la rejilla queda en tres.

Tooltip, «Abrir en Métricas», exportar, estados de carga y error por panel, rango global y
«Actualizar», como en el servicio. Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): la página de un browser monitor del simulador enseña los cinco marcadores con sus
  valores y los cuatro gráficos con sus series; no enseña «Página en construcción».
- CA2 (e2e): lo mismo para un HTTP monitor, con su cuarto gráfico de HTTP.
- CA3 (e2e): con un papel sin métrica (`null` en el simulador), su marcador o gráfico no sale y el
  resto sí.
- CA4 (unitario): colores de disponibilidad (95 y 99 %) con texto además del color.
- CA5 (e2e): la franja de problemas sale sobre la disponibilidad y abre el problema al pulsarla.
- CA6 (e2e): rango global, «Actualizar» y errores por panel como en el servicio.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con monitores reales de los dos tipos, que marcadores y gráficos cuadran con Dynatrace en el mismo
  rango.

## Fuera de alcance

- Localizaciones y pasos uno a uno (0025) y la información (0026).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
