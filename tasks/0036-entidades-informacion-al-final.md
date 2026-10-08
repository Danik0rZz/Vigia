---
id: '0036'
titulo: 'Páginas de entidad: la tarjeta «Información» va al final'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

### Ronda 1: APROBADO

Ficha ligera: los tests del developer cubren CA1 y CA2 tal como están escritos, en las cinco páginas
(servicio, host, browser monitor, HTTP monitor y proceso), y fallarían con el orden anterior. CA3
queda para el verifier. Sin tocar tests tras `7fb2780`. Los e2e de 0015, 0020, 0026 y 0029 solo
cambian «encima» por «debajo de los marcadores». `EntitySections` fija el orden; solo renderer, sin
IPC, API, dependencias ni textos nuevos. Los avisos de módulo sin acceso siguen antes de los
marcadores: no son secciones (decisión del developer, aceptada).

Opcional: un e2e sin acceso a Métricas confirmaría el orden con avisos y sin gráficos.

## Verificación

Tests (ficha ligera, escritos por el developer): commit 7fb2780, en `e2e/views.spec.ts`.

- CA1 → `CA1 (0036): … la tarjeta «Información» es la última sección …`: en las cinco páginas,
  nada visible detrás de la tarjeta (subiendo hasta la raíz de la página, sea cual sea el
  envoltorio) y, en pantalla, gráficos y demás tarjetas encima de ella, y las tarjetas debajo de los
  gráficos.
- CA2 → `CA2 (0036): … los marcadores son la primera sección después de la cabecera`: antes de los
  marcadores solo la cabecera, y en pantalla todo lo demás debajo de ellos.
- CA3 → los e2e existentes de esas páginas (0008–0010, 0015, 0018–0020, 0024–0026, 0028–0029). Las
  comprobaciones «la tarjeta va encima de los marcadores» de CA1 (0015), CA2 (0020), CA2 (0026) y
  CA3 (0029) contradecían esta ficha y pasan, en el mismo commit de tests, a «debajo de los
  marcadores» (developer).

Decisión (developer): la pieza común es `EntitySections` en `EntityPageFrame.tsx` (avisos de
módulos sin acceso, marcadores, gráficos, tarjetas, información). Los avisos de módulo sin acceso
siguen antes de los marcadores: son avisos de la página, no secciones.

## Resultado

(pendiente)
