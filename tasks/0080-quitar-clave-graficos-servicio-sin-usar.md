---
id: '0080'
titulo: 'Quitar la clave sin usar entities.service.charts.loadError (con medición del flujo)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

- (developer) `npm run test:e2e:affected` en Windows falla con un cambio solo de textos (0071): el
  patrón `--grep (?:@servicio|@smoke)` va sin comillas a `spawnSync` con `shell: true`
  (`scripts/affected-e2e.cjs`, línea 412) y cmd toma el `|` por una tubería («"smoke)" no se
  reconoce como un comando»; Playwright acaba en EPIPE). Los unitarios de textos y el build sí
  corren. Hay que citar los argumentos o lanzar sin shell. En esta ficha se lanzó a mano el
  comando equivalente.

## Notas del revisor

### Ronda 1: APROBADO

- CA1 cumplido: `src/renderer/src/locales/service-charts.test.ts` tiene dos tests «CA1 (0080)» (sin `loadError` en es ni en; las 18 claves que quedan en `entities.service.charts`, exactas en los dos idiomas). Fallaron 2 antes del código y no se tocaron después del commit de tests. La paridad del CA9 (0009) sigue igual.
- El cambio solo quita `loadError` de `es/common.json` y `en/common.json`; `entities.service.markers.loadError` no se toca. La clave solo aparece en el test nuevo; `ServiceCharts.tsx:110` construye `entities.service.charts.${kind}` con tipos que no la incluyen.
- Carril: se respeta la clasificación (ligera). Sin componentes, funciones ni cálculos nuevos, nada visible quitado, sin datos, API, IPC, esquema ni dependencias, sin datos del tenant.
- Opcional: que el verifier relance `test:e2e:affected` tras el rebase para confirmar el arreglo de la 0071 con un cambio solo de textos.

## Verificación

(pendiente)

Verificación 2026-10-11, commit 3ed6c58, rango `integra/20261011-7..chore/0080-quitar-clave-graficos-servicio`: **VERDE**.

- `npm run check`: 218 ficheros, 3833 tests; cobertura: sentencias 92,74 %, ramas 90,06 %, funciones 89,83 %, líneas 93,51 %.
- `npm run test:e2e:affected`, un pase, exit 0 (el arreglo de Windows de la 0071 funciona): solo textos (`entities.service.charts.loadError` → `@servicio`); unitarios de textos 112 de 112; e2e de `smoke.spec.ts` y `views-servicio.spec.ts` con `@servicio` y `@smoke`: 61 pasados, 0 fallos, 0 saltados (54,8 s).

## Resultado

Totales (con el CI y la fusión de la PR #10, compartidos con la 0081):

- Reloj desde la aprobación (12:45:43) hasta el commit del doc-writer (14:44:55): 119 min 12 s. Sin la espera de la cola (85 min 24 s) y sin la parada de la 0071 (20 min 39 s): 13 min 9 s.
- Tiempo por agente: Planificador 0 min 43 s (aprobación), developer 4 min 20 s, reviewer 0 min 10 s, verifier 4 min 12 s, doc-writer 0 min 41 s, Orquestador 1 min 43 s (rama, arranques, vueltas y commits); lo que falta hasta los 13 min 9 s son huecos entre pasos. La redacción del lote (8 min 27 s) y la espera de Dani (8 min 2 s) son anteriores a la aprobación y no cuentan.
- Reloj desde la aprobación (12:45:43) hasta el CI de main en verde (16:15:15): 209 min 32 s. Sin la cola (85 min 24 s en la cola y 38 min 13 s esperando a la 0084) y sin la parada de la 0071 (20 min 39 s): 65 min 16 s; sin además la espera del relanzamiento (24 min 5 s, el token no puede relanzar jobs): 41 min 11 s. Del push de la integración al CI de main en verde (15:23:50 a 16:15:15): 51 min 25 s, de los que 10 min 2 s fueron del intento 1 del CI (falló un e2e sospechoso de inestable), 24 min 5 s la espera de Dani, 8 min 8 s el intento 2 y 6 min 47 s el CI de main.
- Ejecuciones: 10 (developer 4, verifier 6). Tests: 3833 unitarios del check del verifier, todos en verde; e2e afectados 61 en verde, 0 fallos, 0 saltados. El primer `test:e2e:affected` del developer cayó por el fallo de Windows de la 0071, ya arreglado.
- Commits de la rama: tests (1361750), clave quitada (7d14c1f) y fichas; revisión: 1 ronda, APROBADO. Ficheros: `src/renderer/src/locales/es/common.json`, `en/common.json` y `service-charts.test.ts`. Sin ADR nuevo ni migraciones.

## Medición del flujo

Horas en local (Europa/Madrid, +02:00). Duración en minutos y segundos.

### Pasos

| Paso                                                                                                                                       | Agente       | Ronda | Inicio              | Fin                 | Duración    | Notas                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----- | ------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redacción del lote de seis fichas (0080 a 0085)                                                                                            | Planificador | —     | 2026-10-11 12:29:14 | 2026-10-11 12:37:41 | 8 min 27 s  | Primer `date` tomado; la llegada del mensaje de Dani no se puede medir. Es la redacción de seis fichas, no solo de esta                                                               |
| Espera de la aprobación de Dani                                                                                                            | Dani         | —     | 2026-10-11 12:37:41 | 2026-10-11 12:45:43 | 8 min 2 s   | Desde la presentación del lote (con dos preguntas, de la 0081 y la 0085) hasta su respuesta; incluye leerla                                                                           |
| Aprobación del lote, decisiones en las fichas, BACKLOG, commit y envío al Orquestador                                                      | Planificador | —     | 2026-10-11 12:45:43 | 2026-10-11 12:46:26 | 0 min 43 s  | Las seis fichas del lote, hasta antes de prettier y del commit; el commit y el SendMessage tardan unos segundos más                                                                   |
| Espera en la cola (delante, 0079, 0070 y 0071)                                                                                             | Cola         | —     | 2026-10-11 12:46:26 | 2026-10-11 14:11:50 | 85 min 24 s | Desde el envío de la cola del Planificador hasta que el Orquestador empieza la 0080                                                                                                   |
| Rama de la ficha desde la integración en curso                                                                                             | Orquestador  | —     | 2026-10-11 14:11:50 | 2026-10-11 14:11:59 | 0 min 9 s   | `git switch -c` desde `integra/20261011-7`                                                                                                                                            |
| Arranque del developer                                                                                                                     | Orquestador  | 1     | 2026-10-11 14:11:59 | 2026-10-11 14:12:03 | 0 min 4 s   | Hora del Orquestador al lanzarlo frente al primer comando del developer                                                                                                               |
| Desarrollo de la 0080 (tests, código, check, e2e afectados, ficha)                                                                         | developer    | 1     | 2026-10-11 14:12:03 | 2026-10-11 14:16:23 | 4 min 20 s  | Ligera: commit solo de tests y después los JSON. `test:e2e:affected` falló por el `\|` del `--grep` con shell en Windows (fallo de la 0071, anotado en la ficha); e2e lanzados a mano |
| Vuelta del developer                                                                                                                       | Orquestador  | 1     | 2026-10-11 14:16:23 | 2026-10-11 14:16:47 | 0 min 24 s  | Último `date` del developer frente a la recepción de su respuesta                                                                                                                     |
| Parada: arreglo de la 0071 (`--grep` con la barra vertical en Windows), reabierta y llevada por developer, reviewer, verifier y doc-writer | Cola         | —     | 2026-10-11 14:17:16 | 2026-10-11 14:37:55 | 20 min 39 s | Fallo de la herramienta de la 0071 destapado por esta ficha; no cuenta como tiempo de la 0080                                                                                         |
| Arranque del reviewer                                                                                                                      | Orquestador  | 1     | 2026-10-11 14:38:28 | 2026-10-11 14:38:32 | 0 min 4 s   | Hora del Orquestador al lanzarlo frente al primer comando del reviewer                                                                                                                |
| Revisión (criterio, diff, carril)                                                                                                          | reviewer     | 1     | 2026-10-11 14:38:32 | 2026-10-11 14:38:42 | 0 min 10 s  | Solo lecturas de git, sin ejecuciones; APROBADO                                                                                                                                       |
| Vuelta del reviewer, notas y medición en la ficha, commit                                                                                  | Orquestador  | 1     | 2026-10-11 14:38:42 | 2026-10-11 14:39:07 | 0 min 25 s  | Incluye el hook de prettier del commit                                                                                                                                                |
| Arranque del verifier                                                                                                                      | Orquestador  | 1     | 2026-10-11 14:39:16 | 2026-10-11 14:39:21 | 0 min 5 s   | Hora del Orquestador al lanzarlo frente al primer comando del verifier                                                                                                                |
| Verificación (worktree, npm ci, install-electron, check, e2e afectados)                                                                    | verifier     | 1     | 2026-10-11 14:39:21 | 2026-10-11 14:43:33 | 4 min 12 s  | Preparación 17 s; check 2 min 1 s; e2e afectados 1 min 35 s; limpieza al final. VERDE                                                                                                 |
| Vuelta del verifier                                                                                                                        | Orquestador  | 1     | 2026-10-11 14:43:33 | 2026-10-11 14:43:50 | 0 min 17 s  | Último `date` del verifier frente a la recepción de su respuesta                                                                                                                      |
| Vuelta del verifier, notas y medición en la ficha, commit                                                                                  | Orquestador  | 1     | 2026-10-11 14:43:50 | 2026-10-11 14:44:01 | 0 min 11 s  | Incluye el hook de prettier del commit                                                                                                                                                |
| Arranque del doc-writer                                                                                                                    | Orquestador  | 1     | 2026-10-11 14:44:10 | 2026-10-11 14:44:14 | 0 min 4 s   | Hora del Orquestador al lanzarlo frente al primer comando del doc-writer                                                                                                              |
| Cierre: CHANGELOG, BACKLOG, ficha y commit                                                                                                 | doc-writer   | 1     | 2026-10-11 14:44:14 | 2026-10-11 14:44:55 | 0 min 41 s  | CHANGELOG (Cambiado), BACKLOG (sale de Mejoras anotadas y entra en Hecho), Resultado; sin ADR; ideas nuevas ninguna (el fallo del e2e afectado ya lo arregló la 0071)                 |
| Integración: Traer main, merge --squash en integra/20261011-7, commit con su hook y push                                                   | Orquestador  | —     | 2026-10-11 14:45:13 | 2026-10-11 14:45:37 | 0 min 24 s  | Push sin CI; la PR del grupo se abre con la 0084                                                                                                                                      |
| Espera de la 0084 para completar el grupo de cinco                                                                                         | Cola         | —     | 2026-10-11 14:45:37 | 2026-10-11 15:23:50 | 38 min 13 s | La PR se abre al llegar a cinco fichas                                                                                                                                                |
| Push de la integración y PR #10                                                                                                            | Orquestador  | —     | 2026-10-11 15:23:50 | 2026-10-11 15:23:55 | 0 min 5 s   | Sin esperar al CI                                                                                                                                                                     |
| CI de la PR #10, intento 1 (falla un e2e de views-problema-detalle)                                                                        | CI           | —     | 2026-10-11 15:24:01 | 2026-10-11 15:34:03 | 10 min 2 s  | Sospechoso de inestable, anotado en el BACKLOG                                                                                                                                        |
| Espera de Dani para relanzar el job (el token no puede)                                                                                    | Dani         | —     | 2026-10-11 15:34:31 | 2026-10-11 15:58:36 | 24 min 5 s  | El token de `gh` no puede relanzar jobs (HTTP 403)                                                                                                                                    |
| CI de la PR #10, intento 2                                                                                                                 | CI           | —     | 2026-10-11 15:58:36 | 2026-10-11 16:06:44 | 8 min 8 s   | Verde                                                                                                                                                                                 |
| Aviso de Dani y comprobación del Orquestador                                                                                               | Orquestador  | —     | 2026-10-11 16:06:44 | 2026-10-11 16:08:19 | 1 min 35 s  | Dani avisa de que el CI está en verde y el Orquestador lo comprueba                                                                                                                   |
| Fusión de la PR #10 y Traer main                                                                                                           | Orquestador  | —     | 2026-10-11 16:08:19 | 2026-10-11 16:08:23 | 0 min 4 s   | `gh pr merge 10 --merge`; el Traer main va justo detrás, en el mismo comando, sin hora propia                                                                                         |
| CI de main tras la fusión                                                                                                                  | CI           | —     | 2026-10-11 16:08:28 | 2026-10-11 16:15:15 | 6 min 47 s  | Verde (`check` y `dist:win`)                                                                                                                                                          |

### Ejecuciones

| Quién     | Comando                                                                                                                                     | Inicio              | Fin                 | Duración   | Resultado                                                                                                         | Tests (pasan / fallan / saltados)                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| developer | `npx vitest run src/renderer/src/locales/service-charts.test.ts` (tests nuevos, antes del código)                                           | 2026-10-11 14:12:28 | 2026-10-11 14:12:29 | 0 min 1 s  | Falla, como se esperaba                                                                                           | Unitarios: 3 / 2 / 0                              |
| developer | `npm run check`                                                                                                                             | 2026-10-11 14:13:09 | 2026-10-11 14:14:08 | 0 min 59 s | Verde                                                                                                             | Unitarios: 3821 / 0 / 0                           |
| developer | `npm run test:e2e:affected -- integra/20261011-7..HEAD`                                                                                     | 2026-10-11 14:14:15 | 2026-10-11 14:14:54 | 0 min 39 s | Rojo (exit=1): unitarios de textos y build bien; Playwright no llega a arrancar (`\|` del `--grep` en cmd, EPIPE) | Unitarios: 112 / 0 / 0; e2e: no corren            |
| developer | `npx playwright test --project=e2e e2e/smoke.spec.ts e2e/views-servicio.spec.ts --grep "@servicio\|@smoke"` (equivalente a mano, sin build) | 2026-10-11 14:15:09 | 2026-10-11 14:16:09 | 1 min 0 s  | Verde                                                                                                             | e2e: 61 / 0 / 0                                   |
| verifier  | `git worktree add --detach`                                                                                                                 | 2026-10-11 14:39:21 | 2026-10-11 14:39:21 | 0 min 0 s  | ok                                                                                                                | —                                                 |
| verifier  | `npm ci --ignore-scripts`                                                                                                                   | 2026-10-11 14:39:21 | 2026-10-11 14:39:35 | 0 min 14 s | ok                                                                                                                | —                                                 |
| verifier  | `npx install-electron`                                                                                                                      | 2026-10-11 14:39:35 | 2026-10-11 14:39:38 | 0 min 3 s  | ok                                                                                                                | —                                                 |
| verifier  | `npm run check`                                                                                                                             | 2026-10-11 14:39:41 | 2026-10-11 14:41:42 | 2 min 1 s  | Verde                                                                                                             | Unitarios: 3833 / 0 / 0                           |
| verifier  | `npm run test:e2e:affected -- integra/20261011-7..chore/0080-quitar-clave-graficos-servicio`                                                | 2026-10-11 14:41:47 | 2026-10-11 14:43:22 | 1 min 35 s | Verde (exit 0): solo textos, `@servicio` y `@smoke`                                                               | Unitarios de textos: 112 / 0 / 0; e2e: 61 / 0 / 0 |
| CI        | CI de la PR #10 (intento 1 rojo, intento 2 verde) y de main tras la fusión                                                                  | 2026-10-11 15:24:01 | 2026-10-11 16:15:15 | —          | Ver la ficha 0081 (el CI es el mismo)                                                                             | —                                                 |
