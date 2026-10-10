---
id: '0066'
titulo: 'La disponibilidad del servicio sale en su propio marcador, a la izquierda (con medición del flujo)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: ['0065']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0066-marcador-slo-servicio
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

«Quiero que se saque del cuadro tasa de error la disponibilidad del SLO, y que tenga su propia
cajita, a la izquierda de peticiones, para tenerlo ahí como dato y con los colores correspondientes
según su %. Para esta tarea, vamos hacer lo mismo de los tiempos que te he pedido antes, mediciones
de inicio, fin y demás, para medir estas ejecuciones.»

## Especificación

**1. El cambio.** Hoy la disponibilidad del rango (ficha 0048) sale como una línea pequeña
(`AvailabilityLine`, `data-testid="service-marker-availability"`) dentro del marcador «Tasa de
error» de `pages/entities/ServiceMarkers.tsx`. Pasa a ser **un marcador propio**:

- **Posición:** el primero de la fila, a la izquierda de «Peticiones OK». La fila pasa de cinco a
  seis marcadores (`lg:grid-cols-6`); en pantallas estrechas sigue el reparto de ahora.
- **Título:** «SLO» (como el gráfico tras la 0065); en inglés también «SLO».
- **Valor:** la disponibilidad del rango en grande, con un decimal (`formatAvailability`: «85,3 %»).
  Sin peticiones en el rango, «—» sin color. Mientras carga, en error y sin acceso, se comporta como
  los demás marcadores de métricas (`QueryState`).
- **Colores:** con el umbral crítico del 90 % que ya usa el gráfico (`AVAILABILITY_CRITICAL`, de
  Dani en la 0048): **por debajo del 90 %**, color de error y el texto «por debajo del 90 %» bajo el
  valor (el color no es la única señal); **del 90 % para arriba**, color de éxito (`success` del
  `Level` común de `EntityMarkers.tsx`). La regla va en una función pura
  (`availabilityLevel` o similar, en `service-availability.ts`). Decidido por Dani al aprobar (2026-10-10): dos colores con el umbral del 90 %, sin franja intermedia.
- Se hace con las piezas comunes (`MarkerCard`, `BigValue` con `level`, `MarkerBody`), como pide
  `src/renderer/CLAUDE.md`.
- **El marcador «Tasa de error»** se queda solo con su valor: la línea de disponibilidad desaparece
  de él.
- **Servicios de «solo actividad»** (sin errores medidos): no hay disponibilidad, así que el
  marcador no sale (como ahora la línea).
- **`data-testid`:** el marcador nuevo es `service-marker-availability` (con `service-marker-value`
  y `data-level` en el valor, como los demás); los demás no cambian. Los tests de la 0048 y la 0008
  que buscan la línea dentro de «Tasa de error» o cuentan cinco marcadores se actualizan.

**2. Medición del flujo (petición especial de Dani, como en la 0065).** Mismas reglas que la ficha
0065 (sección «Especificación», punto 2): cada paso con agente, ronda, inicio, fin y duración; el
Orquestador apunta también cuándo lanza cada subagente y cuándo le devuelve el control; cada
ejecución (check, e2e, build, test suelto, commit con su hook, push con el suyo) con comando,
horas, resultado y número de tests (pasan / fallan / saltados, unitarios y e2e aparte), cada
repetición en su fila; los jobs del CI; las esperas de Dani en fila propia; horas de
`date "+%Y-%m-%d %H:%M:%S"`, nunca estimadas; lo que no se pueda medir se dice. Al cerrar, el
doc-writer pone los totales en «Resultado». Así Dani puede comparar las dos fichas.

**Ligera:** es S y solo cambia la interfaz (sin IPC, API, dependencias, esquema ni seguridad). Sin
test-writer: el developer escribe primero los tests (commit solo de tests) y después el código.
Depende de la 0065 porque las dos tocan los mismos textos y tests del servicio.

## Criterios de aceptación

- CA1 (unitario): la función del nivel da error por debajo del 90 % (89,9), éxito en 90 justo y por
  encima (90 y 100), y sin color sin dato (`null`).
- CA2 (e2e): en un SERVICE del simulador con todas las métricas, la fila tiene seis marcadores y el
  primero (en el DOM y a la izquierda en pantalla) es `service-marker-availability`, con el título
  «SLO», seguido de «Peticiones OK»; el marcador «Tasa de error» ya no contiene la disponibilidad.
- CA3 (e2e): con una disponibilidad del 85,3 % el valor es «85,3 %», con `data-level="error"`, color
  de error y el texto «por debajo del 90 %»; con un 100,0 %, `data-level="success"`, color de éxito
  y sin ese texto.
- CA4 (e2e): en un servicio de solo actividad no sale el marcador; en uno sin peticiones en el rango
  sale «—» sin color (si el simulador no tiene ese caso, se añade).

## Pruebas a mano para Dani

- [ ] Con seis marcadores en la fila, el de «Tiempo de respuesta» (mediana, p90 y p99) se sigue
      leyendo bien en el ancho de tu pantalla.

## Fuera de alcance

- Cambiar el umbral del 90 % o el gráfico de disponibilidad.
- Dejar la medición del flujo como norma para otras fichas.

## Ideas surgidas (fuera de alcance)

(ninguna)

**Decisiones del developer (a revisar):**

- Columnas: `lg:grid-cols-3 xl:grid-cols-6` en vez del `lg:grid-cols-6` de la especificación. Con
  seis en lg, a 1024 px con el menú abierto cada tarjeta deja unos 77 px de contenido: «105 ms» y
  p90/p99 se salen y el e2e de centrado de la 0012 (CA2 y CA3) falla. En lg van de tres en tres (dos
  filas; «SLO» sigue el primero y a la izquierda de «Peticiones OK»), como `ApplicationMarkers`.
  Afecta a la prueba a mano: los seis en una fila solo a partir de 1280 px de ventana. (developer)
- Se quita la clave `entities.service.availability.marker` (es y en), que solo usaba la línea
  de «Tasa de error», y el test de textos de la 0048 deja de pedirla. El título del marcador es
  `availability.title` («SLO») y el texto crítico, `availability.markerCritical`. (developer)
- `availabilityLevel` devuelve un `Level`: `normal` sin dato. (developer)

## Notas del revisor

### Ronda 1: APROBADO

- CA1 a CA4 cubiertos, cada uno con su número: CA1 en `service-availability.test.ts` (89,9, 90,
  100 y `null`); CA2 a CA4 en `e2e/views.spec.ts` (orden en el DOM y en pantalla, «SLO»,
  `data-level`, color, «por debajo del 90 %», solo actividad y «—»). Rojo antes del código y sin
  tocar tests tras `ff7cdaf`.
- Piezas comunes de `EntityMarkers.tsx` y regla en la función pura `availabilityLevel` con
  `AVAILABILITY_CRITICAL`. Nada del tenant.
- Decisiones del developer: quitar la clave `marker` y los cambios de los e2e de la 0008, 0012,
  0047 y 0048 son los que pide la especificación.
- Columnas `lg:grid-cols-3 xl:grid-cols-6` en vez de `lg:grid-cols-6`: aceptable, no es
  `[ALCANCE]`. No cambia ningún CA, mantiene el centrado de la 0012 a 1024 px y sigue la pauta de
  `ApplicationMarkers.tsx`. Entre 1024 y 1279 px salen dos filas de tres; la de seis, desde 1280
  px, solo la ve la prueba a mano (los e2e van a 1024×720).

Opcionales: decirle a Dani en la prueba a mano lo de los 1280 px; dos comentarios pasan de 100
columnas (JSDoc de `ServiceMarkers.tsx` y el bloque de nombres de `e2e/views.spec.ts`).

## Verificación

(pendiente)

### Verifier, 2026-10-10, commit `2129de6`, rango `main..feat/0066-marcador-slo-servicio`: VERDE

- check: 3451 tests en 200 ficheros, cobertura ok (líneas 93,43 %, ramas 89,98 %).
- e2e afectados: 304/304.
- Los e2e «(0066)» y «(0012)» de `views.spec.ts` ×3 con `--workers=1`: 27/27; sin intermitentes.

## Resultado

- Commits (`main..HEAD`): `ff7cdaf` (tests), `add7c82` (el marcador), `b122dba` (columnas) y los de la ficha (`6f2338c`, `ea7a876`, `2129de6`, `59872da`) más el de cierre.
- Ficheros principales: `src/renderer/src/pages/entities/ServiceMarkers.tsx`, `service-availability.ts` (`availabilityLevel`), las claves de `locales/es` y `en/common.json`, `service-availability.test.ts`, `service-availability-view.test.ts` y `e2e/views.spec.ts`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Migraciones: no.
- Decisión del developer aceptada por el reviewer: `lg:grid-cols-3 xl:grid-cols-6` (los seis en una fila desde 1280 px; entre 1024 y 1279 px, dos filas de tres), porque `lg:grid-cols-6` rompía el centrado de la 0012 a 1024 px. Pasada a la prueba a mano de `docs/pendiente-dani.md`.
- Opcional del revisor pasado a «Mejoras anotadas» del BACKLOG: dos comentarios de más de 100 columnas (`ServiceMarkers.tsx` y el bloque de nombres de `e2e/views.spec.ts`). Lección añadida a `src/renderer/CLAUDE.md`.

**Totales de la medición** (de las tablas de abajo, hasta el CI en verde):

- Tiempo de reloj desde la petición: del primer comando del Planificador (12:55:05) a la vuelta del CI al Orquestador (14:42:18), 107 min 13 s; la llegada de la petición al Planificador no se pudo medir. De ahí, 13 min 50 s son del CI y 55 min 39 s de esperas; sin CI ni esperas, 37 min 44 s de trabajo.
- Por agente (solo tiempo medido): Planificador 1 min 8 s, developer 23 min 17 s, reviewer 43 s, verifier 7 min 54 s, doc-writer 1 min 1 s más la segunda pasada (0 min 16 s), Orquestador 3 min 24 s (lanzamientos, vueltas, filas de la ficha, commits, merge y push) y CI 13 min 50 s. El arranque interno de cada subagente y la redacción de sus respuestas no se pueden medir.
- Esperas: Dani 1 min 46 s (aprobación) y cola del Orquestador 53 min 53 s (estaban en curso la 0064 y la 0065); en total 55 min 39 s, que no son trabajo de ninguna ficha.
- Ejecuciones apuntadas: 27 filas en «Ejecuciones» (26 de comandos, una del developer sin hora, y el job del CI), repeticiones incluidas, más la de esta segunda pasada; no se apuntan el commit de cierre ni el de esta pasada, porque su contenido son estas tablas.
- Tests ejecutados: unitarios 10 472 en 6 ejecuciones (10 469 pasan y 3 fallan, el fallo esperado antes del código; 20 + 57 y 42 de los hooks + 3 × 3451) y e2e 1243 en 5 ejecuciones (1241 pasan y 2 fallan, el centrado de la 0012 a 1024 px, arreglado después), todos en verde al final. Los del CI no se cuentan.
- Frente a la 0065 (66 min 52 s de reloj, 13 min 35 s de CI, 31 min 33 s de esperas y 35 min 19 s de trabajo): la 0066 tarda más, 107 min 13 s, por la cola (53 min 53 s frente a 27 min 59 s) y por el developer (23 min 17 s frente a 8 min 23 s: toca un componente y no un texto, y un e2e en rojo obligó a cambiar las columnas y a repetir los e2e afectados). Reviewer (43 s frente a 20 s) y verifier (7 min 54 s frente a 8 min 10 s) se parecen, el CI también (13 min 50 s frente a 13 min 35 s). Hubo 5 ejecuciones de e2e (1243 tests) frente a 2 (602), y 3 check frente a 2.
- Este último commit de medición se integra con un segundo push (docs) cuyo CI no entra en el total.

## Medición del flujo

Horas en local (Europa/Madrid, +02:00). Duración en minutos y segundos.

### Pasos

| Paso                                                                                       | Agente         | Ronda | Inicio              | Fin                 | Duración    | Notas                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | -------------- | ----- | ------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redacción de la ficha                                                                      | Planificador   | —     | 2026-10-10 12:55:05 | 2026-10-10 12:56:12 | 1 min 7 s   | Desde el primer comando; la llegada del mensaje no se puede medir                                                                                                                     |
| Espera de la aprobación de Dani                                                            | Dani           | —     | 2026-10-10 12:56:12 | 2026-10-10 12:57:58 | 1 min 46 s  | Desde el aviso hasta su «1» (rojo/verde al 90 %)                                                                                                                                      |
| Aprobación, BACKLOG, commit y envío al Orquestador                                         | Planificador   | —     | 2026-10-10 12:57:58 | 2026-10-10 12:57:59 | 0 min 1 s   | Hasta antes del commit; el commit y el SendMessage tardan unos segundos más                                                                                                           |
| Espera en la cola del Orquestador (0064 y 0065 en curso)                                   | —              | —     | 2026-10-10 12:57:59 | 2026-10-10 13:51:52 | 53 min 53 s | Desde el commit de la aprobación hasta crear la rama                                                                                                                                  |
| Rama, lectura de la ficha y lanzamiento del developer                                      | Orquestador    | —     | 2026-10-10 13:51:52 | 2026-10-10 13:52:11 | 0 min 19 s  | Incluye el aviso de la 0065                                                                                                                                                           |
| Desarrollo (tests primero, código, ficha)                                                  | developer      | —     | 2026-10-10 13:52:14 | 2026-10-10 14:15:31 | 23 min 17 s | Desde su primer comando; no se puede medir lo que tarda en arrancar el subagente ni la redacción de su respuesta. Incluye un e2e en rojo (centrado de la 0012 a 1024 px) y su arreglo |
| Vuelta del developer al Orquestador                                                        | Orquestador    | —     | 2026-10-10 14:15:31 | 2026-10-10 14:16:00 | 0 min 29 s  | Incluye la redacción de su respuesta                                                                                                                                                  |
| Filas del developer en la ficha, commit y lanzamiento del reviewer                         | Orquestador    | 1     | 2026-10-10 14:16:00 | 2026-10-10 14:16:17 | 0 min 17 s  | Commit con hook de 14:16:09 a 14:16:10                                                                                                                                                |
| Revisión                                                                                   | reviewer       | 1     | 2026-10-10 14:16:20 | 2026-10-10 14:17:03 | 0 min 43 s  | APROBADO. Desde su primer comando al último; el arranque y la redacción de la respuesta no se pueden medir                                                                            |
| Vuelta del reviewer al Orquestador                                                         | Orquestador    | 1     | 2026-10-10 14:17:03 | 2026-10-10 14:17:32 | 0 min 29 s  | Incluye la redacción de su respuesta                                                                                                                                                  |
| Revisión en la ficha, commit y lanzamiento del verifier                                    | Orquestador    | 1     | 2026-10-10 14:17:32 | 2026-10-10 14:17:48 | 0 min 16 s  | Commit con hook de 14:17:40 a 14:17:41                                                                                                                                                |
| Verificación (modo ficha)                                                                  | verifier       | 1     | 2026-10-10 14:17:51 | 2026-10-10 14:25:45 | 7 min 54 s  | VERDE. Worktree limpio, npm ci, install-electron, check, e2e afectados, repeticiones ×3 de la 0066 y la 0012 y limpieza                                                               |
| Vuelta del verifier al Orquestador                                                         | Orquestador    | 1     | 2026-10-10 14:25:45 | 2026-10-10 14:26:05 | 0 min 20 s  | Incluye la redacción de su respuesta                                                                                                                                                  |
| Verificación en la ficha, commit y lanzamiento del doc-writer                              | Orquestador    | —     | 2026-10-10 14:26:05 | 2026-10-10 14:26:29 | 0 min 24 s  | Commit con hook de 14:26:13 a 14:26:14                                                                                                                                                |
| Cierre de la ficha: CHANGELOG, BACKLOG, pendiente-dani, CLAUDE.md del renderer y Resultado | doc-writer     | —     | 2026-10-10 14:26:29 | 2026-10-10 14:27:30 | 1 min 1 s   | Hasta la última lectura de hora; la pasada final de prettier y el commit de cierre no se midieron                                                                                     |
| Vuelta del doc-writer al Orquestador                                                       | Orquestador    | —     | 2026-10-10 14:27:35 | 2026-10-10 14:27:47 | 0 min 12 s  | Desde su commit de cierre                                                                                                                                                             |
| Merge fast-forward a main y push                                                           | Orquestador    | —     | 2026-10-10 14:27:48 | 2026-10-10 14:27:50 | 0 min 2 s   | El pre-push pasa `scan:tenant`                                                                                                                                                        |
| Espera del CI                                                                              | GitHub Actions | —     | 2026-10-10 14:27:52 | 2026-10-10 14:41:42 | 13 min 50 s | Run 38052042247, success; job `windows` de 14:27:56 a 14:41:41 (13 min 45 s)                                                                                                          |
| Vuelta del CI al Orquestador                                                               | Orquestador    | —     | 2026-10-10 14:41:42 | 2026-10-10 14:42:18 | 0 min 36 s  | Sondeo cada 30 s (lo vio a las 14:42:12) y lectura de los jobs                                                                                                                        |
| Segunda pasada: completar la medición hasta el CI                                          | doc-writer     | —     | 2026-10-10 14:42:29 | 2026-10-10 14:42:45 | 0 min 16 s  | Totales de Resultado y filas del Orquestador y del CI; el commit no se midió                                                                                                          |

### Ejecuciones

| Quién       | Comando                                                                                            | Inicio              | Fin                 | Duración    | Resultado                                           | Tests (pasan / fallan / saltados)       |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------- | ------------------- | ----------- | --------------------------------------------------- | --------------------------------------- |
| developer   | npx vitest run service-availability.test.ts y service-availability-view.test.ts (antes del código) | 2026-10-10 13:55:09 | 2026-10-10 13:55:11 | 2 s         | falla, como se esperaba (falta `availabilityLevel`) | unit 17 / 3 / 0                         |
| developer   | git commit (solo tests; hook: prettier y eslint)                                                   | 2026-10-10 13:55:18 | 2026-10-10 13:55:26 | 8 s         | ok                                                  | hook sin tests                          |
| developer   | npm run check                                                                                      | 2026-10-10 13:55:55 | 2026-10-10 13:56:50 | 55 s        | ok                                                  | unit 3451 / 0 / 0                       |
| developer   | git commit (código; hook: prettier, lint, typecheck y vitest related)                              | 2026-10-10 13:56:55 | 2026-10-10 13:57:29 | 34 s        | ok                                                  | unit (related) 57 / 0 / 0               |
| developer   | npm run test:e2e:affected -- main..HEAD (con compilación)                                          | 2026-10-10 13:57:34 | 2026-10-10 14:02:50 | 5 min 16 s  | falla (CA2 y CA3 de la 0012 a 1024×720)             | e2e 302 / 2 / 0                         |
| developer   | npm run test:e2e:affected -- main (columnas sin commitear; con compilación)                        | 2026-10-10 14:03:35 | 2026-10-10 14:08:48 | 5 min 13 s  | ok                                                  | e2e 304 / 0 / 0                         |
| developer   | git commit (columnas; hook: prettier, lint, typecheck y vitest related)                            | 2026-10-10 14:08:55 | 2026-10-10 14:09:13 | 18 s        | ok                                                  | unit (related) 42 / 0 / 0               |
| developer   | npm run check                                                                                      | 2026-10-10 14:09:25 | 2026-10-10 14:10:07 | 42 s        | ok                                                  | unit 3451 / 0 / 0                       |
| developer   | npm run test:e2e:affected -- main..HEAD (con compilación)                                          | 2026-10-10 14:10:11 | 2026-10-10 14:15:24 | 5 min 13 s  | ok                                                  | e2e 304 / 0 / 0                         |
| developer   | git commit (ficha; hook: prettier)                                                                 | 2026-10-10 14:15:28 | 2026-10-10 14:15:29 | 1 s         | ok                                                  | hook sin tests                          |
| developer   | npx tsc y npx prettier sueltos                                                                     | sin hora            | sin hora            | —           | ok                                                  | no se midieron (lo dice el developer)   |
| Orquestador | git commit (medición del developer; hook: prettier)                                                | 2026-10-10 14:16:09 | 2026-10-10 14:16:10 | 1 s         | ok                                                  | hook sin tests                          |
| Orquestador | git commit (ronda 1; hook: prettier)                                                               | 2026-10-10 14:17:40 | 2026-10-10 14:17:41 | 1 s         | ok                                                  | hook sin tests                          |
| verifier    | git worktree add --detach (2129de6)                                                                | 2026-10-10 14:17:51 | 2026-10-10 14:17:51 | < 1 s       | ok                                                  | —                                       |
| verifier    | npm ci --ignore-scripts                                                                            | 2026-10-10 14:17:54 | 2026-10-10 14:18:08 | 14 s        | ok                                                  | —                                       |
| verifier    | npx install-electron                                                                               | 2026-10-10 14:18:08 | 2026-10-10 14:18:11 | 3 s         | ok                                                  | —                                       |
| verifier    | npm run check                                                                                      | 2026-10-10 14:18:11 | 2026-10-10 14:19:44 | 1 min 33 s  | ok                                                  | unit 3451 / 0 / 0                       |
| verifier    | npm run test:e2e:affected -- main..feat/0066-marcador-slo-servicio (con compilación)               | 2026-10-10 14:19:47 | 2026-10-10 14:25:01 | 5 min 14 s  | ok                                                  | e2e 304 / 0 / 0                         |
| verifier    | npx playwright test e2e/views.spec.ts --workers=1 --repeat-each 3 -g "(0066\|0012)"                | 2026-10-10 14:25:07 | 2026-10-10 14:25:25 | 18 s        | ok                                                  | e2e 27 / 0 / 0                          |
| verifier    | limpieza del worktree (ruta larga, con reintentos) y git worktree prune                            | 2026-10-10 14:25:28 | 2026-10-10 14:25:45 | 17 s        | ok                                                  | —                                       |
| Orquestador | git commit (verificación; hook: prettier)                                                          | 2026-10-10 14:26:13 | 2026-10-10 14:26:14 | 1 s         | ok                                                  | hook sin tests                          |
| doc-writer  | npx prettier --write (BACKLOG, CHANGELOG, pendiente-dani, CLAUDE.md del renderer y ficha)          | 2026-10-10 14:27:17 | 2026-10-10 14:27:19 | 2 s         | ok                                                  | —                                       |
| Orquestador | git merge --ff-only en el checkout principal                                                       | 2026-10-10 14:27:48 | 2026-10-10 14:27:48 | < 1 s       | ok                                                  | —                                       |
| Orquestador | git push origin main (pre-push: scan:tenant)                                                       | 2026-10-10 14:27:48 | 2026-10-10 14:27:50 | 2 s         | ok                                                  | —                                       |
| CI          | job windows (run 38052042247)                                                                      | 2026-10-10 14:27:56 | 2026-10-10 14:41:41 | 13 min 45 s | success                                             | no se cuentan: no copio los logs del CI |
