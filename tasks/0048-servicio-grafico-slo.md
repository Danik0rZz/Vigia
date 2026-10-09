---
id: '0048'
titulo: 'SERVICE: gráfico de disponibilidad (SLO calculado) con umbral crítico del 90 %'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-tipos
depende_de: ['0047']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0048-servicio-grafico-slo
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa las series de peticiones y errores que ya trae `entities:serviceMetrics`)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio-tipos» (0046 a 0048). Dani (2026-10-10): "Otra de las cosas que podemos pintar en la
página de servicios es un SLO que hice en la otra prueba de aplicación, que quedó bastante chulo":
una disponibilidad en % calculada a partir de las peticiones y los errores,

SLO = (Peticiones − Errores) / Peticiones × 100,

con un umbral crítico del 90 %.

## Especificación

- **Cálculo** (función pura, en la interfaz): para cada punto,
  `(peticiones − errores) / peticiones × 100`; `null` si no hay peticiones o falta alguno de los
  dos (hueco, no 0). Con las series que ya trae `entities:serviceMetrics`, del conjunto de métricas
  que elija la 0046. El valor del rango completo sale de los totales igual.
- **Nombre:** «Disponibilidad (SLO calculado)», con un tooltip que da la fórmula y aclara que lo
  calcula Vigía (no es un SLO configurado en Dynatrace, que son los de Inicio).
- **Gráfico**, una fila a todo el ancho **encima de la rejilla de 2×2** (es el dato que se lee
  primero): línea de la disponibilidad (eje 0–100 %, con el mínimo del eje ajustado para que se vea
  la variación, nunca por encima de 90), una **línea horizontal discontinua en el 90 %** con su
  etiqueta («Crítico 90 %») y los tramos por debajo del 90 % sombreados en el color de error del
  tema. Sin líneas de rejilla, tooltip con fecha y hora, exportar, como el resto. Sin «Abrir en
  Métricas» (es un cálculo de Vigía; se puede exportar).
- **Marcador:** en el marcador «Tasa de error», debajo, «Disponibilidad 99,5 %» (el valor del rango),
  en color de error si baja del 90 %, con texto.
- **Solo actividad** (`QUEUE_LISTENER_SERVICE`, 0047): no hay errores, así que no sale ni el gráfico
  ni la línea del marcador.
- Textos en es y en.

## Criterios de aceptación

- CA1 (unitario): el cálculo punto a punto, con peticiones 0 o `null` (sale `null`) y errores mayores
  que peticiones (nunca menos de 0).
- CA2 (unitario): la opción de ECharts lleva la línea del 90 % (`markLine`) y el sombreado de los
  tramos por debajo (`markArea` o `visualMap`); el mínimo del eje no pasa de 90.
- CA3 (e2e): en un servicio del simulador con una caída por debajo del 90 %, el gráfico sale encima
  de la rejilla con su serie (`data-series`) y la línea del umbral, y el marcador enseña la
  disponibilidad del rango en color de error.
- CA4 (e2e): en un servicio de solo actividad no sale el gráfico ni la línea del marcador.
- CA5 (e2e): el tooltip del nombre explica la fórmula (con ratón y con foco).
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un servicio real que haya tenido errores, que la disponibilidad y el umbral se ven como en su
  prueba anterior.

## Fuera de alcance

- Umbral configurable o de aviso (solo el crítico del 90 %).
- Crear o leer SLOs de Dynatrace desde esta página.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
