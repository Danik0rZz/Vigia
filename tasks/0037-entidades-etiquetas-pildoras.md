---
id: '0037'
titulo: 'Páginas de entidad: etiquetas arriba del todo, como píldoras clave:valor'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: mejoras-entidades
depende_de: ['0036']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0037-entidades-etiquetas-pildoras
adrs: [2]
adr_nuevo:
api: v2, `tags` de `GET /entities/{entityId}` (esquema `EnrichedTagDto`: `context`, `key`, `value` opcional y `stringRepresentation`; `..\API\Dynatrace Environment APIv2\APIv2.json`). Sin endpoints nuevos.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «mejoras-entidades» (0036 y 0037). Dani (2026-10-09): "Los tags me gustaría verlos arriba del
todo, incluso antes de las cajas informativas. Quiero verlas de manera bonita, como píldoras. Hay
que tener en cuenta que las tags son una composición de KEY:VALUE, pero hay casos en los que no
existe VALUE y solo viene KEY."

## Especificación

**Datos.** `entities:get` (0014) manda hoy las etiquetas como texto. Pasa a mandarlas separadas:
`tags: { context, key, value | null }[]` (de `context`, `key` y `value` de la API; `value` falta
en las de solo clave). Las vistas que hoy usan el texto se adaptan.

**Vista.** En todas las páginas de entidad, justo debajo de la cabecera y **antes de los
marcadores**, una fila de píldoras:

- `clave: valor` con la clave en un tono y el valor en otro (o la clave sola si no hay valor), con
  el estilo del tema (claro y oscuro, contraste del test de `check`).
- El contexto, si no es `CONTEXTLESS`, como prefijo pequeño y apagado (`[AWS]`, `[Kubernetes]`…).
- Orden alfabético por clave. Si no caben en dos líneas, «+N» despliega el resto.
- Tooltip con el texto completo (`stringRepresentation`) si se recorta.
- Las etiquetas dejan de salir dentro de la tarjeta «Información» (para no repetirlas).
- Sin etiquetas, la fila no sale. Sin el scope `entities.read`, tampoco (el aviso del scope ya sale
  en la tarjeta).

## Criterios de aceptación

- CA1 (unitario, main): `entities:get` transforma etiquetas de la API (con y sin `value`, con y sin
  contexto) en `{ context, key, value }`.
- CA2 (e2e): en una página de entidad del simulador, las píldoras salen entre la cabecera y los
  marcadores, en orden alfabético; una de solo clave enseña solo la clave y una con contexto lleva
  su prefijo.
- CA3 (e2e): con muchas etiquetas, «+N» despliega el resto.
- CA4 (e2e): la tarjeta «Información» ya no enseña etiquetas.
- CA5 (e2e): sin etiquetas, no hay fila; los e2e de las páginas de entidad siguen pasando.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con entidades reales, que las píldoras se leen bien y se ven bonitas en claro y en oscuro.

## Fuera de alcance

- Filtrar por etiqueta o pulsar una etiqueta para buscar otras entidades.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
