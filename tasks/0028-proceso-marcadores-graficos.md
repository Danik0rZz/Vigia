---
id: '0028'
titulo: 'PROCESS_GROUP_INSTANCE: marcadores y gráficos de la página del proceso'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

## Fuera de alcance

- La información del proceso (0029) y las métricas de tecnología.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
