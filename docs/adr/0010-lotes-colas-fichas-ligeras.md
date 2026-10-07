# ADR-0010: Lotes, colas y fichas ligeras

Estado: aceptado (2026-10-07)

## Contexto

Con el flujo de la ADR-0007, cada ficha costaba lo mismo, fuera un botón o una página nueva: entre
media hora y una hora, cinco subagentes y una espera de Dani para aprobarla. Dani va a iterar mucho
(Problemas solo está empezado y quedan varias secciones) y pidió ir más rápido. También pidió que
todo lo que necesite su aprobación le llegue al móvil, para poder responder fuera del PC.

## Decisión

Aprobado por Dani el 2026-10-07:

- **Lotes:** una petición grande se trocea en varias fichas pequeñas, con `lote`, orden y
  `depende_de`, que Dani aprueba de una vez.
- **Colas:** `/tarea NNNN MMMM …` hace varias fichas seguidas sin esperar a Dani entre ellas. Una
  ficha que espera a Dani (`en_espera`) o queda `bloqueada` no para la cola: se avisa y se sigue con
  las que no dependen de ella.
- **Fichas ligeras** (`ligera: sí`): para fichas S que no tocan canales IPC, la API de Dynatrace,
  dependencias, el esquema, la seguridad ni servicios externos. El developer escribe los tests
  antes que el código, sin test-writer, y el reviewer comprueba que cubren los criterios.
- **Modelos:** el doc-writer y el verifier, que hacen trabajo mecánico, usan `model: sonnet`. El
  developer, el test-writer y el reviewer siguen con el modelo de la sesión.
- **Avisos:** además de `/tarea` y `/cerrar-version`, avisan el Planificador (fichas o lotes listos
  para aprobar) y el final de cada cola. Las preguntas se redactan para contestarlas desde el móvil.
- **Responder desde el móvil:** con Remote Control de Claude Code (`/remote-control` y la app de
  Claude), que permite contestar a la sesión que espera. Telegram solo avisa.

## Alternativas descartadas

- **Una ficha grande con N pasos:** un fallo bloquea todo, el diff es demasiado grande para
  revisarlo bien, se pasa del límite de 3 rondas y no se puede deshacer por partes.
- **Quitar la revisión o los tests en las fichas pequeñas:** son lo que encontró los fallos reales
  de las fichas 0001 a 0005.
- **Recibir órdenes por Telegram (Channels de Claude Code):** está en vista previa, necesita Bun y
  abre una vía para mandar instrucciones a una sesión con permisos sobre el repositorio. Remote
  Control hace lo mismo con la cuenta de Claude de Dani. Se puede estudiar en una ficha aparte.

## Consecuencias

El tiempo de espera de Dani pasa de una vez por ficha a una vez por lote, y las colas trabajan solas
entre avisos. Una ficha ligera mal marcada pierde la mirada independiente del test-writer: por eso
el criterio de "ligera" es estrecho y, en la duda, `no`. Una cola larga deja varias ramas
`en_espera` a la vez; se retoman de una en una con `/tarea NNNN`.
