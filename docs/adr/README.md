# Decisiones de arquitectura (ADR)

Una decisión por fichero, con su contexto, la decisión, las alternativas descartadas y sus
consecuencias. Las crea el doc-writer al cerrar una ficha que lo pide (`adr_nuevo`) o al cerrarse
una decisión pendiente de la spec. Una decisión no se cambia editando su ADR: se escribe otro que la
sustituye y el antiguo pasa a `sustituido por ADR-NNNN`.

Las 0001 a 0006 recogen decisiones ya tomadas en las fases 1 a 6 y en las versiones 0.7 a 0.10
(registradas el 2026-10-06 a partir de la spec, el CHANGELOG y el CLAUDE.md de entonces).

| ADR                                      | Decisión                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| [0001](0001-stack.md)                    | Electron + React + TypeScript, zip de Windows sin instalar |
| [0002](0002-solo-main-accede-a-red.md)   | Solo main accede a red, disco y secretos; IPC con Zod      |
| [0003](0003-particion-por-generacion.md) | Una partición de red por entorno y generación              |
| [0004](0004-vistas-sin-refresco.md)      | Las vistas no se refrescan solas                           |
| [0005](0005-errores-con-reason.md)       | Main no traduce: errores con `reason`                      |
| [0006](0006-e2e-sobre-out.md)            | Los e2e corren sobre `out/`, sin empaquetar                |
| [0007](0007-flujo-con-agentes.md)        | Flujo de trabajo con fichas y agentes                      |

Plantilla: [`_PLANTILLA.md`](_PLANTILLA.md).
