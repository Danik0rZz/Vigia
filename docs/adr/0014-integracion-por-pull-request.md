# ADR-0014: Integración por pull request

Estado: aceptado (2026-10-11). Fichas: 0072 (CI en la PR) y 0073 (el flujo de integración)

## Contexto

El ADR-0013 (parte 2) pide dejar de lanzar el CI completo (check, e2e y `dist:win`, unos 13 min) en
cada push a `main`. Hasta ahora cada ficha terminaba en `git push origin main`, y el CI no distinguía
entre una ficha y otra. Además, el CI ignora los pushes que solo tocan documentos (`paths-ignore`),
así que un check obligatorio de GitHub quedaría «pendiente» para siempre en una PR solo de
documentos. Dani decidió el 2026-10-10 las reglas de push y de borrado de ramas.

## Decisión

1. **CI en la PR a `main`.** `ci.yml` arranca en todas las PR (sin `paths-ignore`) con tres jobs:
   `cambios` (`scripts/ci-changes.mjs` decide si la PR trae algo más que documentos), `windows`
   (`check` y e2e completo, sin `dist:win`, solo si hay código) y `ci-ok` («CI ok», con
   `if: always()`). «CI ok» da verde si `cambios` acabó bien y `windows` acabó bien o se saltó; rojo si
   alguno falló o se canceló. Es el único check que exigirá la protección de `main`. Un push nuevo a la
   misma PR cancela el run anterior; en `main` los runs se encolan.
2. **Un commit por ficha**, con `git merge --squash` de la rama de la ficha en la rama de integración
   (`scripts/integrate.mjs` compone el mensaje y comprueba que la ficha está `verificada`).
3. **Ramas de integración** `integra/AAAAMMDD-N`, que los agentes pueden subir con
   `git push origin integra/…` (solo ese prefijo; nunca `--force` ni `--force-with-lease`). El push a
   la rama no lanza el CI.
4. **Qué va en cada PR.** Solo va sola la ficha que toca una exclusión del carril rápido (IPC, API de
   Dynatrace, dependencias, esquema, seguridad o servicios externos, campo `exclusiones` de la ficha),
   y esa PR la fusiona Dani. Las demás se agrupan de 3 a 5 y las fusiona el Orquestador con
   `gh pr merge --merge` cuando «CI ok» está en verde, el reviewer en APROBADO y el verifier en verde.
5. **Fusión con «Create a merge commit».** `main` conserva un commit por ficha con los mismos SHA. Con
   «Rebase and merge» habría que reescribir commits y subir con force push; con «Squash» se perdería
   el uno por ficha.
6. **Ramas remotas:** Dani activó «Automatically delete head branches»; los agentes no borran ramas.
7. **Protección de `main`** (la activa Dani tras ver las PR de prueba): «CI ok» como único check
   obligatorio, sin exigir rama al día y sin excepción para administradores.
8. **`gh` con un token fine-grained del repositorio** (Contents y Pull requests, lectura y escritura,
   sin administración), que los agentes no ven ni guardan. Si no basta para leer el CI, lo decide Dani.
9. **El push a `main` mantiene `npm run check` y `dist:win`**, sin e2e (ya pasó en cada PR), para
   cazar combinaciones de PR que no se probaron juntas.

## Alternativas descartadas

- `paths-filter` u otra acción de terceros para detectar el código: una dependencia más; basta un
  script del repositorio con su test.
- Exigir como check el job `windows`: se salta en las PR solo de documentos y se quedaría pendiente.
- «Rebase and merge» o «Squash»: ver el punto 5.
- Dejar la rama al día con `main` como requisito: la PR ya se prueba sobre el resultado de fusionarla.
- Seguir con el push directo a `main`: sin PR no hay un punto donde el e2e completo sea obligatorio.

## Consecuencias

- El e2e completo corre una vez por PR, no por ficha ni por push.
- Una PR solo de documentos pasa en segundos con «CI ok».
- Un run cancelado por un push nuevo ejecuta «CI ok» en rojo sobre el SHA antiguo; no afecta a la PR.
- Cuando la protección esté activa, `git push origin main` deja de usarse (lo implementa la 0073).
- La comprobación con dos PR de prueba en GitHub la hace el Orquestador al integrar la 0072.
