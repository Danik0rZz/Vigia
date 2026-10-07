---
id: '0026'
titulo: 'Monitores: tarjeta «Información» con los datos de la entidad'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: monitores
depende_de: ['0015', '0022', '0024']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0026-monitores-informacion
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:get` y `entities:names` de la 0014; scope `entities.read`)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «monitores» (0022 a 0026). "Haz lo mismo" que con SERVICE: consultar la entidad y sacar la
información relevante. La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

La tarjeta «Información» de la 0015 (generalizada por tipo en la 0020), para SYNTHETIC_TEST y
HTTP_CHECK, con su principio: breve y bonita, el detalle plegado.

- **Filas:** las `properties` que la 0022 encontró en vivo (`GET /entities/{entityId}`, decisión de
  Dani) y que sirvan para situar el monitor: tipo, si está activo, frecuencia, número de
  localizaciones y de pasos o peticiones, aplicación monitorizada…, las que vengan,
  elegidas por el developer con ese informe y anotadas en "Resultado"; visto por primera y última
  vez; management zones y etiquetas como chips.
- **Relaciones**, solo las que vengan: «Monitoriza» (la aplicación o el servicio), «Localizaciones»,
  «Pasos» o «Peticiones» y «Otras relaciones» plegada; con «Ver nombres» a demanda y enlaces a la
  página de cada entidad, como en la 0015.
- «Todas las propiedades», plegada.
- Sin `entities.read`, el aviso del scope y el resto de la página sigue.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario): la función que elige filas y grupos de relaciones para los dos tipos, con una
  salida de `entities:get` inventada (con todas las claves y con pocas).
- CA2 (e2e): la página de un browser monitor y la de un HTTP monitor enseñan su tarjeta con sus
  filas y relaciones; «Ver nombres» a demanda y los enlaces funcionan.
- CA3 (e2e): sin `entities.read`, aviso del scope y los marcadores y gráficos siguen.
- CA4 (e2e): las tarjetas de servicio y host siguen igual (sus e2e pasan).
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con monitores reales, que la tarjeta se lee de un vistazo y no sobra ni falta nada importante.

## Fuera de alcance

- La API v1 de sintéticos y el script del monitor (ver la 0022).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
