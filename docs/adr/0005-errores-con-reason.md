# ADR-0005: Main no traduce: errores con `reason`

Estado: aceptado (v0.8.1, AUD-21; registrado el 2026-10-06)

## Contexto

La interfaz está en español y en inglés, y main no sabe el idioma que ve el usuario. Los mensajes
de main también van al log, que tiene que ser legible para quien lo revisa.

## Decisión

Todo `DtError` o `DomainError` nuevo con texto para el usuario lleva `reason`, una clave de
`src/shared/error-reasons.ts` con su texto en `errorReasons.*` de es y en. Su `message`, en
español, es solo para el log. Los que llevan el texto propio de Dynatrace van sin `reason`, en la
lista blanca de `src/main/error-reasons.test.ts`.

## Alternativas descartadas

- Traducir en main: duplica i18next en dos procesos y obliga a avisar a main del cambio de idioma.

## Consecuencias

El test de `error-reasons` falla si un error nuevo olvida su `reason`.
