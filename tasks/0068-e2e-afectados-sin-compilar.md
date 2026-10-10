---
id: '0068'
titulo: 'test:e2e:affected: opción de no compilar y de pasar -g y --last-failed a Playwright'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0068-e2e-afectados-sin-compilar
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10): «`test:e2e:affected` con opción de no
compilar y de pasar `-g` y `--last-failed`».

## Especificación

Hoy `scripts/affected-e2e.cjs` compila siempre (`electron-vite build`) y lanza Playwright con los
specs elegidos, sin más opciones. El developer, que ya ha compilado, paga otra compilación en cada
pase, y no puede limitarse a los tests de su ficha ni a los que fallaron.

Opciones nuevas, en cualquier orden respecto al rango (que sigue siendo el único argumento
posicional, `origin/main..HEAD` por defecto):

- `--no-build`: no compila. Si `out/` no existe, sale con código 2 y un mensaje claro («falta
  `out/`: compila con `npm run build` o quita `--no-build`»), sin lanzar Playwright. No se comprueba
  si `out/` está al día (los e2e corren sobre `out/`, ADR-0006; es responsabilidad de quien lo
  usa, y lo dice el mensaje de ayuda).
- `-g <patrón>` y `--grep <patrón>`: se pasan a Playwright tal cual, después de los specs.
- `--last-failed`: se pasa a Playwright.
- `--help`: imprime el uso y sale con 0.
- Cualquier otra opción que empiece por `-`: error con el uso y código 2, sin compilar ni lanzar
  nada (que una errata no lance la tanda entera sin filtro).

Si la decisión es «ninguno» (solo docs o tests unitarios), no se lanza nada aunque haya `-g`, como
hoy.

Diseño: la lectura de argumentos (`parseArgs`) y el plan de comandos (`plan(decision, options,
{ outExists })`, que devuelve la lista de comandos a ejecutar) son funciones puras exportadas y
probadas en `scripts/affected-e2e.test.ts`, como `decide`. `main()` solo las encadena.

Documentación: uso en la cabecera del script, el README (comandos), la tabla de comandos de
`CLAUDE.md` y `docs/flujo.md` («Niveles de prueba»: el developer usa
`npm run test:e2e:affected -- main..HEAD --no-build -g "(NNNN)"` mientras itera).

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade `parseArgs` y
   `plan`.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia la lógica del script de afectados.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: sin opciones, el plan es el de hoy: compilar y lanzar Playwright con los specs decididos (o
  sin specs si es el e2e completo).
- CA2: con `--no-build` y `out/` presente, el plan no compila; sin `out/`, sale con código 2 y el
  mensaje, sin ningún comando.
- CA3: `-g "(0070)"`, `--grep "(0070)"` y `--last-failed` llegan a Playwright después de los specs,
  y el rango se lee igual esté antes o después de las opciones.
- CA4: una opción desconocida (por ejemplo `--no-buidl`) da el uso y código 2, sin compilar ni lanzar
  Playwright; `--help` da el uso y código 0.
- CA5: con la decisión «ninguno», el plan está vacío aunque lleguen `-g` o `--last-failed`.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Detectar si `out/` está desactualizado.
- `locales/` por zona (0071).

## Ideas surgidas (fuera de alcance)

(ninguna; los dos opcionales del reviewer están en «Mejoras anotadas»)

## Notas del revisor

### Ronda 1: APROBADO

- CA1 a CA5 con su `describe('CAn (0068)…')` en `scripts/affected-e2e.test.ts`; fallaban sin
  `parseArgs`/`plan` y no se tocaron tras `080ad50`. El CA4 lanza el script real.
- `parseArgs` y `plan` puras y exportadas; `main()` solo las encadena. Con «ninguno» se sale antes
  del plan. `scripts/**` está en `ignore` de `e2e/areas.json`.
- Documentación (cabecera, README, `docs/flujo.md` y la tabla de comandos de `CLAUDE.md`, que la
  ficha pide expresamente).
- Decisiones del developer, sin `[ALCANCE]`: el rango es el único posicional y un segundo sale con
  2; `-g`/`--grep` sin patrón sale con 2; `--help` gana a cualquier otra opción; `--no-build` sin
  `out/` sale con 2 (CA2); `parseArgs` va antes de leer git (CA4).

Opcional:

1. `-g` toma como patrón el siguiente argumento aunque empiece por `-` (`-g --no-build` filtra por
   «--no-build» y compila): rechazarlo con el mismo `usageError`.
2. `--grep=(0070)`, que Playwright acepta, sale como opción desconocida con 2: fallo seguro; si se
   quiere admitir, ficha aparte.

## Verificación

Tests escritos en `080ad50` (`scripts/affected-e2e.test.ts`), fallan porque `parseArgs` y `plan`
aún no existen. Contrato que fijan: `parseArgs(argv)` devuelve las opciones con `range`, o
`{ exit, message }` para `--help` (0) y opciones desconocidas (2); `plan(decision, options,
{ outExists })` devuelve `{ commands: [{ command: 'npx', args }], exit?, message? }`.

- CA1 → `describe('CA1 (0068): sin opciones, el plan es el de hoy')`.
- CA2 → `describe('CA2 (0068): --no-build')`.
- CA3 → `describe('CA3 (0068): -g, --grep y --last-failed llegan a Playwright después de los specs')`.
- CA4 → `describe('CA4 (0068): opción desconocida y --help')` (incluye lanzar el script con
  `--no-buidl`: código 2 y el uso).
- CA5 → `describe('CA5 (0068): con la decisión «ninguno», el plan está vacío')`.

### Verifier, 2026-10-10, commit `1fbd329`, rango `main..feat/0068-e2e-afectados-sin-compilar`: VERDE

- check: 3493 tests, cobertura ok (líneas 93,43 %, ramas 89,98 %).
- e2e afectados: «ninguno» (solo scripts y docs), salida 0.
- A mano en el worktree limpio: `--help` da el uso y 0; con un rango que toca `src`
  (`b122dba~1..b122dba`), `--no-build` sin `out/` sale con 2 y el mensaje de la ficha; tras
  `npm run build`, `--no-build -g "(0001)"` lanza solo los 7 tests «(0001)» de views, en verde, sin
  compilar. Con un rango sin e2e, `--no-build` sale con 0 antes de mirar `out/` (CA5).

## Resultado

- Commits: `080ad50` (tests), `18afb14` (script), `d08d150` (documentación), más los de ficha.
- Ficheros principales: `scripts/affected-e2e.cjs`, `scripts/affected-e2e.test.ts`, `README.md`, `CLAUDE.md` (tabla de comandos), `docs/flujo.md`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Sin migraciones.
- Los dos opcionales del reviewer pasan a «Mejoras anotadas» del BACKLOG.
