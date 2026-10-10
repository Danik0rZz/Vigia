# Vigía — instrucciones para Claude

App de escritorio para Windows (Electron + React + TypeScript) para trabajar con Dynatrace: core de
Dynatrace con mejor presentación y funciones propias (backups y migración con Monaco, aparcados por
ahora). El dueño del proyecto es Dani; se le responde en español.

Este fichero se carga en cada sesión y en cada agente: solo lo imprescindible. El detalle está en
los documentos de abajo, que se leen cuando hacen falta. **El repositorio es la única memoria:** lo
que no está escrito, para los agentes no existe.

## Dónde está cada cosa

- `docs/flujo.md`: **cómo se trabaja**. Sesiones y agentes, ciclo de una ficha, quién decide, git y
  push, niveles de prueba, cierre de versión, pruebas en vivo y trucos de Windows.
- `tasks/`: una ficha por tarea (plantilla en `tasks/_PLANTILLA.md`). `BACKLOG.md`: qué viene.
  `CHANGELOG.md`: qué se hizo, por versión.
- `docs/ARCHITECTURE.md`: procesos, capas, datos y versiones fijadas. `docs/adr/`: decisiones con
  su porqué.
- `src/CLAUDE.md`, `src/main/CLAUDE.md`, `src/renderer/CLAUDE.md` y `e2e/CLAUDE.md`: reglas y
  lecciones de cada zona. Claude Code las añade al trabajar en esa carpeta.
- `docs/pendiente-dani.md`: pruebas a mano que solo puede dar por cumplidas Dani.
- `docs/especificacion.md`: la spec completa. Documento local, no versionado (en `.gitignore`); no
  buscarla ni recrearla si falta en un clon. Al cerrar una decisión pendiente, se marca ahí.
- `docs/propuestas-siguientes.md` (propuestas con su análisis), `docs/notas-api-v2.md` (lo observado
  en vivo) y `docs/glosario.md` (términos de Dynatrace que se escriben igual en los dos idiomas).
- `..\API\`: especificaciones OpenAPI de Dynatrace, fuente de verdad de endpoints, parámetros y
  scopes. Es la carpeta junto al checkout principal, fuera del repositorio:
  `C:\Users\VPS\Desktop\Proyectos\Dev\AplicacionDynatrace\API` (Configuration API, Environment API
  v1 y v2, y `Plataform API`). Desde los worktrees de Orca, la ruta relativa no existe: usar la
  absoluta. Son ficheros grandes: buscar en ellos, no leerlos enteros.
- `README.md`: instalación, comandos y cómo añadir un canal IPC.

## Estado

Última actualización: 2026-10-10.

- **v0.11.0 cerrada** (2026-10-10): análisis de entidades (servicio, host, disco, proceso, grupo de
  procesos, monitores y aplicación web) y descripciones con Markdown y HTML seguro (ADR-0011). Dani
  dio por buenas sus pruebas a mano; queda arrancar el zip. Lo de cada versión, en `CHANGELOG.md`.
- **Flujo con agentes desde el 2026-10-06** (ADR-0007): Planificador, Orquestador y subagentes;
  hooks de git y CI en Windows. **Desde el 2026-10-10** (ADR-0013): carril rápido, menos
  repeticiones de e2e y el CI no se espera; la parte 2 (herramientas, inestables y paralelismo) va
  con fichas.
- **Siguiente:** lo que diga "Próximo" del `BACKLOG.md`; nada se empieza sin ficha aprobada.
- Monaco (fases 5 y 7) está aparcado: no se implementa ni se pregunta por él hasta que Dani lo
  retome.
- Repositorio público: https://github.com/Danik0rZz/Vigia.

## Flujo, en corto

Petición → **Planificador** (sesión 1, `claude --agent planner`) → ficha en `borrador`, o un lote
de fichas pequeñas si la petición es grande → la aprueba Dani (o peticiones, si Dani lo delega) →
**Orquestador** (sesión 2, `/tarea NNNN [MMMM …]`, en cola): test-writer → developer → reviewer
(máximo 3 rondas) → verifier → doc-writer → un commit por ficha (`git merge --squash`) en una rama
`integra/AAAAMMDD-N` → PR a `main` con 3 a 5 fichas → CI de la PR → fusión con «CI ok» en verde.
La ficha que toca IPC, API, dependencias, esquema, seguridad o servicios externos (`exclusiones`)
va sola en su PR, y esa la fusiona Dani. Las fichas del carril rápido (`ligera: sí`) se saltan el
test-writer y pasan delante en la cola; el CI no se espera, y si falla se para la cola hasta
arreglarlo. Lo que espera a Dani se le avisa por Telegram y se contesta en la sesión (o desde el
móvil con Remote Control). Las versiones se cierran con `/cerrar-version`. Los cambios de alcance
(`[ALCANCE]`) los decide Dani. Detalle: `docs/flujo.md` y ADR-0007, ADR-0010, ADR-0013 y ADR-0014.

## Reglas que no se saltan

- Se escala a Dani lo destructivo o irreversible, publicar algo nuevo hacia fuera, licencia, marca,
  temas legales, el qué de las funciones sin definir, la API cuando no se puede deducir y retomar
  Monaco. Solo lo decide Dani: force push, reescribir el historial publicado, borrar ramas remotas,
  fusionar la PR de una ficha sola, la configuración de GitHub, tags, releases y publicar el zip. El
  zip nunca se arranca en su perfil. (Lista completa en `docs/flujo.md`, "Quién decide".)
- Push: `git push origin integra/<nombre>` (solo ramas con ese prefijo), PR a `main` con
  `gh pr create` y fusión de las PR agrupadas con `gh pr merge --merge` cuando «CI ok» está en
  verde, con el reviewer en APROBADO y el verifier en verde en cada ficha. `git push origin main`
  solo mientras no esté activa la protección de `main`. Nunca `--force`, `--force-with-lease` ni
  `--no-verify`; los agentes no borran ramas remotas (las borra GitHub al fusionar).
- Nunca escribir secretos, cabeceras `Authorization` ni cookies en logs, ficheros de configuración,
  mensajes de error ni en el repositorio.
- Nada del tenant de pruebas (nombres, IDs, URLs, valores) ni nombres de clientes en el repositorio,
  las fichas, los fixtures o los mensajes entre sesiones. `npm run test:live` es de solo lectura y
  nunca se lee ni se muestra `.env.live.local`.
- No inventar endpoints ni parámetros de Dynatrace o de Monaco: `..\API\` y la documentación
  oficial.
- Un criterio de aceptación manual no se da por cumplido; solo lo confirma Dani.
- Comentarios, textos de interfaz y documentación en español; identificadores en inglés.
  Dependencias con versión exacta (`npm install --save-exact <paquete>`).
- Las rutas de Windows van entre comillas invertidas (`%APPDATA%\vigia`) y los ficheros se editan
  con las herramientas de edición, `sed` o `node`, nunca con `Set-Content` (ver `docs/flujo.md`).

## Comandos

| Comando                                | Qué hace                                                          |
| -------------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                          | App en desarrollo con recarga en caliente                         |
| `npm run check`                        | Lint, tipos, formato y tests unitarios con umbral de cobertura    |
| `npm run test:e2e`                     | Compila y prueba la app de punta a punta (Playwright)             |
| `npm run test:e2e:affected -- [rango]` | e2e afectados (`e2e/areas.json`); `--no-build`, `-g`, `--help`    |
| `npm run test:e2e:nobuild`             | e2e sin compilar (si solo cambian los specs y `out/` está al día) |
| `npm run build`                        | Tipos y compilación a `out/`                                      |
| `npm run dist:win`                     | Zip de Windows en `dist/`                                         |
| `npm run format`                       | Prettier                                                          |
| `npm run test:live`                    | Pruebas de solo lectura contra el tenant de pruebas               |
| `npm run scan:tenant`                  | Busca restos del tenant de pruebas (lo lanza el pre-push)         |

Antes de dar una tarea por terminada: `npm run check` y `npm run test:e2e:affected` (o el e2e
completo si el cambio es transversal).

## Primer paso al retomar

1. `npm ci --ignore-scripts` y `npx install-electron` (Electron 44 no descarga su binario al
   instalar; si se deja para el primer uso, los e2e en paralelo fallan). Sin `--ignore-scripts`, npm
   intenta compilar better-sqlite3 con node-gyp y falla sin Visual Studio (detalles en el README).
2. `git config core.hooksPath .githooks`, una vez por clon.
3. `npm run check` y `npm run test:e2e`. Si algo falla, arreglarlo antes de seguir.
