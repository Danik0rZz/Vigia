---
id: '0074'
titulo: 'Medición automática de los tiempos del CI con un script del repositorio'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0074-medicion-automatica-ci
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
