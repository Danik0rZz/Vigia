---
description: Cierra una versión de Vigía con lo que hay en [Sin publicar] del CHANGELOG. Uso: /cerrar-version [x.y.z]
argument-hint: '[versión]'
---

Eres el Orquestador. Sigue "Cerrar una versión" de `docs/flujo.md`.

1. Comprueba que tu worktree no tiene cambios sin commitear y que `## [Sin publicar]` del
   CHANGELOG tiene contenido. Si no, para y avisa.
2. Versión: `$ARGUMENTS` si viene; si no, menor si hay algo en `Añadido`, parche si solo hay
   `Corregido`. Antes, "Traer `main`" (`docs/flujo.md`, "Git": `git fetch origin`,
   `git merge -m "chore(git): trae origin/main" origin/main` con `git -C <checkout principal>` y,
   si hay una `integra/…` en curso, `git merge -m "chore(git): trae main" main` en ella; si el
   checkout principal tiene cambios sin commitear, no lo empiezas, y si el merge da conflicto,
   `git -C <checkout principal> merge --abort`: en los dos casos paras y avisas a Dani, sin
   resolver conflictos en el checkout de otra sesión). Rama `release/x.y.z` desde `main` en tu
   worktree.
3. **verifier** en modo `cierre` (rango desde la versión anterior: el commit que subió su número en
   `package.json`). Si es ROJO, para y avisa: el arreglo es una ficha nueva.
4. Con VERDE:
   - `package.json` (y `package-lock.json`) a la versión nueva, sin tocar nada más.
   - CHANGELOG: `## [Sin publicar]` pasa a `## [x.y.z] - AAAA-MM-DD`, con una frase de resumen y
     "Sin migraciones nuevas" o cuáles.
   - `docs/pendiente-dani.md`: sección `## vx.y.z` arriba del todo con las "Pruebas a mano para
     Dani" de las fichas de la versión y "Arrancar el zip x.y.z sobre sus datos (…). **Antes, hacer
     una copia de `%APPDATA%\vigia`**; lo hace Dani."
   - "Estado" del `CLAUDE.md` raíz: versión, fecha y una línea con lo que trae.
   - Commit `Cierre de la vx.y.z` en la rama de la versión. Se integra por PR (`docs/flujo.md`,
     "Git"): `git switch -c integra/AAAAMMDD-N release/x.y.z`,
     `git push origin integra/AAAAMMDD-N`, `gh pr create --base main` con el título
     «Cierre de la vx.y.z» y, con «CI ok» en verde, `gh pr merge --merge`. Después, "Traer
     `main`" como en el paso 2. Al fusionar, el CI de `main` pasa `check` y `dist:win`; si
     Dani quiere, `dist:win` también se lanza a mano (`workflow_dispatch`).
5. Resumen para Dani, sin esperar respuesta: lo hecho, las decisiones tomadas, lo que tiene que
   probar a mano y dónde está el zip (la ruta que dio el verifier). Tags, releases y subir el zip a
   GitHub no se hacen: son de Dani.
6. **Aviso** (`docs/flujo.md`; opcional, nunca para el flujo), salga bien o no: escribe un JSON en
   tu scratchpad y ejecuta `node scripts/notify-telegram.mjs <ruta-del-json>`, con `tipo: "version"`,
   `version` (sin «v»), `titulo`, `estado`, `resumen`, `rondas: 0`, `verifier`, `ci` y `decision`.
   - `estado: cerrada`: al fusionar la PR, con el enlace del CI de `main`
     (`gh run list --branch main --limit 1`).
     Sin la ruta del zip: es una ruta local.
   - `estado: fallida`: ROJO del verifier u otra parada, con el motivo en `resumen`.

   El `resumen`, en pocas líneas y sin datos del tenant ni nombres de clientes. Si el script avisa
   en la terminal, se lo dices a Dani y sigues.
