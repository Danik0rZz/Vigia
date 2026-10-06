# ADR-0002: Solo main accede a red, disco y secretos

Estado: aceptado (Fase 1, registrado el 2026-10-06)

## Contexto

La interfaz muestra datos de Dynatrace que no controlamos y maneja tokens con permisos sobre
tenants de clientes. Un fallo en el renderer no puede dar acceso a la red, al disco ni a los
secretos.

## Decisión

Tres procesos. Main es el único con acceso a red, disco, procesos externos y secretos. El renderer
corre con `contextIsolation`, `sandbox` y sin `nodeIntegration`, y solo ve `window.vigia.invoke`.
Cada canal IPC se declara en `src/shared/ipc.ts` con esquema Zod de entrada y de salida, y
`src/main/ipc/handler.ts` comprueba el remitente, valida las dos direcciones y no devuelve el
detalle de los errores internos.

## Alternativas descartadas

- Peticiones desde el renderer con `fetch`: expone los tokens a la interfaz y obliga a abrir la CSP.

## Consecuencias

Cada función nueva que necesita datos añade un canal (README, "Cómo se comunican la interfaz y
main"). Un canal sin implementación no compila.
