---
id: '0066'
titulo: 'La disponibilidad del servicio sale en su propio marcador, a la izquierda (con medición del flujo)'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)

## Medición del flujo

Horas en local (Europa/Madrid, +02:00). Duración en minutos y segundos.

### Pasos

| Paso                                                     | Agente       | Ronda | Inicio              | Fin                 | Duración    | Notas                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------ | ----- | ------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redacción de la ficha                                    | Planificador | —     | 2026-10-10 12:55:05 | 2026-10-10 12:56:12 | 1 min 7 s   | Desde el primer comando; la llegada del mensaje no se puede medir                                                                                                                     |
| Espera de la aprobación de Dani                          | Dani         | —     | 2026-10-10 12:56:12 | 2026-10-10 12:57:58 | 1 min 46 s  | Desde el aviso hasta su «1» (rojo/verde al 90 %)                                                                                                                                      |
| Aprobación, BACKLOG, commit y envío al Orquestador       | Planificador | —     | 2026-10-10 12:57:58 | 2026-10-10 12:57:59 | 0 min 1 s   | Hasta antes del commit; el commit y el SendMessage tardan unos segundos más                                                                                                           |
| Espera en la cola del Orquestador (0064 y 0065 en curso) | —            | —     | 2026-10-10 12:57:59 | 2026-10-10 13:51:52 | 53 min 53 s | Desde el commit de la aprobación hasta crear la rama                                                                                                                                  |
| Rama, lectura de la ficha y lanzamiento del developer    | Orquestador  | —     | 2026-10-10 13:51:52 | 2026-10-10 13:52:11 | 0 min 19 s  | Incluye el aviso de la 0065                                                                                                                                                           |
| Desarrollo (tests primero, código, ficha)                | developer    | —     | 2026-10-10 13:52:14 | 2026-10-10 14:15:31 | 23 min 17 s | Desde su primer comando; no se puede medir lo que tarda en arrancar el subagente ni la redacción de su respuesta. Incluye un e2e en rojo (centrado de la 0012 a 1024 px) y su arreglo |
| Vuelta del developer al Orquestador                      | Orquestador  | —     | 2026-10-10 14:15:31 | 2026-10-10 14:16:00 | 0 min 29 s  | Incluye la redacción de su respuesta                                                                                                                                                  |

### Ejecuciones

| Quién     | Comando                                                                                            | Inicio              | Fin                 | Duración   | Resultado                                           | Tests (pasan / fallan / saltados)     |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------- | ------------------- | ---------- | --------------------------------------------------- | ------------------------------------- |
| developer | npx vitest run service-availability.test.ts y service-availability-view.test.ts (antes del código) | 2026-10-10 13:55:09 | 2026-10-10 13:55:11 | 2 s        | falla, como se esperaba (falta `availabilityLevel`) | unit 17 / 3 / 0                       |
| developer | git commit (solo tests; hook: prettier y eslint)                                                   | 2026-10-10 13:55:18 | 2026-10-10 13:55:26 | 8 s        | ok                                                  | hook sin tests                        |
| developer | npm run check                                                                                      | 2026-10-10 13:55:55 | 2026-10-10 13:56:50 | 55 s       | ok                                                  | unit 3451 / 0 / 0                     |
| developer | git commit (código; hook: prettier, lint, typecheck y vitest related)                              | 2026-10-10 13:56:55 | 2026-10-10 13:57:29 | 34 s       | ok                                                  | unit (related) 57 / 0 / 0             |
| developer | npm run test:e2e:affected -- main..HEAD (con compilación)                                          | 2026-10-10 13:57:34 | 2026-10-10 14:02:50 | 5 min 16 s | falla (CA2 y CA3 de la 0012 a 1024×720)             | e2e 302 / 2 / 0                       |
| developer | npm run test:e2e:affected -- main (columnas sin commitear; con compilación)                        | 2026-10-10 14:03:35 | 2026-10-10 14:08:48 | 5 min 13 s | ok                                                  | e2e 304 / 0 / 0                       |
| developer | git commit (columnas; hook: prettier, lint, typecheck y vitest related)                            | 2026-10-10 14:08:55 | 2026-10-10 14:09:13 | 18 s       | ok                                                  | unit (related) 42 / 0 / 0             |
| developer | npm run check                                                                                      | 2026-10-10 14:09:25 | 2026-10-10 14:10:07 | 42 s       | ok                                                  | unit 3451 / 0 / 0                     |
| developer | npm run test:e2e:affected -- main..HEAD (con compilación)                                          | 2026-10-10 14:10:11 | 2026-10-10 14:15:24 | 5 min 13 s | ok                                                  | e2e 304 / 0 / 0                       |
| developer | git commit (ficha; hook: prettier)                                                                 | 2026-10-10 14:15:28 | 2026-10-10 14:15:29 | 1 s        | ok                                                  | hook sin tests                        |
| developer | npx tsc y npx prettier sueltos                                                                     | sin hora            | sin hora            | —          | ok                                                  | no se midieron (lo dice el developer) |
