---
id: '0036'
titulo: 'Páginas de entidad: la tarjeta «Información» va al final'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: mejoras-entidades
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0036-entidades-informacion-al-final
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «mejoras-entidades» (0036 y 0037). Dani (2026-10-09): "Estamos mostrando arriba de todo el
apartado de «Información», y en determinadas entidades, como la página de HOST, ese apartado tiene
una altura enorme por la cantidad de datos. Propongo ponerlo abajo del todo, para que al entrar en
cada página de entidad tengamos los datos de las cajas, las métricas relevantes de cada entidad y
los otros cuadros de información que tenga, y ahí, lo último, el apartado de información. También
aplica para las páginas que estamos montando por cada entidad."

## Especificación

En todas las páginas de entidad con tarjeta «Información» (servicio, host, browser monitor, HTTP
monitor y proceso; y las que vengan, como process group y aplicación) el orden pasa a ser:

1. Cabecera (y, tras la 0037, las etiquetas).
2. Marcadores.
3. Gráficos.
4. Las demás tarjetas de la página (discos y procesos del host, localizaciones y pasos de los
   monitores…).
5. **«Información», la última.**

Si el orden vive repetido en cada página, se saca a una pieza común (por ejemplo, que
`EntityPageFrame` reciba las secciones y las ponga en este orden), para que las páginas nuevas lo
cumplan solas. La tarjeta no cambia por dentro.

## Criterios de aceptación

- CA1 (e2e): en las páginas de servicio, host, browser monitor, HTTP monitor y proceso del
  simulador, la tarjeta «Información» es la última sección de la página (después de los gráficos y
  de las demás tarjetas).
- CA2 (e2e): los marcadores son la primera sección después de la cabecera en esas cinco páginas.
- CA3 (e2e): los e2e de esas páginas siguen pasando.

## Pruebas a mano para Dani

- Que al entrar en un host real se ven primero los marcadores y los gráficos, y la información
  queda al final.

## Fuera de alcance

- Cambiar el contenido de la tarjeta (las etiquetas salen de ella en la 0037).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
