---
id: '0018'
titulo: 'HOST: marcadores y cuatro gráficos (CPU, memoria, red y disco) con la franja de problemas'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0016']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0018-host-marcadores-graficos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:hostMetrics` de la 0016, y `entities:problemCounts` y `entities:problems` de las fichas 0007 y 0010, que ya aceptan cualquier tipo estándar)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host» (0016 a 0020). "Poner las cajitas igual que tenemos en la vista de SERVICE" y graficar
CPU, memoria, red y disco. La petición completa está en la ficha 0016.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

En `HostEntityPage.tsx` se quita «Página en construcción». La página sigue el modelo del servicio
y **reutiliza sus piezas**: las tarjetas de marcadores, el panel de gráfico con «Abrir en Métricas» y
exportar, el eje de tiempo, la franja de problemas y el formato de números (con separador de miles
siempre, ficha 0012). Si hace falta, el developer saca de los componentes del servicio una pieza
común; el servicio no cambia de aspecto.

**Marcadores** (cinco, como en el servicio, centrados):

| Marcador  | Valor principal                    | Debajo                                |
| --------- | ---------------------------------- | ------------------------------------- |
| CPU       | media del rango (%)                | máxima                                |
| Memoria   | media del rango (%)                | usada / total (GB)                    |
| Red       | entrada media (Mbit/s o similar)   | salida media                          |
| Disco     | el más lleno (máximo del rango, %) | cuál es (nombre, si llega en la 0016) |
| Problemas | abiertos                           | cerrados                              |

- CPU, memoria y disco en color de aviso por encima del 80 % y de error por encima del 90 %, siempre
  con texto (los umbrales, fijos y anotados en código).

**Gráficos** (rejilla 2×2, una columna si es estrecha):

1. **CPU:** uso total (línea) y, debajo, `user`, `system` e `iowait` apilados en área (los que haya
   confirmado la 0016). Eje 0–100 %. **Con la franja de problemas del host encima** (la de la 0010).
2. **Memoria:** uso en % (línea). Eje 0–100 %.
3. **Red:** entrada y salida (dos líneas), con unidad de bits/s adaptada (kbit/s, Mbit/s, Gbit/s).
4. **Disco:** % del disco más lleno (línea). Eje 0–100 %.

Sin líneas de rejilla horizontales (como el servicio tras la 0012). Tooltip con fecha y hora y cada
serie con su unidad; `null` como hueco. Estados de carga y error por panel. Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): la página de un HOST del simulador enseña los cinco marcadores con los valores del
  simulador formateados y no enseña «Página en construcción».
- CA2 (e2e): salen los cuatro gráficos en su orden con sus series (`data-series`): CPU con total y
  desglose, memoria, red con entrada y salida, y disco.
- CA3 (e2e): la franja de problemas sale sobre el gráfico de CPU con los problemas del host del
  simulador, y al pulsar un tramo se abre el problema.
- CA4 (unitario): unidades de red (bits/s a kbit/s, Mbit/s y Gbit/s, en es y en) y de memoria
  (bytes a GB).
- CA5 (unitario): los umbrales de color (80 y 90 %) en CPU, memoria y disco, con texto además del
  color.
- CA6 (e2e): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la
  página sin cambios, no.
- CA7 (e2e): si falla el canal de métricas, marcadores y gráficos enseñan el aviso con Reintentar y
  el marcador de problemas sigue.
- CA8 (e2e): la página del servicio sigue igual (sus e2e pasan).
- CA9 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con hosts reales, que los marcadores y los gráficos cuadran con Dynatrace en el mismo rango y se
  leen bien en claro y en oscuro.

## Fuera de alcance

- Discos y procesos uno a uno (0019) y la información del host (0020).
- Umbrales configurables.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
