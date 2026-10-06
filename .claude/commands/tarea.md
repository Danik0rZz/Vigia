---
description: Ejecuta el flujo completo de una ficha aprobada de Vigía. Uso: /tarea 0004
argument-hint: <número de ficha>
---

Ficha: `tasks/$ARGUMENTS-*.md`. Eres el Orquestador: no escribes código ni tests. Coordinas,
vigilas el estado de la ficha y escribes en ella lo que te devuelven los subagentes. El detalle del
flujo está en `docs/flujo.md`.

1. Lee la ficha. Si su estado no es `aprobada` (o, al retomar, uno intermedio), para y avisa. Si el
   árbol tiene cambios sin commitear, para y avisa.
2. `git switch -c <rama de la ficha> main` (o `git switch <rama>` si ya existe y retomas).
3. **test-writer**, con solo la ruta de la ficha. Al volver, comprueba que la ficha está en
   `tests_escritos`, que hay commit de tests y que fallan por falta de código.
4. **developer**, con solo la ruta de la ficha. Si dice que un test es incorrecto: si es un error
   del test, vuelve al test-writer con esa nota; si cambia lo que se pide, es `[ALCANCE]` (paso 6).
5. **reviewer**, con la ruta de la ficha y la ronda. Copia su respuesta en "Notas del revisor" y
   sube `rondas_revision`.
6. Si es CAMBIOS:
   - Si hay algún `[ALCANCE]`, pregúntaselo a Dani. Si Dani ha delegado en peticiones, envíaselo al
     Planificador con `SendMessage` (`ListAgents` para encontrar su sesión) y espera su respuesta.
     La decisión se anota en la ficha (criterio nuevo o "Fuera de alcance").
   - Si cambian criterios, vuelve al test-writer (solo los tests nuevos) y después al developer; si
     no, directamente al developer con la ruta de la ficha. Estado `en_desarrollo`.
   - Máximo 3 rondas. Si la tercera no se aprueba: `estado: bloqueada`, y se lo dices a Dani con el
     motivo y el **Aviso** (abajo).
   - Si el `[ALCANCE]` espera a Dani (no está delegado), **Aviso** con `estado: parada` antes de
     esperar. Si lo decide el Planificador por delegación, no se avisa.
7. Con APROBADO, **verifier** en modo `ficha` con la rama, el rango `main..<rama>` y una carpeta de
   tu scratchpad. Copia su resultado en "Verificación". Si es ROJO, vuelve al developer con el
   fallo (cuenta como una ronda más) y repite la revisión. Si es VERDE: `estado: verificada`.
8. **doc-writer**, con la ruta de la ficha.
9. Integración (`docs/flujo.md`, "Git"): `git -C <checkout principal> merge --ff-only <rama>`. Si
   no es fast-forward, `git rebase main` en la rama y, si el rebase tocó algo más que documentos,
   repite el verifier. Después `git -C <checkout principal> push origin main` (el pre-push pasa
   `scan:tenant`) y borra la rama local.
10. Muestra a Dani el briefing del doc-writer, más las rondas, el resultado del verifier y el enlace
    al CI del push (`gh run list --branch main --limit 1`, si `gh` está disponible), y manda el
    **Aviso** con `estado: hecha`.

No saltes pasos ni hooks. Si algo no está escrito en el repositorio y hace falta decidirlo, para y
pregunta (con el **Aviso** de `parada`).

**Aviso** (`docs/flujo.md`; opcional, nunca para el flujo): escribe un JSON en tu scratchpad y
ejecuta `node scripts/notify-telegram.mjs <ruta-del-json>`. Campos: `tipo: "tarea"`, `ficha`,
`titulo`, `estado`, `resumen`, `rondas`, `verifier` (`VERDE` | `ROJO` | `sin pasar`), `ci` y
`decision`. Cuándo:

- `estado: hecha`: tras el push del paso 9, con el enlace del CI del paso 10 en `ci`.
- `estado: bloqueada`: tres rondas sin aprobar (también si la última fue un ROJO del verifier), con
  el motivo en `resumen` y el último resultado en `verifier`.
- `estado: parada`: esperando a Dani (`[ALCANCE]` no delegado o cualquier "para y pregunta"), con la
  pregunta en `decision`.

El `resumen` lo redactas tú desde el briefing del doc-writer (o el motivo), en pocas líneas, sin
datos del tenant ni nombres de clientes: el filtro del script es la red de seguridad, no la única
defensa. Si el script avisa en la terminal, se lo dices a Dani y sigues.
