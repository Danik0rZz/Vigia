---
id: '0081'
titulo: 'Marcadores del servicio: un solo aviso (role="alert") cuando fallan las métricas (con medición del flujo)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

- Decisión del Orquestador (2026-10-11, no cambia el criterio): con «Solo actividad» solo hay una tarjeta de métricas («Peticiones»), así que el test de CA2 ya pasa hoy y queda como guarda de que no se rompa. Con el canal caído desde el principio la página no sabe el conjunto (viene en la respuesta de métricas); el test lo prueba fallando al «Actualizar».

- Los marcadores de las otras páginas (host, proceso, grupo de procesos, monitores, aplicación y
  disco), que tienen el mismo patrón: si el resultado convence, otra ficha.
- Los avisos de los cuatro gráficos del servicio, que también llevan su `role="alert"` cada uno.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1, CA2 y CA3 son e2e `@servicio` en `e2e/views-servicio.spec.ts`; CA4, unitario en `EntityMarkers.test.ts` (`MarkerError` y `QueryState` con y sin `silent`). CA1, CA3 y los casos de CA4 con `silent` fallaban sin el código (5 y 6 alertas). Tests sin tocar desde c4ac3e3. CA2 vale como guarda: con «Solo actividad» solo existe «Peticiones», y el test fallaría si alguien le pusiera `silent` o volviera a pintar las cinco tarjetas.
- Lo que se ve no cambia: el único cambio de salida es `role={silent ? undefined : 'alert'}` (`EntityMarkers.tsx:140`). En `ServiceMarkers.tsx`, `silent` solo en OK, KO, Tasa de error y Tiempo de respuesta; sin él, «SLO», «Peticiones» con Solo actividad y «Problemas».
- Resto de páginas: `silent` vale `false` por defecto y solo lo usa `ServiceMarkers.tsx`; host, proceso, grupo de procesos, monitores, aplicación y disco siguen con su `role="alert"`.
- Accesibilidad: un anuncio por canal fallido; «Reintentar» de una tarjeta muda repite la consulta y el aviso de «SLO» que vuelve se anuncia otra vez. Sin IPC, API, dependencias, esquema, textos nuevos ni datos del tenant.
- Opcional (doc-writer): en `src/renderer/CLAUDE.md`, la excepción del `role="alert"` con `silent` (ficha 0081).

## Verificación

Tests escritos en el commit c4ac3e3 (test-writer, ronda 1):

- CA1: e2e `CA1 (0081): con el canal de métricas caído, un solo role="alert" en los marcadores, en «SLO», y las cinco tarjetas con su aviso y Reintentar` (`e2e/views-servicio.spec.ts`, `@servicio`). Falla hoy: 5 avisos anunciados.
- CA2: e2e `CA2 (0081): Solo actividad con el canal de métricas caído: un solo role="alert", en «Peticiones»` (mismo spec). El conjunto lo devuelve el propio canal de métricas (`metricSet`): con el canal caído desde el principio la página no sabe que es «Solo actividad» y pinta las cinco tarjetas; el test carga bien y hace fallar el canal al pulsar «Actualizar». Pasa ya hoy (con «Solo actividad» solo hay una tarjeta de métricas): queda como guarda.
- CA3: e2e `CA3 (0081): con los canales de métricas y de problemas caídos, dos role="alert": «SLO» y «Problemas»` (mismo spec). Falla hoy: 6.
- CA4: unitario `src/renderer/src/pages/entities/EntityMarkers.test.ts`, `describe` `CA4 (0081)`: `MarkerError` y `QueryState` sin la propiedad, con `role="alert"`; con `silent: true`, sin `role`, con el texto y «Reintentar». El nombre de la propiedad (`silent`) lo fija el test; fallan hoy los dos casos con `silent` (y `tsc` hasta que exista).

Código (developer, ronda 1): `silent` opcional en `MarkerError` (quita el `role`) y en `QueryState` (lo pasa); en `ServiceMarkers.tsx`, «OK», «KO», «Tasa de error» y «Tiempo de respuesta» van con `silent`; «SLO», «Peticiones» (Solo actividad) y «Problemas», sin él. No había e2e anteriores que esperasen un `role="alert"` en cada tarjeta de métricas: no se adapta ninguno.

Verificación 2026-10-11, commit 22f38b3, rango `integra/20261011-7..fix/0081-marcadores-servicio-un-aviso`: **VERDE**.

- `npm run check`: 219 ficheros, 3837 tests; cobertura: sentencias 92,74 %, ramas 90,06 %, funciones 89,83 %, líneas 93,51 %.
- `npm run test:e2e:affected`, un pase: 183 pasados, 0 fallos (specs de servicio, host, proceso y demás de entidad).

## Resultado

Totales (con el CI y la fusión de la PR #10, compartidos con la 0080):

- Reloj desde la aprobación (12:45:43) hasta el commit del doc-writer (15:05:09): 139 min 26 s. Sin la espera de la cola (119 min 18 s): 20 min 8 s.
- Tiempo por agente: Planificador 0 min 43 s (aprobación), test-writer 4 min 50 s, developer 5 min 48 s, reviewer 0 min 18 s, verifier 4 min 14 s, doc-writer 0 min 52 s, Orquestador 3 min 19 s (rama, arranques, vueltas y commits). La redacción del lote (8 min 27 s) y la espera de Dani (8 min 2 s) son anteriores a la aprobación y no cuentan.
- Reloj desde la aprobación (12:45:43) hasta el CI de main en verde (16:15:15): 209 min 32 s. Sin la cola (119 min 18 s en la cola y 17 min 23 s esperando a la 0084): 72 min 51 s; sin además la espera del relanzamiento (24 min 5 s, el token no puede relanzar jobs): 48 min 46 s. Del push de la integración al CI de main en verde (15:23:50 a 16:15:15): 51 min 25 s, con el mismo reparto que en la 0080.
- Ejecuciones: 14 (test-writer 4, developer 6, verifier 4). Tests: 3837 unitarios del check del verifier, todos en verde; e2e afectados 183 en verde, 0 fallos.
- Commits de la rama: tests (c4ac3e3), código (355c321) y fichas; revisión: 1 ronda, APROBADO. Ficheros principales: `src/renderer/src/pages/entities/EntityMarkers.tsx`, `ServiceMarkers.tsx`, `EntityMarkers.test.ts` y `e2e/views-servicio.spec.ts`. Sin ADR nuevo ni migraciones.

## Medición del flujo

Horas en local (Europa/Madrid, +02:00). Duración en minutos y segundos.

### Pasos

| Paso                                                                                  | Agente       | Ronda | Inicio              | Fin                 | Duración     | Notas                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------ | ----- | ------------------- | ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redacción del lote de seis fichas (0080 a 0085)                                       | Planificador | —     | 2026-10-11 12:29:14 | 2026-10-11 12:37:41 | 8 min 27 s   | La misma fila que en la 0080: es una sola redacción                                                                                                                |
| Espera de la aprobación de Dani                                                       | Dani         | —     | 2026-10-11 12:37:41 | 2026-10-11 12:45:43 | 8 min 2 s    | Desde la presentación del lote (con dos preguntas, de la 0081 y la 0085) hasta su respuesta; incluye leerla                                                        |
| Aprobación del lote, decisiones en las fichas, BACKLOG, commit y envío al Orquestador | Planificador | —     | 2026-10-11 12:45:43 | 2026-10-11 12:46:26 | 0 min 43 s   | Las seis fichas del lote, hasta antes de prettier y del commit; el commit y el SendMessage tardan unos segundos más                                                |
| Espera en la cola (delante, 0079, 0070, 0071 con su arreglo y 0080)                   | Cola         | —     | 2026-10-11 12:46:26 | 2026-10-11 14:45:44 | 119 min 18 s | Desde el envío de la cola del Planificador hasta que el Orquestador empieza la 0081                                                                                |
| Rama de la ficha desde la integración en curso                                        | Orquestador  | —     | 2026-10-11 14:45:44 | 2026-10-11 14:45:51 | 0 min 7 s    | `git switch -c` desde `integra/20261011-7` y `date` antes de lanzar                                                                                                |
| Arranque del test-writer                                                              | Orquestador  | 1     | 2026-10-11 14:45:51 | 2026-10-11 14:45:55 | 0 min 4 s    | Hora del Orquestador al lanzarlo frente al primer comando del test-writer                                                                                          |
| Tests de los criterios                                                                | test-writer  | 1     | 2026-10-11 14:45:55 | 2026-10-11 14:50:45 | 4 min 50 s   | CA2 no se puede reproducir con el canal caído desde el principio (el conjunto viene en la respuesta de métricas); se prueba fallando al «Actualizar» y pasa ya hoy |
| Vuelta del test-writer y decisión sobre CA2                                           | Orquestador  | 1     | 2026-10-11 14:50:45 | 2026-10-11 14:51:38 | 0 min 53 s   | Último `date` del test-writer frente a la recepción de su respuesta                                                                                                |
| Commit de la medición del test-writer y la nota de CA2                                | Orquestador  | 1     | 2026-10-11 14:51:38 | 2026-10-11 14:51:51 | 0 min 13 s   | Incluye el hook de prettier                                                                                                                                        |
| Arranque del developer                                                                | Orquestador  | 1     | 2026-10-11 14:51:51 | 2026-10-11 14:51:56 | 0 min 5 s    | Hora del Orquestador al lanzarlo frente al primer comando del developer                                                                                            |
| Desarrollo (código, check, e2e de la ficha y afectados)                               | developer    | 1     | 2026-10-11 14:51:56 | 2026-10-11 14:57:44 | 5 min 48 s   | Cambio pequeño en EntityMarkers y ServiceMarkers; el primer check falló por el formato de la ficha, que dejó sin prettier el Orquestador                           |
| Vuelta del developer                                                                  | Orquestador  | 1     | 2026-10-11 14:57:44 | 2026-10-11 14:58:11 | 0 min 27 s   | Último `date` del developer frente a la recepción de su respuesta                                                                                                  |
| Commit de la medición del developer                                                   | Orquestador  | 1     | 2026-10-11 14:58:11 | 2026-10-11 14:58:23 | 0 min 12 s   | Incluye el hook de prettier                                                                                                                                        |
| Arranque del reviewer                                                                 | Orquestador  | 1     | 2026-10-11 14:58:23 | 2026-10-11 14:58:27 | 0 min 4 s    | Hora del Orquestador al lanzarlo frente al primer comando del reviewer                                                                                             |
| Revisión del código                                                                   | reviewer     | 1     | 2026-10-11 14:58:27 | 2026-10-11 14:58:45 | 0 min 18 s   | Aprobado sin cambios; CA2 se da por bueno como guarda; solo lecturas de git                                                                                        |
| Vuelta del reviewer, notas en la ficha y commit                                       | Orquestador  | 1     | 2026-10-11 14:58:45 | 2026-10-11 14:59:13 | 0 min 28 s   | Incluye el hook de prettier                                                                                                                                        |
| Arranque del verifier                                                                 | Orquestador  | 1     | 2026-10-11 14:59:15 | 2026-10-11 14:59:27 | 0 min 12 s   | Hora del Orquestador al lanzarlo frente al primer comando del verifier                                                                                             |
| Verificación (worktree, npm ci, install-electron, check, e2e afectados)               | verifier     | 1     | 2026-10-11 14:59:27 | 2026-10-11 15:03:41 | 4 min 14 s   | Un solo pase; limpieza del worktree con un rodeo por ruta larga. VERDE                                                                                             |
| Vuelta del verifier, notas y medición, commit                                         | Orquestador  | 1     | 2026-10-11 15:03:41 | 2026-10-11 15:04:01 | 0 min 20 s   | Incluye el hook de prettier                                                                                                                                        |
| Arranque del doc-writer                                                               | Orquestador  | 1     | 2026-10-11 15:04:03 | 2026-10-11 15:04:17 | 0 min 14 s   | Hora del Orquestador al lanzarlo frente al primer comando del doc-writer                                                                                           |
| Cierre: CHANGELOG, BACKLOG, CLAUDE.md del renderer, ficha y commit                    | doc-writer   | 1     | 2026-10-11 15:04:17 | 2026-10-11 15:05:09 | 0 min 52 s   | Sin ADR ni migraciones; ideas nuevas: una mejora anotada (avisos de las otras páginas y de los gráficos)                                                           |
| Integración: merge --squash en integra/20261011-7, commit y push                      | Orquestador  | —     | 2026-10-11 15:05:36 | 2026-10-11 15:06:27 | 0 min 51 s   | Push sin CI                                                                                                                                                        |
| Espera de la 0084 para completar el grupo de cinco                                    | Cola         | —     | 2026-10-11 15:06:27 | 2026-10-11 15:23:50 | 17 min 23 s  | La PR se abre al llegar a cinco fichas                                                                                                                             |
| Push de la integración y PR #10                                                       | Orquestador  | —     | 2026-10-11 15:23:50 | 2026-10-11 15:23:55 | 0 min 5 s    | Sin esperar al CI                                                                                                                                                  |
| CI de la PR #10, intento 1 (falla un e2e de views-problema-detalle)                   | CI           | —     | 2026-10-11 15:24:01 | 2026-10-11 15:34:03 | 10 min 2 s   | Sospechoso de inestable, anotado en el BACKLOG                                                                                                                     |
| Espera de Dani para relanzar el job (el token no puede)                               | Dani         | —     | 2026-10-11 15:34:31 | 2026-10-11 15:58:36 | 24 min 5 s   | El token de `gh` no puede relanzar jobs (HTTP 403)                                                                                                                 |
| CI de la PR #10, intento 2                                                            | CI           | —     | 2026-10-11 15:58:36 | 2026-10-11 16:06:44 | 8 min 8 s    | Verde                                                                                                                                                              |
| Aviso de Dani y comprobación del Orquestador                                          | Orquestador  | —     | 2026-10-11 16:06:44 | 2026-10-11 16:08:19 | 1 min 35 s   | Dani avisa de que el CI está en verde y el Orquestador lo comprueba                                                                                                |
| Fusión de la PR #10 y Traer main                                                      | Orquestador  | —     | 2026-10-11 16:08:19 | 2026-10-11 16:08:23 | 0 min 4 s    | `gh pr merge 10 --merge`; el Traer main va justo detrás, en el mismo comando, sin hora propia                                                                      |
| CI de main tras la fusión                                                             | CI           | —     | 2026-10-11 16:08:28 | 2026-10-11 16:15:15 | 6 min 47 s   | Verde (`check` y `dist:win`)                                                                                                                                       |

### Ejecuciones

| Quién       | Comando                                                                                  | Inicio              | Fin                 | Duración    | Resultado                                                                                       | Tests (pasan / fallan / saltados) |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------- | ------------------- | ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| test-writer | `npx vitest run EntityMarkers.test.ts`                                                   | 2026-10-11 14:47:06 | 2026-10-11 14:47:08 | 0 min 2 s   | Falla lo esperado                                                                               | Unitarios: 2 / 2 / 0              |
| test-writer | `npm run test:e2e -- views-servicio.spec.ts --grep 0081`                                 | 2026-10-11 14:47:11 | 2026-10-11 14:48:12 | 1 min 1 s   | Falla (CA2 por un error del test: con el canal caído desde el principio no se sabe el conjunto) | e2e: 0 / 3 / 0                    |
| test-writer | `npm run test:e2e:nobuild -- views-servicio.spec.ts --grep 0081`                         | 2026-10-11 14:48:53 | 2026-10-11 14:49:09 | 0 min 16 s  | Falla lo esperado (CA1 y CA3); CA2 pasa                                                         | e2e: 1 / 2 / 0                    |
| test-writer | `npx vitest run EntityMarkers.test.ts`                                                   | 2026-10-11 14:50:11 | 2026-10-11 14:50:12 | 0 min 1 s   | Falla lo esperado (tras el ajuste de lint)                                                      | Unitarios: 2 / 2 / 0              |
| developer   | `npx vitest run EntityMarkers.test.ts`                                                   | 2026-10-11 14:52:41 | 2026-10-11 14:52:42 | 0 min 1 s   | Pasa                                                                                            | Unitarios: 4 / 0 / 0              |
| developer   | pre-commit del commit de código (unitarios relacionados)                                 | —                   | 2026-10-11 14:53:38 | —           | Pasa                                                                                            | Unitarios: 46 / 0 / 0             |
| developer   | `npm run build`                                                                          | 2026-10-11 14:53:42 | 2026-10-11 14:54:21 | 0 min 39 s  | Compila                                                                                         | —                                 |
| developer   | `npm run test:e2e:nobuild -- views-servicio.spec.ts -g "(0081)"`                         | 2026-10-11 14:54:28 | 2026-10-11 14:54:32 | 0 min 4 s   | Pasa                                                                                            | e2e: 3 / 0 / 0                    |
| developer   | `npm run check`                                                                          | 2026-10-11 14:54:38 | 2026-10-11 14:55:07 | 0 min 29 s  | Falla en format:check (la ficha sin prettier); no llega a los unitarios                         | —                                 |
| developer   | `npm run check`                                                                          | 2026-10-11 14:55:32 | 2026-10-11 14:56:32 | 1 min 0 s   | Pasa                                                                                            | Unitarios: 3837 / 0 / 0           |
| developer   | `npm run test:e2e:affected -- integra/20261011-7..HEAD --no-build`                       | 2026-10-11 14:56:39 | 2026-10-11 14:57:39 | 1 min 0 s   | Pasa (7 specs, zonas entidad y servicio)                                                        | e2e: 183 / 0 / 0                  |
| verifier    | `npm ci --ignore-scripts`                                                                | 2026-10-11 14:59:27 | 2026-10-11 14:59:41 | 0 min 14 s  | ok                                                                                              | —                                 |
| verifier    | `npx install-electron`                                                                   | 2026-10-11 14:59:41 | 2026-10-11 14:59:44 | 0 min 3 s   | ok                                                                                              | —                                 |
| verifier    | `npm run check`                                                                          | 2026-10-11 14:59:47 | 2026-10-11 15:01:54 | 2 min 7 s   | Verde                                                                                           | Unitarios: 3837 / 0 / 0           |
| verifier    | `npm run test:e2e:affected -- integra/20261011-7..fix/0081-marcadores-servicio-un-aviso` | 2026-10-11 15:01:58 | 2026-10-11 15:03:25 | 1 min 27 s  | Verde (59,6 s de Playwright más la compilación)                                                 | e2e: 183 / 0 / 0                  |
| CI          | run de la PR #10, intento 1 (falla un e2e de views-problema-detalle)                     | 2026-10-11 15:24:01 | 2026-10-11 15:34:03 | 10 min 2 s  | Rojo                                                                                            | no medidos por pasos              |
| CI          | job `windows`                                                                            | 2026-10-11 15:58:36 | 2026-10-11 16:06:36 | 8 min 0 s   | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Set up job                                                                             | 2026-10-11 15:58:37 | 2026-10-11 15:58:39 | 2 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                          | 2026-10-11 15:58:39 | 2026-10-11 15:58:45 | 6 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                        | 2026-10-11 15:58:45 | 2026-10-11 15:59:12 | 27 s        | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npm ci --ignore-scripts                                                            | 2026-10-11 15:59:12 | 2026-10-11 15:59:37 | 25 s        | ok                                                                                              | no se cuentan                     |
| CI          | ↳ npm audit (producción)                                                                 | 2026-10-11 15:59:37 | 2026-10-11 15:59:38 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ npm audit (desarrollo)                                                                 | 2026-10-11 15:59:38 | 2026-10-11 15:59:39 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Caché de Electron                                                                      | 2026-10-11 15:59:39 | 2026-10-11 15:59:42 | 3 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npx install-electron                                                               | 2026-10-11 15:59:42 | 2026-10-11 15:59:46 | 4 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npm run check                                                                      | 2026-10-11 15:59:46 | 2026-10-11 16:02:24 | 2 min 38 s  | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npm run test:e2e                                                                   | 2026-10-11 16:02:24 | 2026-10-11 16:06:30 | 4 min 6 s   | ok                                                                                              | no se cuentan                     |
| CI          | ↳ e2e en cuarentena (no bloquea)                                                         | 2026-10-11 16:06:30 | 2026-10-11 16:06:32 | 2 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Artefactos de e2e fallidos                                                             | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ Run npm run dist:win                                                                   | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ Post Caché de Electron                                                                 | 2026-10-11 16:06:32 | 2026-10-11 16:06:33 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                   | 2026-10-11 16:06:33 | 2026-10-11 16:06:33 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                     | 2026-10-11 16:06:33 | 2026-10-11 16:06:35 | 2 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Complete job                                                                           | 2026-10-11 16:06:35 | 2026-10-11 16:06:35 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | job `cambios`                                                                            | 2026-10-11 15:24:01 | 2026-10-11 15:24:08 | 7 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Set up job                                                                             | 2026-10-11 15:24:02 | 2026-10-11 15:24:03 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                          | 2026-10-11 15:24:03 | 2026-10-11 15:24:04 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                        | 2026-10-11 15:24:04 | 2026-10-11 15:24:04 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ ¿Trae código?                                                                          | 2026-10-11 15:24:04 | 2026-10-11 15:24:04 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                   | 2026-10-11 15:24:04 | 2026-10-11 15:24:04 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                     | 2026-10-11 15:24:04 | 2026-10-11 15:24:05 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Complete job                                                                           | 2026-10-11 15:24:05 | 2026-10-11 15:24:05 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | job `CI ok`                                                                              | 2026-10-11 16:06:40 | 2026-10-11 16:06:44 | 4 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Set up job                                                                             | 2026-10-11 16:06:41 | 2026-10-11 16:06:41 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Algún job falló o se canceló                                                           | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ Run echo "cambios success, windows success"                                            | 2026-10-11 16:06:41 | 2026-10-11 16:06:41 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Complete job                                                                           | 2026-10-11 16:06:41 | 2026-10-11 16:06:41 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | **total del run**                                                                        | 2026-10-11 15:24:01 | 2026-10-11 16:06:44 | 42 min 43 s | ok                                                                                              | no se cuentan                     |
| CI          | job `cambios`                                                                            | 2026-10-11 16:08:28 | 2026-10-11 16:08:33 | 5 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Set up job                                                                             | 2026-10-11 16:08:28 | 2026-10-11 16:08:29 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                          | 2026-10-11 16:08:29 | 2026-10-11 16:08:30 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                        | 2026-10-11 16:08:30 | 2026-10-11 16:08:31 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ ¿Trae código?                                                                          | 2026-10-11 16:08:31 | 2026-10-11 16:08:31 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                   | 2026-10-11 16:08:31 | 2026-10-11 16:08:31 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                     | 2026-10-11 16:08:31 | 2026-10-11 16:08:31 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Complete job                                                                           | 2026-10-11 16:08:31 | 2026-10-11 16:08:31 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | job `windows`                                                                            | 2026-10-11 16:08:35 | 2026-10-11 16:15:10 | 6 min 35 s  | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Set up job                                                                             | 2026-10-11 16:08:36 | 2026-10-11 16:08:37 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                          | 2026-10-11 16:08:37 | 2026-10-11 16:08:43 | 6 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                        | 2026-10-11 16:08:43 | 2026-10-11 16:08:54 | 11 s        | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npm ci --ignore-scripts                                                            | 2026-10-11 16:08:54 | 2026-10-11 16:09:21 | 27 s        | ok                                                                                              | no se cuentan                     |
| CI          | ↳ npm audit (producción)                                                                 | 2026-10-11 16:09:21 | 2026-10-11 16:09:22 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ npm audit (desarrollo)                                                                 | 2026-10-11 16:09:22 | 2026-10-11 16:09:24 | 2 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Caché de Electron                                                                      | 2026-10-11 16:09:24 | 2026-10-11 16:09:26 | 2 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npx install-electron                                                               | 2026-10-11 16:09:26 | 2026-10-11 16:09:30 | 4 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npm run check                                                                      | 2026-10-11 16:09:30 | 2026-10-11 16:12:32 | 3 min 2 s   | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Run npm run test:e2e                                                                   | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ e2e en cuarentena (no bloquea)                                                         | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ Artefactos de e2e fallidos                                                             | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ Run npm run dist:win                                                                   | 2026-10-11 16:12:32 | 2026-10-11 16:15:06 | 2 min 34 s  | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Caché de Electron                                                                 | 2026-10-11 16:15:06 | 2026-10-11 16:15:06 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1                   | 2026-10-11 16:15:06 | 2026-10-11 16:15:06 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                     | 2026-10-11 16:15:06 | 2026-10-11 16:15:09 | 3 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Complete job                                                                           | 2026-10-11 16:15:09 | 2026-10-11 16:15:09 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | job `CI ok`                                                                              | 2026-10-11 16:15:13 | 2026-10-11 16:15:15 | 2 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Set up job                                                                             | 2026-10-11 16:15:13 | 2026-10-11 16:15:13 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Algún job falló o se canceló                                                           | —                   | —                   | —           | saltado                                                                                         | no se cuentan                     |
| CI          | ↳ Run echo "cambios success, windows success"                                            | 2026-10-11 16:15:13 | 2026-10-11 16:15:14 | 1 s         | ok                                                                                              | no se cuentan                     |
| CI          | ↳ Complete job                                                                           | 2026-10-11 16:15:14 | 2026-10-11 16:15:14 | 0 s         | ok                                                                                              | no se cuentan                     |
| CI          | **total del run**                                                                        | 2026-10-11 16:08:28 | 2026-10-11 16:15:15 | 6 min 47 s  | ok                                                                                              | no se cuentan                     |
