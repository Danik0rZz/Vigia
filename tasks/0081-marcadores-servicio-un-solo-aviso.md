---
id: '0081'
titulo: 'Marcadores del servicio: un solo aviso (role="alert") cuando fallan las métricas (con medición del flujo)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: sí # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: medicion-control # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0070', '0071', '0080'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0081-marcadores-servicio-un-aviso
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, «Medición de control»: dos cambios equivalentes a la 0065 y la 0066, con `medir: sí`.
Dani, 2026-10-11: «esto hay que hacerlo cuanto antes para validar que ya vamos a todo motor».

Esta es la equivalente a la 0066 (un cambio pequeño en un componente, carril normal). El cambio
sale del BACKLOG, «Mejoras anotadas»: «Marcadores del servicio: si fallan las métricas salen cuatro
`role="alert"` a la vez; dejar uno solo» (surgió en 0008). Desde la 0066 son cinco: SLO, Peticiones
OK, Peticiones KO, Tasa de error y Tiempo de respuesta.

## Especificación

Hoy, en la página del servicio, cuando falla el canal de métricas, cada una de las cinco tarjetas de
métricas pinta su `MarkerError` (`src/renderer/src/pages/entities/EntityMarkers.tsx`), y cada uno
lleva `role="alert"`: un lector de pantalla anuncia el mismo error cinco veces.

**Decidido por Dani (2026-10-11, opción 1):** lo que se ve no cambia; cambia solo lo que se
anuncia. (La opción 2, un único aviso grande con un solo «Reintentar», se descartó.)

- Cada tarjeta de métricas sigue enseñando su aviso y su «Reintentar», como hoy (el diseño de la
  0012 y la 0066 se queda igual).
- Solo el aviso de la **primera** tarjeta de métricas que se pinta lleva `role="alert"`: «SLO» con
  todas las métricas, «Peticiones» con «Solo actividad» (ficha 0047). Los demás avisos de métricas,
  sin `role`.
- El marcador de «Problemas» va por su propio canal y no cambia: si falla, sigue con su
  `role="alert"`. Si fallan los dos canales, hay dos avisos anunciados, uno por canal.
- Cómo se consigue (decisión de diseño del developer, propuesta): una propiedad opcional en
  `MarkerError` y `QueryState` que quite el `role` (por defecto, con `role`, para que los marcadores
  del resto de las páginas no cambien).
- Los e2e del servicio que esperan un `role="alert"` en cada tarjeta de métricas (si los hay
  después de la 0070) se adaptan; los que buscan «Reintentar» en cada tarjeta, no cambian.

**Medición:** se mide el flujo entero según `docs/flujo.md`, «Medición del flujo», con la sección
«Medición del flujo» de esta ficha (las 0065 y 0066 son el modelo).

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**; añade una propiedad nueva
   a `MarkerError` y a `QueryState`, que comparten todas las páginas de entidad.
2. No elimina nada visible para el usuario: se cumple; solo quita anuncios repetidos del lector de
   pantalla.
3. No toca datos, API ni lógica: se cumple en datos y API; toca la lógica de presentación del
   componente.
4. No hay ninguna decisión que preguntar a Dani: **no se cumplía** al redactarla; Dani eligió la
   opción 1 el 2026-10-11.

## Criterios de aceptación

- CA1: un test (unitario de componente o e2e, etiqueta `@servicio`) con «CA1 (0081)» en el nombre:
  con el canal de métricas fallando, los marcadores del servicio (`service-markers`) tienen
  exactamente un elemento con `role="alert"`, en la tarjeta «SLO»; las cinco tarjetas de métricas
  siguen enseñando su aviso y su «Reintentar».
- CA2: igual que CA1 con el conjunto «Solo actividad»: un solo `role="alert"`, en la tarjeta
  «Peticiones».
- CA3: con los dos canales fallando (métricas y problemas), hay dos `role="alert"` en
  `service-markers`: el de la primera tarjeta de métricas y el de «Problemas».
- CA4: un test unitario de `MarkerError` (o `QueryState`): sin la propiedad nueva, el aviso lleva
  `role="alert"`, como hoy; con ella, no lo lleva y el texto y «Reintentar» siguen.

## Pruebas a mano para Dani

- Ninguna (lo que se ve no cambia).

## Fuera de alcance

- Los marcadores de las otras páginas (host, proceso, grupo de procesos, monitores, aplicación y
  disco), que tienen el mismo patrón: si el resultado convence, otra ficha.
- Los avisos de los cuatro gráficos del servicio, que también llevan su `role="alert"` cada uno.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)

## Medición del flujo

Horas en local (Europa/Madrid, +02:00). Duración en minutos y segundos.

### Pasos

| Paso                                                                                  | Agente       | Ronda | Inicio              | Fin                 | Duración   | Notas                                                                                                               |
| ------------------------------------------------------------------------------------- | ------------ | ----- | ------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Redacción del lote de seis fichas (0080 a 0085)                                       | Planificador | —     | 2026-10-11 12:29:14 | 2026-10-11 12:37:41 | 8 min 27 s | La misma fila que en la 0080: es una sola redacción                                                                 |
| Espera de la aprobación de Dani                                                       | Dani         | —     | 2026-10-11 12:37:41 | 2026-10-11 12:45:43 | 8 min 2 s  | Desde la presentación del lote (con dos preguntas, de la 0081 y la 0085) hasta su respuesta; incluye leerla         |
| Aprobación del lote, decisiones en las fichas, BACKLOG, commit y envío al Orquestador | Planificador | —     | 2026-10-11 12:45:43 | 2026-10-11 12:46:26 | 0 min 43 s | Las seis fichas del lote, hasta antes de prettier y del commit; el commit y el SendMessage tardan unos segundos más |

### Ejecuciones

| Quién | Comando | Inicio | Fin | Duración | Resultado | Tests (pasan / fallan / saltados) |
| ----- | ------- | ------ | --- | -------- | --------- | --------------------------------- |
