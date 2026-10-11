---
id: '0083'
titulo: 'Log: el filtro final de secretos enmascara también los objetos anidados y la cause de los errores'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 2
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

### Ronda 1: CAMBIOS

1. [Seguridad] `src/main/log-mask.ts:54-55` («Fechas y demás instancias… quedan igual»): electron-log 5.4.4 sí escribe el contenido de esas instancias. Su transporte de fichero (`electron-log/src/node/transforms/object.js`) pasa cada dato por `JSON.stringify` con un serializador que convierte un `Map` con `Object.fromEntries` y un `Set` con `Array.from`, escribe las propiedades propias enumerables de cualquier instancia de clase y, con `toJSON`, lo que devuelve; si `JSON.stringify` falla, usa `util.formatWithOptions` con `depth: 5`. Así, un `Map` de cabeceras con `authorization` o una instancia con `token` llegan al fichero sin enmascarar. La especificación pide enmascarar «en todo lo que electron-log puede escribir»; su «queda igual» es para lo que no es texto. Acción: `Map` y `Set`, recorrer claves y valores y copiar si algo cambia; el resto de instancias que no sean `Date`, enmascarar lo que serializaría electron-log (`toJSON()` o sus entradas propias enumerables) y copiar solo si algo cambia; test en «Especificación (0083)» con un `Map`, un `Set` y una instancia de clase con un token falso.

Bien: CA1–CA6 con su test «(0083)», sin tocar desde 7caeef3; el CA6 recorre de verdad el `catch`. `message` y `stack` se leen siempre y se redefinen enmascarados; `cause`, `errors` y `body` por `getOwnPropertyNames`; las claves símbolo quedan fuera de la copia. Ciclos y profundidad bien (copia registrada antes de bajar; marcador sin nada del original). Reutilizar el original cuando nada cambia es seguro con la salida JSON. `false` descarta de verdad (`Logger.js:177-183`). Sin IPC, API, dependencias, esquema ni datos del tenant.

Opcional: precisar en la ficha que electron-log ya envolvía los hooks en un `try/catch` (el arreglo deja de depender de eso, pero no había fuga); citar la 0083 en el comentario de `src/main/logging.ts:20`; tratar las claves símbolo como cambio para el camino de reserva de `util.format`.

### Ronda 2: APROBADO

- Nota 1 de la ronda 1 resuelta en `src/main/log-mask.ts`: `Map` (claves y valores) y `Set` se copian en su tipo, así que el serializador de electron-log y `util.inspect` escriben la copia enmascarada; lo que devuelve `toJSON` se enmascara; si `toJSON` lanza, se descarta (`false`), y si devuelve el mismo objeto, `[referencia circular]` sin contenido; instancias de clase como copia plana; `Date` igual; claves símbolo como cambio. Opcionales hechos (comentario de `logging.ts:20` y nota sobre el `try/catch` de electron-log).
- Comprobados los dos caminos de `electron-log/src/node/transforms/object.js` (5.4.4): con los datos de `data`, ningún camino normal deja salir un secreto. Si al enmascarar dos claves de un Map quedan iguales, se fusionan (se pierde una entrada, no sale ningún secreto).
- Tests: el commit de la ronda 2 (`aa413c9`) solo añade casos; el bloque «Especificación (0083): Map, Set, instancias de clase y toJSON» mira la salida por JSON y por `inspect` y fallaría sin el código. Tokens inventados; sin IPC, API, dependencias ni esquema.
- Opcional: en el camino de reserva de `util.inspect` (solo si `JSON.stringify` falla, en la práctica con un `BigInt`), un original que se reutiliza podría imprimir propiedades que el JSON no escribe; anotarlo como idea. Falta un test del `toJSON` que devuelve el mismo objeto. La ficha cita los hashes de antes del rebase (ahora `a45aac8`, `aa413c9` y `1663f40`).

## Verificación

Tests escritos en `a45aac8` (`test(log): criterios de la ficha 0083`), todos en
`src/main/log-mask.test.ts`: 12 fallan porque falta el código; los 7 de la 0060 siguen en verde.

- CA1: «CA1 (0083)» (tres niveles, listas, profundidad 5 sin marcador y 60 niveles sin el secreto).
- CA2: «CA2 (0083)» (cause texto, objeto, Error con pila y encadenada a dos niveles, con clase y
  `name`). Las propiedades propias (`errors` de `AggregateError`, `body`) de la especificación, en
  «Especificación (0083)».
- CA3: «CA3 (0083)» (objeto y lista que se contienen, y un Error que es su propia `cause`).
- CA4: «CA4 (0083)».
- CA5: «CA5 (0083)» (casos anidados) y el «CA3 (0060)» sin tocar. Ojo: el test de la 0060 «conserva
  name y cause» pide `copy.cause` idéntica (`toBe`) a la original; con una `cause` sin secretos, la
  copia tiene que devolver el mismo objeto o ese test cae.
- CA6: «CA6 (0083)», con electron-log simulado y un `Proxy` que lanza en todo. Hoy **no** se descarta:
  el hook deja salir la excepción del filtro (el test falla por eso); el developer lo arregla.

Verificación 2026-10-11, commit d44853f, rango `main..fix/0083-log-enmascarar-anidados`: **VERDE**.

- `npm run check`: 221 ficheros, 3986 tests; cobertura: sentencias 92,83 %, ramas 90,03 %, funciones 89,94 %, líneas 93,58 %.
- `npm run test:e2e:affected`, un pase: 368 pasados, 0 fallos (1,4 min). Los tres e2e de tamaño de ventana que vio en rojo el developer (`views-entidad` «CA1 (0036)», `views-inicio` «CA4 (0005)», `views-servicio` «CA6 (0009)») pasan en limpio: ruido de su entorno (otra sesión trabajaba a la vez en la misma carpeta).

## Resultado

Commits: `a45aac8` (tests), `5fc1b6a` (filtro recursivo y descarte si falla), `aa413c9` y `1663f40` (ronda 2: `Map`, `Set`, instancias, `toJSON`, claves símbolo). Ficheros principales: `src/main/log-mask.ts`, `src/main/log-mask.test.ts`, comentario en `src/main/logging.ts`. Rondas de revisión: 2 (ronda 1 CAMBIOS, ronda 2 APROBADO). ADR nuevo: ninguno. Sin migraciones. Va sola en su PR (exclusión `seguridad`); la fusiona Dani.

Notas del developer:

- CA6: la excepción del filtro salía de `maskLogMessage` (por eso fallaba el test), pero no había
  fuga previa: electron-log 5.4.4 ya envuelve cada hook en un `try/catch` y descarta el mensaje.
  Arreglado en `maskLogMessage`, que ahora devuelve `LogMessage | false` con su propio
  `try/catch`: deja de depender de ese comportamiento de electron-log.
- Profundidad: límite de 32 niveles (`MAX_DEPTH`), muy por encima del 5 del fichero; por debajo,
  el valor se sustituye por el marcador `[profundidad máxima]`, que no lleva nada del original.
- Lo que no cambia se devuelve tal cual (mismo objeto): así una `cause` sin secretos sigue siendo
  la misma (test de la 0060). En un ciclo se copia todo el ciclo, para no mezclar original y copia.
- Ronda 2 (nota 1 del revisor): se recorre lo que escribe el fichero de electron-log 5.4.4
  (`transforms/object.js`): `Map` (claves y valores) y `Set` en copia del mismo tipo; lo que
  devuelve `toJSON` (se devuelve eso enmascarado, o el original si no cambia; un `toJSON` que lanza
  descarta el mensaje); el resto de instancias, salvo `Date`, por sus propiedades propias
  enumerables, en copia plana solo si algo cambia. Las claves símbolo enumerables cuentan como cambio
  (la copia no las lleva), por el camino de reserva de `util.formatWithOptions`. Si `toJSON` vuelve
  al mismo objeto, se pone el marcador `[referencia circular]`. Test en «Especificación (0083): Map,
  Set, instancias de clase y toJSON» (`aa413c9`, en rojo antes de `1663f40`).
- Anotado en la ficha 0060 (CA3) que la 0083 lo amplía. Las dos líneas del BACKLOG se quitan al
  cerrar.
