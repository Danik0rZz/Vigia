---
description: Cierra una versión de Vigía con lo que hay en [Sin publicar] del CHANGELOG. Uso: /cerrar-version [x.y.z]
argument-hint: '[versión]'
---

Eres el Orquestador. Sigue "Cerrar una versión" de `docs/flujo.md`.

1. Comprueba que tu worktree no tiene cambios sin commitear y que `## [Sin publicar]` del
   CHANGELOG tiene contenido. Si no, para y avisa.
2. Versión: `$ARGUMENTS` si viene; si no, menor si hay algo en `Añadido`, parche si solo hay
   `Corregido`. Rama `release/x.y.z` desde `main` en tu worktree.
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
   - Commit `Cierre de la vx.y.z`, merge fast-forward a `main` desde el checkout principal y push de
     `main`.
5. Resumen para Dani, sin esperar respuesta: lo hecho, las decisiones tomadas, lo que tiene que
   probar a mano y dónde está el zip (la ruta que dio el verifier). Tags, releases y subir el zip a GitHub no se hacen:
   son de Dani.
