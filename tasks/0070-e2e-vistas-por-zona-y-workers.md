---
id: '0070'
titulo: 'e2e: partir views.spec.ts en un spec por zona (portapapeles juntos), afectados por zona y medir los workers'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067', '0069'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0070-e2e-vistas-por-zona-y-workers
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10): «partir `views.spec.ts` por zonas (los
tests del portapapeles, juntos y en serie) y medir con más workers».

## Especificación

Por qué: Playwright reparte **specs** entre workers (sin `fullyParallel`). `views.spec.ts` tiene
261 de los ~360 tests, corre en un solo worker y marca el tiempo de toda la tanda; y para
`test:e2e:affected` toda la parte de vistas es una sola área, así que tocar un fichero del servicio
lanza los 261 (ADR-0013, «Contexto»).

**1. Un spec por zona de vistas.** Con el arnés de la 0069 y las zonas de la 0067, los tests de
`views.spec.ts` se reparten en `e2e/views-<zona>.spec.ts`, uno por zona de vistas (`vistas-comun`,
`inicio`, `problemas`, `problema-detalle`, `metricas`, `entidad`, `servicio`, `host`, `proceso`,
`monitor`, `aplicacion`), y `views.spec.ts` desaparece.

- Cada spec llama a `setupViewsApp()` y `useCiWindow` como en la 0069.
- Los tests se mueven **sin cambiar títulos ni cuerpos**, en el mismo orden relativo.
- **Portapapeles:** todos los tests con `@portapapeles` van juntos a `e2e/views-portapapeles.spec.ts`
  (conservan su etiqueta de zona). Un spec corre en un solo worker y sus tests de uno en uno, así que
  no se pisan entre ellos; como ningún otro spec usa el portapapeles, no hace falta modo serie (que
  además saltaría los siguientes al primer fallo). Si el developer ve que sí hace falta, lo justifica.
- Con `--repeat-each`, solo `views-portapapeles.spec.ts` necesita `--workers=1`.

**2. Guarda ampliada** (la de la 0067): cada `views-<zona>.spec.ts` solo tiene tests de su zona; los
`@portapapeles` están todos en `views-portapapeles.spec.ts` y ese spec no tiene otros.

**3. `e2e/areas.json` por zona.** El área `views` se sustituye por un área por spec de vistas, con los
globs de su zona (por ejemplo, la página del servicio y su canal solo en `servicio`). Lo que comparten
varias zonas va en las áreas de todas ellas (por ejemplo, el código común de las páginas de entidad
en `entidad`, `servicio`, `host`, `proceso`, `monitor` y `aplicacion`). Un área cuya zona tenga tests
en `views-portapapeles.spec.ts` incluye también ese spec. La regla de siempre se mantiene: un fichero
de `src/` sin área dispara el e2e completo.

**4. Recursos propios de cada worker** (añadido por Dani al aprobar, 2026-10-10). Con más specs y
más workers, cada worker lanza su propia app y su propio simulador. Cada worker usa **su propio
puerto del simulador y su propia carpeta de datos de usuario** (`VIGIA_USER_DATA_DIR`) y de
exportación, derivados del `workerIndex` de Playwright (por ejemplo, un puerto base más el índice y
una carpeta temporal con el índice en el nombre). El cálculo es una función pura del arnés
(`workerResources(workerIndex)` o parecida) para poder probarla. Si el puerto calculado está ocupado,
el arnés falla con un mensaje claro que nombra el puerto (no prueba otro en silencio). El developer
comprueba también `tls.spec.ts` y los demás specs que levantan un servidor o una carpeta, y aplica la
misma regla si comparten algo entre workers.

**5. Medir los workers.** Con los specs ya partidos, en la VPS (22 núcleos lógicos), el e2e completo
(`npm run test:e2e:nobuild` tras un `npm run build`) **tres veces** con 4, 6 y 8 workers, y 10 si 8
mejora a 6. Se apuntan en «Verificación» la hora de inicio y fin de cada pase (`date`), la duración y
el resultado. Se queda el número más bajo de los que tienen **los tres pases en verde** y una media a
menos de un 5 % de la mejor. En el CI se mantiene 4 (`windows-latest` tiene 4 núcleos): `workers` pasa a
depender de `process.env.CI`. Medir el CI queda para cuando exista la medición automática (0074).

**Documentación:** `e2e/CLAUDE.md` (specs de vistas, portapapeles, workers), `docs/flujo.md` («Niveles
de prueba»: la línea de `views` con `--workers=1` pasa a `views-portapapeles`) y el comentario de
`playwright.config.ts`.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, amplía la guarda y añade `workerResources`.
2. No elimina nada visible para el usuario: se cumple; solo `e2e/`, `scripts/` y la configuración de
   Playwright.
3. No toca datos, API ni lógica: **no se cumple**, cambia la selección de afectados
   (`areas.json`).
4. No hay ninguna decisión que preguntar a Dani: se cumple; la regla para elegir los workers está
   escrita arriba.

## Criterios de aceptación

- CA1: `views.spec.ts` ya no existe; los títulos que da `playwright test --list` para los specs de
  vistas son los mismos 261 en `main` y en la rama (el verifier los compara con un `node -e` y deja
  el resultado en «Verificación»; la lista no se guarda en el repositorio), y todos pasan.
- CA2: la guarda pasa en el repositorio y, con specs de ejemplo, falla si un test está en el spec de
  otra zona, si un `@portapapeles` está fuera de `views-portapapeles.spec.ts` o si ese spec tiene un
  test sin `@portapapeles`.
- CA3: con `decide` (`scripts/affected-e2e.test.ts`): un cambio en un fichero de la página del
  servicio da solo `views-servicio.spec.ts` (más `smoke` y, si la zona tiene tests de portapapeles,
  `views-portapapeles.spec.ts`); uno en el código común de las páginas de entidad da las seis de
  entidad; uno en la página de Métricas, `views-metricas.spec.ts` y `views-portapapeles.spec.ts`.
- CA4: cada spec de `areas.json` existe en `e2e/` y cada `views-*.spec.ts` está en al menos un área
  (test sobre la config real).
- CA5: `playwright.config.ts` usa 4 workers con `CI` y el número medido sin él (test de `scripts/`
  que lee la config); en «Verificación», ese número tiene tres pases del e2e completo en verde.
- CA6: `workerResources` da puertos y carpetas distintos para los índices 0 a 15, siempre los mismos
  para el mismo índice, y los puertos caen en un rango válido (test unitario). Con un puerto ya
  ocupado, el arnés falla con un mensaje que nombra el puerto.
- CA7 (e2e, en `views-vistas-comun.spec.ts`): la app de ese worker usa la carpeta de datos y el
  puerto del simulador que da `workerResources(testInfo.workerIndex)`.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Medir y cambiar los workers del CI.
- `fullyParallel` dentro de un spec (cada spec lanza una app por worker; dentro de un spec se sigue
  en orden).
- `locales/` por zona (0071).

## Ideas surgidas (fuera de alcance)

- (developer) Fallo de la app, intermitente y previo a esta ficha: al abrir Inicio recién arrancada,
  con dos peticiones a la vez al mismo entorno (problemas y SLOs) y nivel de certificado «ignorar»,
  una puede salir como «Certificado no de confianza» (`TLS_UNTRUSTED`, «El certificado de
  127.0.0.1:<puerto> no es de confianza») aunque la otra entre. Lo destapa el reparto: el primer test
  de `views-inicio.spec.ts` es ahora el primero de su app y, con varios workers, falla en algunos
  pases (`kpi-open-problems` se queda en «—»). Con «Actualizar» o un `problems:list` directo un
  momento después, entra. Pide una ficha de bug en `src/main/dynatrace/network.ts` (verificación de
  certificados de Electron con dos conexiones nuevas a la vez) o en `client.ts`. No se tapa en el
  arnés.
- (developer) `splitList` vive en `pages/entities/service-info.ts` y la usan el host y el proceso
  (`host-info.ts`, `process-info.ts`, `ProcessInfo.tsx`, `ProcessGroupInfo.tsx`): por eso
  `service-info.ts` va también en las áreas `host` y `proceso`. Sacarla a un módulo común
  dejaría `service-info.ts` solo en `servicio`.
- (developer) Las dos mejoras del BACKLOG marcadas para la 0070 sobre `import * as` y alias
  (`scripts/e2e-tags.cjs` y `scripts/e2e-export-read.test.ts`) siguen pendientes: esta ficha no
  toca la detección del portapapeles ni la de las exportaciones (solo añade `checkPlacement`).

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1–CA7 con su test numerado. Tras el commit de tests solo cambian dos, sin cambiar el criterio: e57baaa (CA3 del servicio, `service-info.ts` → `ServiceMarkers.tsx`, porque `splitList` lo usan host y proceso en tiempo de ejecución) y b5b1b08 (quita `workers === 4` de «CA1 (0075)…»; los workers los prueba `scripts/playwright-workers.test.ts` y los proyectos siguen sin opciones propias). CA7 igual que en el commit de tests.
- Reparto: 249 tests de varias líneas en `main` y 250 en la rama (el de más es CA7); 12 de una línea en los dos. La comparación título a título, para el verifier. Los dos «Abrir en Métricas» pasan a `@problema-detalle` sin tocar título ni cuerpo (regla de `e2e/CLAUDE.md`), coherente con `areas.json`. `detailOnly.push` pasa a `e2e/views/fixtures.ts`.
- `areas.json` y arnés: todos los ficheros de `pages/**` y `modules/**` tienen área. `workerResources` pura (`39100 + i`, `%TEMP%\vigia-e2e-workers\w<i>`); `listenOn` nombra el puerto; el arnés abre el puerto antes de vaciar las carpetas. Sin choques con otros specs; `inicio-arranque.spec.ts` (0079) usa `setupViewsApp` sin coincidir. `checkPlacement` pura. `workers: CI ? 4 : 8`, tres pases en verde.
- Reglas: sin IPC, API, dependencias, esquema, CSP ni datos del tenant; `docs/flujo.md` y `e2e/CLAUDE.md` al día.
- Opcional: `inicio-arranque.spec.ts` también en las áreas `vistas-comun` e `inicio`; `.claude/agents/verifier.md:22` («`views` con `--workers=1`» → `views-portapapeles`); quitar `BACKLOG.md:270` (regla de «Abrir en Métricas», ya resuelta); en `e2e/views/harness.ts:563-570`, borrar las carpetas del worker antes de soltar el puerto.

## Verificación

Tests (test-writer): commit f07d39c. Contratos nuevos que fijan los tests: `checkPlacement(specs, config)` en `scripts/e2e-tags.cjs` (tipos `otra-zona`, `portapapeles-fuera` y `sin-portapapeles`), y `e2e/worker-resources.ts` con `workerResources(workerIndex)` → `{ port, userDataDir, exportDir }` y `listenOn(server, port)` (fuera de `e2e/views/` para que `tls.spec.ts` pueda usarlo sin pasar por «spec de vistas»).

- CA1: `scripts/e2e-views-harness.test.ts`, «CA1 (0070): views.spec.ts ya no existe y hay un views-<zona>.spec.ts por zona…» (los 11 de zona más `views-portapapeles.spec.ts`, ninguno más) y «CA1 (0070) y CA2 (0069): %s importa el arnés». La comparación de los 261 títulos la hace el verifier; ojo: `views-vistas-comun.spec.ts` lleva además el test de CA7, que no está en `main` (262 en la rama).
- CA2: `scripts/e2e-tags.test.ts`, «CA2 (0070): checkPlacement (la propia comprobación)» (acepta el reparto bueno; falla con un test de otra zona, propio o heredado del `describe`; reconoce el fichero sin carpeta; `@portapapeles` en el spec de su zona o en uno que no es de vistas; test sin `@portapapeles` en `views-portapapeles.spec.ts`) y «CA2 (0070): reparto de los specs reales de e2e».
- CA3: `scripts/affected-e2e.test.ts` («e2e/areas.json real»): «CA3 (0070): … página del servicio o su canal» (exacto: smoke y `views-servicio`, más el del portapapeles si `@servicio` tiene tests ahí), «… común de las páginas de entidad» (`EntityPageFrame.tsx`, exacto: las seis), «la página de Métricas» (contiene `views-metricas` y `views-portapapeles`) y «un área con tests de su zona en views-portapapeles.spec.ts incluye ese spec». En `scripts/e2e-views-harness.test.ts`, un módulo del arnés lanza todos los specs de vistas y el área `views` ya no existe. Los tests del `areas.json` real que nombraban `views.spec.ts` pasan al spec de su zona.
- CA4: `scripts/affected-e2e.test.ts`, «CA4 (0070): cada spec de areas.json existe en e2e/» y «CA4 (0070): cada views-*.spec.ts de e2e/ está en al menos un área».
- CA5: `scripts/playwright-workers.test.ts` (con `CI`, 4; sin él, 4, 6, 8 o 10; `workers` depende de `process.env.CI`). Los tres pases medidos, a cargo del developer y el verifier.
- CA6: `scripts/e2e-worker-resources.test.ts` (puertos y carpetas distintos para 0 a 15, rango 1024–65535, deterministas; `listenOn` con el puerto ocupado rechaza nombrando el puerto) y, en `scripts/e2e-views-harness.test.ts`, «CA6 (0070): el simulador del arnés escucha con listenOn y el arnés usa workerResources».
- CA7: `e2e/views-vistas-comun.spec.ts`, «CA7 (0070): la app del worker usa la carpeta de datos y el puerto del simulador de workerResources» (también la carpeta de exportación).

Developer (2026-10-10/11):

- Reparto: `views.spec.ts` (265 tests en `main`, no 261) en 11 `views-<zona>.spec.ts` y
  `views-portapapeles.spec.ts` (6 tests: 4 `@problema-detalle`, 1 `@problemas` y 1 `@errors`).
  `playwright test --list`: los mismos 265 títulos, más el de CA7 (266). Los cuerpos de los tests,
  idénticos (comparados con el compilador de TypeScript), en el mismo orden relativo. Sin modo serie.
- Regla de «Abrir en Métricas» (BACKLOG, 0067), en `e2e/CLAUDE.md`: zona de la página del botón.
  Cambian de etiqueta (no de título ni de cuerpo) dos tests de `@metricas` a `@problema-detalle`:
  «v0.9.1: «Abrir en Métricas» lleva a Métricas…» y «v0.9.2: «Abrir en Métricas» del gráfico…».
- Ayudantes que usan varios specs: `e2e/views/helpers.ts`. Los `detailOnly.push` que hacía el spec al
  cargarse (y sus constantes) pasan al final de `e2e/views/fixtures.ts`: si se quedaran en un spec,
  un worker que no lo cargue no los tendría. El comentario de «sus problemas para los recuentos»
  (BACKLOG, 0069) se rehace al moverlo (apunta a `markerProblems`).
- `areas.json`: regla escrita en `e2e/CLAUDE.md`. CA3 de Métricas: `MetricsPage.tsx` y
  `pages/metrics/**` lanzan también `views-problema-detalle` y `views-servicio`, porque sus tests de
  «Abrir en Métricas» acaban leyendo el formulario de Métricas; como `@problema-detalle` tiene tests
  en `views-portapapeles`, ese spec también. El área `errors` lanza además `views-portapapeles`
  (su test de «Copiar detalles»). Ningún fichero que antes casaba con `views` se queda sin área.
- **Test que no pasa (lo decide el Orquestador):** «CA3 (0070): …service-info.ts (página del
  servicio o su canal) → solo views-servicio…». `service-info.ts` exporta `splitList`, que usan
  en tiempo de ejecución el host y el proceso (`host-info.ts`, `process-info.ts`, `ProcessInfo.tsx`,
  `ProcessGroupInfo.tsx`): con un área honesta lanza también `views-host` y `views-proceso`. No se
  ha tocado el test.
- Workers (punto 4): `workerResources(i)` → puerto `39100 + i` y
  `%TEMP%\vigia-e2e-workers\w<i>\data y \export`, que el arnés vacía al empezar y borra al acabar;
  `listenOn` falla nombrando el puerto. `tls.spec.ts` y los demás no comparten nada entre workers
  (puerto 0 y `mkdtempSync`): sin cambios.
- Medición (punto 5), e2e completo con `npm run build` hecho y `npx playwright test --workers=N`,
  en la VPS, intercalados:

| Pase          | Inicio              | Fin                 | Duración | Resultado                                                          |
| ------------- | ------------------- | ------------------- | -------- | ------------------------------------------------------------------ |
| 4 workers, 1  | 2026-10-10 23:41:18 | 23:45:24            | 246 s    | 2 fallos (problema-detalle v0.10.0, problemas CA1 0005)            |
| 6 workers, 1  | 23:45:24            | 23:47:06            | 102 s    | 1 fallo (Inicio)                                                   |
| 8 workers, 1  | 23:47:06            | 23:48:31            | 85 s     | 1 fallo (Inicio)                                                   |
| 10 workers, 1 | 23:48:31            | 23:49:50            | 79 s     | 1 fallo (Inicio)                                                   |
| 4 workers, 2  | 23:49:50            | 23:51:53            | 123 s    | 2 fallos (Inicio, portapapeles CA8 0001)                           |
| 6 workers, 2  | 23:51:53            | 23:53:29            | 96 s     | verde                                                              |
| 8 workers, 2  | 23:53:29            | 23:54:53            | 84 s     | verde                                                              |
| 10 workers, 2 | 23:54:53            | 23:56:09            | 76 s     | verde                                                              |
| 4 workers, 3  | 23:56:09            | 2026-10-11 00:05:00 | 532 s    | 8 fallos y 27 sin ejecutar (VPS cargada: smoke con 30 s de espera) |
| 6 workers, 3  | 00:05:01            | 00:09:20            | 259 s    | 2 fallos (entidad CA1 0036, servicio CA2 0047; VPS cargada)        |
| 8 workers, 3  | 00:09:20            | 00:10:47            | 87 s     | 1 fallo (Inicio)                                                   |
| 10 workers, 3 | 00:10:47            | 00:12:18            | 91 s     | verde                                                              |

**CA5 no se cumple:** ningún número tiene sus tres pases en verde. El fallo que se repite es el
primer test de `views-inicio` (fallo de la app, en «Ideas surgidas»); los demás salen en pases en
que la VPS iba cargada por otra cosa (2-9 min por pase en vez de 1,5). Con la regla de la ficha
aplicada solo a las duraciones, 8 (media 85 s, a un 4 % de la de 10, 82 s): es el valor que queda
en `playwright.config.ts`, a la espera de arreglar el fallo y repetir los tres pases. Comprobado
también que no lo causan los puertos fijos: con el puerto 0 falla igual (3 de 8 tandas).

Developer, tras la 0079 (2026-10-11): rama rebasada sobre `main` (con la 0075, la 0079 y las
demás). Conflictos resueltos conservando las dos partes: en `scripts/e2e-tags.test.ts`, los tests
de la cuarentena (0075) y los de `checkPlacement` (0070); en `playwright.config.ts`, `QUARANTINE`
y los proyectos `e2e`/`inestables` con `workers: CI ? 4 : 8`, que los dos proyectos heredan. La
integración exige tocar un test de la 0075: «CA1 (0075): los proyectos solo cambian el filtro…»
comprobaba `workers` igual a 4; esa línea se quita (los workers los prueba
`scripts/playwright-workers.test.ts`), en un commit propio. `e2e/inicio-arranque.spec.ts` sigue
en el área `tls`. CA5, tres pases del e2e completo con 8 workers (`npm run build` una vez y
`npx playwright test --project=e2e --workers=8`):

| Pase         | Inicio              | Fin                 | Duración | Resultado          |
| ------------ | ------------------- | ------------------- | -------- | ------------------ |
| 8 workers, 1 | 2026-10-11 13:15:48 | 2026-10-11 13:17:13 | 85 s     | verde (365 de 365) |
| 8 workers, 2 | 2026-10-11 13:17:17 | 2026-10-11 13:18:45 | 88 s     | verde (365 de 365) |
| 8 workers, 3 | 2026-10-11 13:18:45 | 2026-10-11 13:20:10 | 85 s     | verde (365 de 365) |

**CA5 se cumple con 8:** los tres pases en verde y el fallo de Inicio ya no sale.

Verificación 2026-10-11, commit 02c4bfc, rango `origin/main..feat/0070-e2e-vistas-por-zona-y-workers`: **VERDE**.

- `npm run check`: 215 ficheros, 3785 tests; cobertura: líneas 93,51 %, ramas 90,06 %.
- e2e, un pase (completo por `e2e/areas.json` y `playwright.config.ts`), con 8 workers: 365 pasados en 1,4 min, sin fallos ni intermitentes.
- Títulos: `views.spec.ts` en `origin/main` tiene 265 tests; la suma de `e2e/views-*.spec.ts` de la rama, 266. La única diferencia, con las dos listas ordenadas de `--list`, es la de más: «CA7 (0070): la app del worker usa la carpeta de datos y el puerto del simulador de workerResources». Los otros 265 títulos son idénticos.
- `e2e/views.spec.ts` ya no existe; `npm run test:e2e:inestables` sale con 0.

## Resultado

Cerrada (estado `verificada`; pasa a `hecha` al integrar). Una ronda de revisión (APROBADO). Sin ADR nuevo, sin migraciones.

- Commits: tests 6556e78; guarda `checkPlacement` 22f84d7; recursos por worker 92f1101; reparto de specs 46dddc9; `areas.json` 3fa14a0; 8 workers 4975307; documentación 70d00a1; ajustes de tests e57baaa y b5b1b08.
- Ficheros principales: `e2e/views-*.spec.ts` (11 zonas y portapapeles), `e2e/views/helpers.ts`, `e2e/views/harness.ts`, `e2e/worker-resources.ts`, `e2e/areas.json`, `scripts/e2e-tags.cjs`, `playwright.config.ts`, `e2e/CLAUDE.md`.
- Workers: 8 en local y 4 con `CI`; tres pases en verde (85, 88 y 85 s).
- Opcionales del revisor: aplicados los de documentación (`.claude/agents/verifier.md`, BACKLOG); los de código, a «Mejoras anotadas» del BACKLOG.
- Hecho tras la 0079: el fallo de Inicio recién arrancada se arregló allí.

Decisión de Dani (2026-10-11): opción 1. El fallo de Inicio va en su ficha de bug, la 0079, ya
integrada en `main`; la 0070 se rebasa sobre `main` y se repiten los tres pases con 8 workers. La
ficha lleva `exclusiones: []` (también decidido por Dani).
