---
id: '0019'
titulo: 'HOST: tablas de discos y de los procesos que más consumen'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0017', '0018']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0019-host-discos-procesos-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:hostBreakdown` de la 0017)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host» (0016 a 0020). El host tiene "disco, red, memoria, CPU, procesos…". La petición
completa está en la ficha 0016.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

Debajo de los gráficos (0018), dos tarjetas lado a lado (una columna si es estrecha), con el grid
de tablas de la app (`DataGrid`):

- **Discos:** una fila por disco: nombre, barra de uso con su % (aviso > 80 %, error > 90 %, con
  texto), usado / total, libre, lectura y escritura (bytes/s adaptados). Ordenada del más lleno al
  menos; orden por columna.
- **Procesos (top 10 por CPU):** nombre, CPU media (con una barra pequeña) y máxima, memoria media.
  Ordenada por CPU; orden por columna. Debajo, «10 de N procesos». Cada proceso enlaza a su página
  de entidad (`#/entities/PROCESS_GROUP_INSTANCE/<id>`, con el nombre); «Volver» regresa al host.
- Estados de carga y error por tarjeta (aviso con Reintentar); sin datos, «Sin discos» o «Sin
  procesos». Mismo rango global y «Actualizar» que el resto. Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con 3 discos del simulador, la tabla los enseña ordenados del más lleno, con su %,
  usado/total, libre, lectura y escritura formateados.
- CA2 (e2e): con 15 procesos en el simulador, la tabla enseña 10, ordenados por CPU, y «10 de 15
  procesos».
- CA3 (e2e): pulsar un proceso abre su página de entidad con su nombre, y «Volver» regresa al host
  sin volver a pedir sus datos.
- CA4 (e2e): ordenar por otra columna (memoria, libre) reordena las filas.
- CA5 (unitario): color y texto de la barra de uso según el % (umbrales 80 y 90).
- CA6 (e2e): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos
  siguen; sin datos, los textos de vacío.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con hosts reales, que los discos y los procesos cuadran con Dynatrace y que la tabla se lee de un
  vistazo.

## Fuera de alcance

- Más de 10 procesos, filtros o búsqueda en las tablas.
- Gráfico por disco o por proceso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
