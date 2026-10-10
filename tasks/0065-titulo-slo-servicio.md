---
id: '0065'
titulo: 'El gráfico de disponibilidad del servicio se titula «SLO» (con medición del flujo)'
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0065-titulo-slo-servicio
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

«Vamos hacer un cambio al título del gráfico de SLO de la página de SERVICE. El título quiero que
ponga SLO, con eso es suficiente. Como petición especial para esta tarea, quiero que se registre el
tiempo de cada paso, Inicio y fin, por cada agente y las ejecuciones que realice para ver cuanto se
tarda en este cambio, número de test ejecutados. Basicamente, medir el flujo completo con detalle
para determinar el flujo con exactitud.»

## Especificación

**1. El cambio.** El panel de disponibilidad de la página de un SERVICE (ficha 0048,
`ServiceAvailabilityPanel` en `pages/entities/ServiceCharts.tsx`, `data-testid="service-slo-title"`)
se titula hoy «Disponibilidad (SLO calculado)» / «Availability (calculated SLO)». Pasa a **«SLO»** en
los dos idiomas: la clave `entities.service.availability.title` de `locales/es/common.json` y
`locales/en/common.json`.

No cambia nada más: el tooltip del título (`availability.hint`, que explica la fórmula y que lo
calcula Vigía, no Dynatrace) se queda igual, y también el nombre de la serie («Disponibilidad»), el
marcador, el umbral y los `data-testid`. Los tests de la 0048 que fijan el título viejo
(`locales/service-availability-view.test.ts` y el CA3 de la 0048 en `e2e/views.spec.ts`) se
actualizan al nuevo.

**2. Medición del flujo (petición especial de Dani, solo para esta ficha).** Dani quiere saber con
exactitud cuánto tarda el flujo completo en un cambio pequeño. Cada paso se apunta en la sección
«Medición del flujo» de esta ficha (abajo), con la hora sacada de `date "+%Y-%m-%d %H:%M:%S"` (no
estimada):

- **Por paso** (Planificador, Orquestador, developer, reviewer en cada ronda, verifier, doc-writer,
  merge y push, CI): agente, ronda, hora de inicio, hora de fin y duración. El Orquestador apunta
  también la hora a la que lanza cada subagente y a la que le devuelve el control, así se ve el
  tiempo entre pasos.
- **Por ejecución** (cada `npm run check`, `test:e2e`, `test:e2e:affected`, `test:e2e:nobuild`,
  `build`, `lint`, un test suelto, `git commit` con su hook y `git push` con el suyo): quién la
  lanza, el comando, el inicio, el fin, el resultado y el **número de tests** (pasados, fallidos y
  saltados; unitarios y e2e por separado). Las repeticiones también cuentan, cada una en su fila.
- **CI:** inicio, fin y resultado de cada job, con `gh run view` (sin copiar logs).
- **Esperas de Dani** (aprobación, respuestas): en su propia fila, para no mezclarlas con el tiempo
  de trabajo.
- Al cerrar, el doc-writer suma en «Resultado»: tiempo total de reloj (de la petición al CI en
  verde), tiempo por agente, tiempo en esperas, número de ejecuciones y total de tests ejecutados.

Apuntarlo añade unos segundos a cada paso: se acepta. Lo que no se pueda medir (por ejemplo, lo que
tarda en arrancar un subagente por dentro) se dice tal cual, sin inventar la cifra. En la tabla no
va nada del tenant ni ningún secreto. **No cambia el flujo de las demás fichas**: si Dani quiere
que la medición sea fija, será otra ficha.

**Ligera:** es S y solo cambia un texto de la interfaz (sin IPC, API, dependencias, esquema ni
seguridad). Sin test-writer: el developer actualiza primero los tests (commit solo de tests) y
después el texto.

## Criterios de aceptación

- CA1 (unitario): `entities.service.availability.title` vale «SLO» en `es` y en `en`, y `hint` sigue
  explicando la fórmula (menciona peticiones, errores y Vigía).
- CA2 (e2e): en la página de un SERVICE del simulador, `service-slo-title` tiene exactamente el
  texto «SLO» y su tooltip sigue mostrando la fórmula (CA5 de la 0048 sin cambios).

## Pruebas a mano para Dani

(ninguna: Dani lo verá al abrir un servicio)

## Fuera de alcance

- Cambiar el tooltip, el marcador de disponibilidad o el nombre de la serie.
- Dejar la medición del flujo como norma para otras fichas.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- CA1: el `describe('CA1 (0065)…')` de `locales/service-availability-view.test.ts` exige «SLO» en
  es y en y que `hint` siga nombrando peticiones, errores y Vigía; fallaba antes del código.
- CA2: el CA3 de la 0048 en `e2e/views.spec.ts` exige el texto exacto «SLO» y el antiguo CA5,
  ahora «CA2 (0065) y CA5 (0048)», sigue abriendo el tooltip con ratón y con foco. Nada tocó los
  tests después de `ca7dff9`.
- El cambio del test de la 0048 (sacar `title` de «en distinto de es») es correcto: la ficha pide
  actualizar esos tests, «SLO» está en el glosario como término igual en los dos idiomas, el
  comentario lo explica y las demás claves siguen comprobadas.
- Solo cambia un texto; nada del tenant ni secretos.

Opcional: añadir «CA2 (0065)» al nombre del test «CA3 (0048)», que es el que comprueba el texto
exacto (regla de `e2e/CLAUDE.md`).

## Verificación

(pendiente)

### Verifier, 2026-10-10, commit `bb1b955`, rango `main..feat/0065-titulo-slo-servicio`: VERDE

- check: 3448 tests en 200 ficheros, cobertura ok (líneas 93,43 %, ramas 89,98 %).
- e2e afectados (`views.spec.ts` y las áreas de `locales/en/common.json`): 301/301, con «CA2
  (0065) y CA5 (0048)».
- Sin `--repeat-each`: el diff solo cambia un título y su traducción.

## Resultado

(pendiente)

## Medición del flujo

Horas en local (Europa/Madrid, +02:00). Duración en minutos y segundos.

### Pasos

| Paso                                                    | Agente       | Ronda | Inicio              | Fin                 | Duración    | Notas                                                                                                            |
| ------------------------------------------------------- | ------------ | ----- | ------------------- | ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Redacción de la ficha                                   | Planificador | —     | 2026-10-10 12:44:08 | 2026-10-10 12:44:50 | 0 min 42 s  | Desde el primer comando; la llegada del mensaje no se puede medir                                                |
| Espera de la aprobación de Dani                         | Dani         | —     | 2026-10-10 12:44:50 | 2026-10-10 12:48:24 | 3 min 34 s  | Desde el aviso hasta su «1» (ligera)                                                                             |
| Aprobación, BACKLOG, commit y envío al Orquestador      | Planificador | —     | 2026-10-10 12:48:24 | 2026-10-10 12:48:32 | 0 min 8 s   | Hasta antes del commit; el commit y el SendMessage tardan unos segundos más                                      |
| Espera en la cola del Orquestador (0064 en curso)       | —            | —     | 2026-10-10 12:48:33 | 2026-10-10 13:16:32 | 27 min 59 s | Desde el commit de la aprobación hasta crear la rama; la 0064 estaba en cierre e integración                     |
| Rama y lanzamiento del developer                        | Orquestador  | —     | 2026-10-10 13:16:32 | 2026-10-10 13:16:45 | 0 min 13 s  | Incluye leer la ficha; lanzado entre 13:16:36 y 13:16:45                                                         |
| Tests, texto, check, e2e afectados y ficha en revisión  | developer    | —     | 2026-10-10 13:16:46 | 2026-10-10 13:25:09 | 8 min 23 s  | Desde su primer comando; no se puede medir lo que tarda en arrancar el subagente ni la redacción de su respuesta |
| Vuelta del developer al Orquestador                     | Orquestador  | —     | 2026-10-10 13:25:09 | 2026-10-10 13:25:27 | 0 min 18 s  | Del último comando del developer a mi primer comando tras su respuesta                                           |
| Filas del developer en la ficha y commit                | Orquestador  | —     | 2026-10-10 13:25:27 | 2026-10-10 13:25:43 | 0 min 16 s  |                                                                                                                  |
| Lanzamiento del reviewer                                | Orquestador  | 1     | 2026-10-10 13:25:43 | 2026-10-10 13:25:50 | 0 min 7 s   |                                                                                                                  |
| Revisión                                                | reviewer     | 1     | 2026-10-10 13:25:54 | 2026-10-10 13:26:14 | 0 min 20 s  | APROBADO. Desde su primer comando al último; el arranque y la redacción de la respuesta no se pueden medir       |
| Vuelta del reviewer al Orquestador                      | Orquestador  | 1     | 2026-10-10 13:26:14 | 2026-10-10 13:26:35 | 0 min 21 s  | Incluye la redacción de su respuesta                                                                             |
| Revisión en la ficha, commit y lanzamiento del verifier | Orquestador  | 1     | 2026-10-10 13:26:35 | 2026-10-10 13:26:58 | 0 min 23 s  | Commit con hook de 13:26:49 a 13:26:50                                                                           |
| Verificación (modo ficha)                               | verifier     | 1     | 2026-10-10 13:27:00 | 2026-10-10 13:35:10 | 8 min 10 s  | VERDE. Worktree limpio, `npm ci`, `install-electron`, check, e2e afectados y limpieza                            |
| Vuelta del verifier al Orquestador                      | Orquestador  | 1     | 2026-10-10 13:35:10 | 2026-10-10 13:35:30 | 0 min 20 s  | Incluye la redacción de su respuesta                                                                             |

### Ejecuciones

| Quién        | Comando                                                                         | Inicio              | Fin                 | Duración   | Resultado                     | Tests (pasan / fallan / saltados)                                         |
| ------------ | ------------------------------------------------------------------------------- | ------------------- | ------------------- | ---------- | ----------------------------- | ------------------------------------------------------------------------- |
| Planificador | npx prettier --write (ficha y BACKLOG)                                          | 2026-10-10 12:48:32 | 2026-10-10 12:48:32 | < 1 s      | ok                            | —                                                                         |
| developer    | npx vitest run locales/service-availability-view.test.ts (antes del código)     | 2026-10-10 13:17:11 | 2026-10-10 13:17:13 | 2 s        | falla, como se esperaba (CA1) | unit 4 / 1 / 0                                                            |
| developer    | git commit (solo tests; hook: prettier y eslint)                                | 2026-10-10 13:17:16 | 2026-10-10 13:17:24 | 8 s        | ok                            | hook sin tests                                                            |
| developer    | npx vitest run src/renderer/src/locales/                                        | 2026-10-10 13:17:28 | 2026-10-10 13:17:38 | 10 s       | ok                            | unit 110 / 0 / 0                                                          |
| developer    | git commit (texto; hook: prettier, lint y typecheck)                            | 2026-10-10 13:17:42 | 2026-10-10 13:18:12 | 30 s       | ok                            | hook sin tests                                                            |
| developer    | npm run check                                                                   | 2026-10-10 13:18:17 | 2026-10-10 13:18:59 | 42 s       | ok                            | unit 3448 / 0 / 0                                                         |
| developer    | npm run test:e2e:affected -- main..HEAD (con compilación; shell, smoke y views) | 2026-10-10 13:19:04 | 2026-10-10 13:24:48 | 5 min 44 s | ok                            | e2e 301 / 0 / 0 (Playwright: 5,4 min; la compilación no se puede separar) |
| developer    | git commit (ficha; hook: prettier)                                              | 2026-10-10 13:25:06 | 2026-10-10 13:25:07 | 1 s        | ok                            | hook sin tests                                                            |
| Orquestador  | git commit (medición del developer; hook: prettier)                             | 2026-10-10 13:25:42 | 2026-10-10 13:25:43 | 1 s        | ok                            | hook sin tests                                                            |
| Orquestador  | git commit (ronda 1; hook: prettier)                                            | 2026-10-10 13:26:49 | 2026-10-10 13:26:50 | 1 s        | ok                            | hook sin tests                                                            |
| verifier     | git worktree add --detach (bb1b955)                                             | 2026-10-10 13:27:00 | 2026-10-10 13:27:00 | < 1 s      | ok                            | —                                                                         |
| verifier     | npm ci --ignore-scripts                                                         | 2026-10-10 13:27:02 | 2026-10-10 13:27:17 | 15 s       | ok                            | —                                                                         |
| verifier     | npx install-electron                                                            | 2026-10-10 13:27:17 | 2026-10-10 13:27:20 | 3 s        | ok                            | —                                                                         |
| verifier     | npm run check                                                                   | 2026-10-10 13:27:22 | 2026-10-10 13:28:53 | 1 min 31 s | ok                            | unit 3448 / 0 / 0                                                         |
| verifier     | npm run test:e2e:affected -- main..bb1b955 (con compilación)                    | 2026-10-10 13:28:56 | 2026-10-10 13:34:48 | 5 min 52 s | ok                            | e2e 301 / 0 / 0                                                           |
| verifier     | limpieza del worktree (ruta larga, con reintentos)                              | 2026-10-10 13:34:52 | 2026-10-10 13:35:10 | 18 s       | ok                            | —                                                                         |
