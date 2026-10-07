---
id: '0025'
titulo: 'Monitores: tablas de localizaciones y de pasos o peticiones'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0023', '0024', '0019']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0025-monitores-localizaciones-pasos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:monitorBreakdown` de la 0023)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «monitores» (0022 a 0026): "localizaciones, pasos…". La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

Debajo de los gráficos (0024), dos tarjetas (una columna si es estrecha), con las tablas de la app
(como discos y procesos del host, 0019):

- **Localizaciones:** nombre, barra de disponibilidad con su % (mismos colores que el marcador, con
  texto), duración media y ejecuciones fallidas. Ordenada de peor a mejor disponibilidad; orden por
  columna. Al pulsar una localización, los gráficos de arriba **no** cambian (fuera de alcance).
- **Pasos** (browser) o **Peticiones** (HTTP): en su orden, nombre, duración media y una barra con
  su peso en la duración total; el paso más lento resaltado (con texto). Orden por columna.
- Sin métrica de pasos (`steps: null`), la tarjeta no sale. Estados de carga y error por tarjeta.
  Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con 4 localizaciones del simulador, la tabla las enseña de peor a mejor, con su %,
  duración y fallidas.
- CA2 (e2e): con 5 pasos, la tabla de un browser monitor los enseña en orden, con su peso, y marca
  el más lento; en un HTTP monitor la tarjeta se llama «Peticiones».
- CA3 (e2e): con `steps: null`, no sale la tarjeta de pasos y la de localizaciones sí.
- CA4 (e2e): ordenar por otra columna reordena; error del canal → aviso con Reintentar y los
  gráficos siguen.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con monitores reales, que localizaciones y pasos cuadran con Dynatrace y se leen de un vistazo.

## Fuera de alcance

- Filtrar los gráficos por localización o por paso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
