# ADR-0003: Una partición de red por entorno y generación

Estado: aceptado (Fase 4, registrado el 2026-10-06)

## Contexto

Cada entorno puede tener su nivel de verificación de certificados y sus huellas aceptadas. Electron
cachea el resultado de `setCertificateVerifyProc` y no hay forma de borrarlo: desde la PR #26517
(2020) volver a llamarlo ya no limpia la caché, y el issue #41448 (pedir esa API) sigue abierto.

## Decisión

Cada cambio de nivel o de huellas de un entorno crea una partición nueva en memoria
`env-<id>-<generación>` (`src/main/dynatrace/network.ts`).

## Alternativas descartadas

- Reutilizar la partición y volver a llamar a `setCertificateVerifyProc`: seguiría aceptando lo que
  ya había aceptado.

## Consecuencias

Cada `reset` deja la sesión anterior en memoria hasta cerrar la app (AUD-21). Es una limitación de
Electron y solo se anota. Fuentes: https://www.electronjs.org/docs/latest/api/session,
https://github.com/electron/electron/pull/26517 y https://github.com/electron/electron/issues/41448.
