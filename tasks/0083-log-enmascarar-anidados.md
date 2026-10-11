---
id: '0083'
titulo: 'Log: el filtro final de secretos enmascara también los objetos anidados y la cause de los errores'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: ideas-backlog # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0083-log-enmascarar-anidados
adrs: [5] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

BACKLOG, «Mejoras anotadas» (surgió en 0060): «[ALCANCE] (lo decide Dani) Que `maskLogMessage`
enmascare también los objetos anidados y la `cause` de un `Error` (el fichero de log escribe con
`depth: 5`); hoy solo cubre el primer nivel y cambiaría CA3 de la 0060». Dani dijo que sí el
2026-10-11.

Se añade la otra mejora anotada del mismo filtro (surgió en 0060): «Test unitario del fallo del
filtro del log: si `maskLogMessage` falla, el mensaje se descarta y no se escribe sin filtrar».

## Especificación

`src/main/log-mask.ts`, `maskLogMessage` (el hook final de electron-log, ficha 0060). Hoy enmascara
los textos sueltos, los `Error` (mensaje y pila) y los textos del **primer nivel** de un objeto
plano. Pasa a enmascarar con `maskSecrets`, en todo lo que electron-log puede escribir:

- los textos dentro de objetos planos y de listas (arrays), a cualquier profundidad;
- en un `Error`: el mensaje, la pila, la `cause` (texto, objeto u otro `Error`, también encadenada)
  y sus propiedades propias (por ejemplo, `errors` de un `AggregateError` o un `body` añadido);
- sin colgarse con referencias circulares (un objeto que se contiene a sí mismo) y sin cambiar el
  original (se enmascara una copia, como hoy);
- lo que no es texto (números, booleanos, `null`, fechas…) queda igual.

Profundidad: como mínimo la que escribe el transporte de fichero de electron-log (5 por defecto);
si se pone un límite, lo que quede por debajo se sustituye por un marcador que no lleva el valor, no
se deja sin enmascarar.

El CA3 de la 0060 se amplía (se añaden casos, no se quita ninguno): se anota en esa ficha que la
0083 lo amplía. Al cerrar, se quitan las dos líneas del BACKLOG.

## Carril

Normal (`ligera: no`) y con la exclusión `seguridad`: es el filtro de secretos del log. Va sola en
su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**; el recorrido recursivo es
   lógica nueva.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**; cambia la lógica del filtro.
4. No hay ninguna decisión que preguntar a Dani: se cumple (Dani dijo que sí).

## Criterios de aceptación

Todos unitarios, en `src/main/log-mask.test.ts`, con «(0083)» en el nombre.

- CA1: un `Api-Token …` en un objeto a tres niveles de profundidad y dentro de una lista sale
  enmascarado.
- CA2: un `Api-Token …` en la `cause` de un `Error` (como texto y como otro `Error` con su mensaje y
  su pila), y en una `cause` encadenada a dos niveles, sale enmascarado; se conservan la clase, el
  `name` y la cadena de `cause`.
- CA3: un objeto con una referencia circular termina sin error y con sus textos enmascarados.
- CA4: el valor original que se pasa al log no cambia (el filtro trabaja sobre una copia).
- CA5: los casos del CA3 de la 0060 siguen igual (parte pública de un `dt0c01.<pública>.<secreta>`,
  valores que no son texto, `name` y `cause`).
- CA6: si el filtro falla, el mensaje se descarta y no se escribe sin filtrar (con electron-log
  simulado, como el CA4 de la 0060). Es lo que anota el BACKLOG que pasa hoy; si el developer ve
  que no es así, lo arregla para que se descarte y lo dice en la ficha.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Formatos de secreto nuevos en `maskSecrets` (sigue viendo solo los que conoce).
- Cambiar qué se registra en el log o su nivel.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
