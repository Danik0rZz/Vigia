---
id: '0074'
titulo: 'Medición automática de los tiempos del CI con un script del repositorio'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0074-medicion-automatica-ci
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, A, «Git y CI» (aprobada por Dani el 2026-10-10): «la medición automática (los
tiempos del CI, con un script del repositorio)».

## Especificación

En la 0065 y la 0066, el Orquestador leyó a mano los tiempos del CI (inicio y fin de cada job) para
la tabla «Ejecuciones» de la ficha. Con `medir: sí` hay que hacerlo en cada ficha medida, y la
medición de control de después de este lote lo necesita.

`scripts/ci-times.mjs <run>` (`<run>` es el id del run o su URL de GitHub):

- Lee los jobs del run con la API REST de GitHub, `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`
  (documentación oficial de GitHub, «REST API endpoints for workflow jobs»; el developer comprueba
  ahí los campos antes de usarlos: nombre, estado, conclusión, inicio y fin del job y de cada paso).
  El repositorio sale de `git remote get-url origin`.
- Sin token: el repositorio es público y basta con la lectura anónima (60 peticiones por hora; una por
  medición). Si existe `GITHUB_TOKEN` en el entorno, lo usa en la cabecera, **sin escribirlo nunca en
  la salida ni en un error**. No se usa `gh` (hoy no está instalado; si la 0073 lo instala, se puede
  añadir después).
- Imprime filas Markdown para la tabla «Ejecuciones» de `docs/flujo.md` («Medición del flujo»): una
  por job y, debajo, una por paso, con inicio y fin en hora local `AAAA-MM-DD HH:MM:SS`, duración
  (`13 min 45 s`), resultado y «no se cuentan» en la columna de tests. Más una línea de total del run
  (del inicio del primer job al fin del último).
- Nunca descarga ni copia logs.
- La transformación (JSON de la API → filas) es una función pura con sus tests y fixtures de ejemplo
  (inventados, sin datos reales de runs). La llamada de red va aparte y no se prueba contra GitHub
  en `check`.
- Errores claros: run inexistente (404), límite de peticiones (403 o 429 con su mensaje) o sin red,
  con código de salida distinto de 0.

**Documentación:** `docs/flujo.md` («Medición del flujo»: los tiempos del CI salen de
`node scripts/ci-times.mjs <run>`), `.claude/commands/tarea.md` y el agente doc-writer, si hablan de
leer el CI a mano.

## Carril

Normal (`ligera: no`). Usa un servicio externo (la API de GitHub), ya no entra.

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade el script y su cálculo
   de duraciones.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, añade lógica (de herramienta).
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: con un JSON de ejemplo de dos jobs con pasos, salen las filas de cada job y de cada paso con
  inicio, fin y duración en hora local y el formato de la tabla, y la línea de total.
- CA2: un job o paso sin fin (en curso) o saltado sale como tal, sin duración inventada.
- CA3: `<run>` se acepta como número o como URL de un run, y otra cosa da error de uso.
- CA4: con `GITHUB_TOKEN` en el entorno, la petición lo lleva; ningún mensaje de error ni de salida
  contiene el token (test con un token de mentira y una respuesta de error simulada).
- CA5: 404, 403/429 y fallo de red dan un mensaje claro y código de salida distinto de 0.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Escribir las filas en la ficha automáticamente (las pega el doc-writer).
- Medir el flujo local de los agentes.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1–CA5 con su `describe` numerado en `scripts/ci-times.test.ts` (31 tests, sin tocar desde ac7d8fd): horas en Europe/Madrid, duraciones, total, filas en curso y saltadas, argumentos rechazados sin `fetch`, token solo en `Authorization` y nunca en stdout/stderr (también con 401, 403, 404, 429, 500 y fallo de red).
- API de GitHub: `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` con `per_page` (máx. 100), `total_count`, `jobs[]` (`name`, `status`, `conclusion`, `started_at`, `completed_at`, `steps[]`), cabeceras `Accept`, `X-GitHub-Api-Version: 2022-11-28` y `x-ratelimit-*`: todo documentado. Sin logs.
- Token: solo en `Authorization: Bearer`; toda salida pasa por `redact`; ninguna excepción sin capturar; el error de remoto no imprime la URL. Fixtures inventados, sin datos del tenant.
- Reglas: sin dependencias; `scripts/**` ya en `e2e/areas.json`; el cambio de `tarea.md` está dentro del alcance («Documentación») y no quita reglas.
- Opcional: partir `tarea.md:150` (más de 100 columnas); en `totalRow`, un job sin `started_at` y no completado debería dejar el total «en curso»; las decisiones del developer que la ficha dice anotadas en la cabecera del script no están todas.

## Verificación

Tests escritos en `ac7d8fd` (`scripts/ci-times.test.ts`, 31 tests; fallan todos porque aún no
existe `scripts/ci-times.mjs`). Contrato fijado en la cabecera del test: `buildRows(respuesta)`
pura (texto Markdown), `parseRunArg(arg)` (id o lanza) y `main(argv, deps)` con
`deps = { env, fetchImpl, remoteUrl(), stdout, stderr }`.

- CA1: `CA1 (0074): filas de cada job y de cada paso, en hora local, y el total` (orden, 7 columnas,
  horas de Madrid, duraciones, resultado y total).
- CA2: `CA2 (0074): lo que está en curso o saltado sale como tal, sin duración inventada`.
- CA3: `CA3 (0074): <run> como número o URL del run; otra cosa es un error de uso` (incluye la URL
  pedida a `api.github.com` con el repositorio de origin).
- CA4: `CA4 (0074): GITHUB_TOKEN va en la petición y nunca en la salida`.
- CA5: `CA5 (0074): 404, 403/429 y sin red dan un mensaje claro y código distinto de 0`.

Decisiones del developer (anotadas también en la cabecera de `scripts/ci-times.mjs`): código de
salida 2 para el error de uso y 1 para el resto; una sola petición con `per_page=100` (si el run
tuviera más jobs, avisa por stderr); los jobs saltados no cuentan para el total; el repositorio
siempre es el de origin, aunque la URL del run diga otro; `403` cuenta como límite si
`x-ratelimit-remaining` es `0` o el mensaje habla de «rate limit».

Verificación 2026-10-11, commit 2d24cc5, rango `main..feat/0074-medicion-automatica-ci`: **VERDE**.

- `npm run check`: 208 ficheros, 3657 tests; cobertura: líneas 93,43 %, ramas 89,98 %, funciones 89,84 %, sentencias 92,68 %.
- `npm run test:e2e:affected`: «solo docs o tests unitarios; no hace falta ningún e2e» (cero e2e).
- Prueba con un run real (`node scripts/ci-times.mjs 38094741692`, sin token): tabla con `cambios`, `windows` (6 min 26 s), `CI ok` y sus pasos, con inicio, fin, duración y estado; los saltados con «—». Ningún token impreso.

## Resultado

- Commits: `ac7d8fd` (tests), `8acf3d1` (script), `540156e` (documentación del flujo), más los de ficha.
- Ficheros principales: `scripts/ci-times.mjs`, `scripts/ci-times.test.ts` (31 tests), `docs/flujo.md`, `.claude/commands/tarea.md`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Sin migraciones.
- Corregido en el cierre: línea de `tarea.md` de más de 100 columnas. Los otros opcionales del revisor (total «en curso» con un job sin `started_at`, decisiones en la cabecera) pasan a «Mejoras anotadas» del BACKLOG.
