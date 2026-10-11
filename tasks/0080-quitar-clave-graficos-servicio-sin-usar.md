---
id: '0080'
titulo: 'Quitar la clave sin usar entities.service.charts.loadError (con medición del flujo)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: sí # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: medicion-control # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0070', '0071'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: chore/0080-quitar-clave-graficos-servicio
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, «Medición de control»: «tras la A, dos cambios equivalentes a la 0065 y la 0066, con
`medir: sí`. Objetivo: que un cambio como la 0065 baje de 67 min a 10-15». Dani, 2026-10-11: «esto
hay que hacerlo cuanto antes para validar que ya vamos a todo motor».

Esta es la equivalente a la 0065 (solo textos, carril rápido). El cambio sale del BACKLOG, «Mejoras
anotadas»: «Clave `entities.service.charts.loadError` sin usar en es y en: usarla o quitarla»
(surgió en 0009).

## Especificación

- Quitar la clave `entities.service.charts.loadError` de `src/renderer/src/locales/es/common.json`
  y de `en/common.json`.
- Comprobado por el Planificador el 2026-10-11: ningún fichero de `src/` la usa, ni con su nombre
  ni con una clave construida (`ServiceCharts.tsx` construye `entities.service.charts.${kind}` con
  los tipos de gráfico, que no incluyen `loadError`; el aviso de error de los gráficos usa otros
  textos). Si el developer encuentra un uso, se para y se avisa al Planificador.
- No se toca `entities.service.markers.loadError`, que sí se usa (`EntityMarkers.tsx`).
- Al cerrar, se quita la línea del BACKLOG («Mejoras anotadas»).

**Medición:** se mide el flujo entero según `docs/flujo.md`, «Medición del flujo», con la sección
«Medición del flujo» de esta ficha (las 0065 y 0066 son el modelo). Las horas del Planificador ya
están abajo.

## Carril

Rápido (`ligera: sí`): S, sin exclusiones, y cumple los cuatro puntos.

1. No añade componentes, funciones ni cálculos nuevos: se cumple; solo se quita un texto de dos
   ficheros de traducción.
2. No elimina nada visible para el usuario: se cumple; la clave no se pinta en ningún sitio.
3. No toca datos, API ni lógica: se cumple; ni código ni datos, solo los JSON de textos.
4. No hay ninguna decisión que preguntar a Dani: se cumple; Dani eligió el cambio el 2026-10-11 y
   el BACKLOG ya dice «usarla o quitarla» (se quita porque no hay ningún error que la necesite).

## Criterios de aceptación

- CA1: un test unitario con «CA1 (0080)» en el nombre comprueba que `entities.service.charts` no
  tiene la clave `loadError` ni en es ni en en, y que las demás claves de
  `entities.service.charts` siguen iguales en los dos idiomas (la paridad de `check` sigue en
  verde).

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Buscar otras claves sin usar en el resto de los textos.

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

| Paso                                                                                  | Agente       | Ronda | Inicio              | Fin                 | Duración   | Notas                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------ | ----- | ------------------- | ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Redacción del lote de seis fichas (0080 a 0085)                                       | Planificador | —     | 2026-10-11 12:29:14 | 2026-10-11 12:37:41 | 8 min 27 s | Primer `date` tomado; la llegada del mensaje de Dani no se puede medir. Es la redacción de seis fichas, no solo de esta |
| Espera de la aprobación de Dani                                                       | Dani         | —     | 2026-10-11 12:37:41 | 2026-10-11 12:45:43 | 8 min 2 s  | Desde la presentación del lote (con dos preguntas, de la 0081 y la 0085) hasta su respuesta; incluye leerla             |
| Aprobación del lote, decisiones en las fichas, BACKLOG, commit y envío al Orquestador | Planificador | —     | 2026-10-11 12:45:43 | 2026-10-11 12:46:26 | 0 min 43 s | Las seis fichas del lote, hasta antes de prettier y del commit; el commit y el SendMessage tardan unos segundos más     |

### Ejecuciones

| Quién | Comando | Inicio | Fin | Duración | Resultado | Tests (pasan / fallan / saltados) |
| ----- | ------- | ------ | --- | -------- | --------- | --------------------------------- |
