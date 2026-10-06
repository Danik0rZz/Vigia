# Reglas de src/

Se suman a las del `CLAUDE.md` raíz. Las de main, renderer y e2e están en el `CLAUDE.md` de cada
carpeta.

- Solo main accede a red, disco, procesos externos y secretos. La interfaz lo pide todo por IPC
  (`src/shared/ipc.ts`, con esquema Zod de entrada y de salida).
- Errores hacia la interfaz: main no traduce. Todo `DtError` o `DomainError` nuevo con texto para el
  usuario lleva `reason` (clave de `src/shared/error-reasons.ts` con su texto en `errorReasons.*` de
  es y en); su `message` en español es para el log. Solo los que llevan el texto propio de Dynatrace
  van sin `reason`, en la lista blanca de `src/main/error-reasons.test.ts`, que falla si alguno lo
  olvida.
- Nunca escribir secretos, cabeceras `Authorization` ni cookies en logs, ficheros de configuración,
  mensajes de error ni en el repositorio.
- Textos de interfaz en es y en (el test de paridad de `check` lo exige). Comentarios en español;
  identificadores en inglés.
- **La tilde de "Vigía" no puede acabar en una cabecera HTTP ni en una ruta.** Electron mete el
  nombre de la app en el User-Agent y eso rompía el protocolo `app://`. Está resuelto en
  `src/main/user-agent.ts`. Para todo lo técnico se usa `vigia`.
- El preload corre en sandbox y solo puede cargar `electron`, `events`, `timers` y `url`. Por eso
  `electron.vite.config.ts` tiene `externalizeDeps: false` en el preload.
- La CSP se envía como cabecera, no como etiqueta `meta`: en producción la pone el protocolo
  `app://` y en desarrollo `hardenDefaultSession`. Cualquier ampliación se anota en
  `src/main/security/csp.ts` con su motivo; nunca `unsafe-eval` ni orígenes remotos.
- Los permisos web están denegados para todo (`src/main/security/harden.ts`). Si una tarea necesita
  uno (por ejemplo, portapapeles desde la interfaz), se concede ahí de forma explícita.
