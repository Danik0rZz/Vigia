# ADR-0007: Flujo de trabajo con fichas y agentes

Estado: aceptado (2026-10-06)

## Contexto

Hasta la 0.10.2 el trabajo se repartía entre sesiones largas (peticiones, dev, senior y test) que
acumulaban contexto en la conversación. El `CLAUDE.md` raíz había crecido a 237 líneas, con el
historial de versiones y las pruebas a mano de Dani mezclados con las reglas. Lo que una sesión
sabía y no estaba escrito se perdía al compactar o al cerrarla.

## Decisión

El repositorio es la única memoria. Dos sesiones y subagentes efímeros (detalle en
`docs/flujo.md`):

- Sesión 1, **Planificador** (la antigua peticiones): convierte cada petición en una ficha de
  `tasks/` con criterios de aceptación numerados. Aprueba Dani o, si Dani lo ha delegado,
  peticiones en su nombre.
- Sesión 2, **Orquestador**: `/tarea NNNN` lanza test-writer → developer → reviewer (máximo 3
  rondas) → verifier → doc-writer, y no escribe código.
- Puertas sin IA: hooks de git de pre-commit y pre-push (`.githooks/`) y CI en GitHub Actions sobre
  Windows.
- Cada tarea en su rama local `feat/NNNN-…`, integrada en `main` con fast-forward y push de `main`
  (sin PR).
- `CLAUDE.md` raíz corto; el detalle en `docs/`, en el `CLAUDE.md` de cada carpeta y en los ADR.

Decisiones de Dani (2026-10-06): rama local y merge en vez de PR; CI en Windows; aprueba las fichas
Dani o peticiones si no está; fichas, BACKLOG y ADR versionados en el repositorio público.

## Alternativas descartadas

- Rama + PR en GitHub: publica ramas en el repositorio público y exige la protección de `main`.
- Fichas locales e ignoradas: se perderían en un clon y los worktrees no las verían.

## Consecuencias

Las fichas y los ADR son públicos: nada del tenant ni nombres de clientes (lo vigila
`npm run scan:tenant` en el pre-push). Cada subagente arranca sin memoria y se pone al día leyendo
el repositorio, así que lo que no está escrito no existe. Las sesiones dev, senior y test se
retiran: sus papeles los hacen developer, reviewer y verifier.
