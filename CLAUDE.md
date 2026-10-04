# Vigía — instrucciones para Claude

App de escritorio para Windows (Electron + React + TypeScript) para trabajar con Dynatrace: core de Dynatrace con mejor presentación y funciones propias (backups y migración con Monaco, aparcados por ahora). El dueño del proyecto es Dani; se le responde en español.

## Documentos

- `docs/especificacion.md`: la especificación completa (stack, seguridad, autenticación, Monaco, interfaz, plan de once fases, con la 5 y la 7 (Monaco) aparcadas, y decisiones pendientes). **Leer la sección de la fase en curso antes de escribir código.** Es la copia de trabajo: al cerrar una decisión pendiente, se marca ahí. Documento local, no versionado (en `.gitignore`); no buscarla ni recrearla si falta en un clon.
- `docs/glosario.md`: términos de Dynatrace que se escriben igual en español y en inglés.
- `README.md`: comandos, estructura y cómo añadir un canal IPC.
- `CHANGELOG.md`: se actualiza en cada fase.
- `..\API\`: especificaciones OpenAPI de Dynatrace (Configuration API, Environment API v1 y v2, y APIs de plataforma). Son la fuente de verdad de endpoints, parámetros y scopes. Son ficheros grandes: buscar en ellos, no leerlos enteros.

## Estado actual

Última actualización: 2026-10-04.

- **Fase 1 (base del proyecto): aceptada, versión 0.1.0.** Criterios automáticos y manuales cumplidos; los manuales los comprobó Dani en Windows.
- **Fase 2 (esqueleto de la interfaz): cerrada, versión 0.2.0.** Criterios automáticos cumplidos (check 54 tests, e2e 29 tests, en Windows); la aceptación manual está en la lista de pendientes.
- **Fase 3 (datos locales y secretos): cerrada, versión 0.3.0.** Criterios automáticos cumplidos en Windows (check y e2e, con relanzamiento de la app); la aceptación manual está en la lista de pendientes.
- **Fase 4 (cliente de Dynatrace): cerrada, versión 0.4.0.** Criterios automáticos cumplidos en Windows (unitarios, integración con un HTTPS simulado y e2e de certificados); la prueba contra un tenant real está en la lista de pendientes.
- **Fase 6 (primeras vistas core): cerrada, versión 0.6.0.** Con ella se completa el alcance propuesto de la primera versión (fases 1, 2, 3, 4 y 6). Criterios automáticos cumplidos en Windows; la aceptación manual está en la lista de pendientes.
- **v0.7.0 (mejoras sobre la primera versión): cerrada y publicada en `main`.** Problemas completo (tabla, detalle con `fields`, exportación común), descripción del token, entornos por tipo y cliente, tooltips del menú y pruebas en vivo (`npm run test:live`). Criterios automáticos cumplidos en Windows.
- **v0.8.0: cerrada.** Auditoría externa n.º 1 cerrada (todos los P1 y P2; se citan por su ID, `AUD-xx`), clúster y filtros por entorno en Problemas, detalle en panel lateral, Métricas con aviso de puntos y recortes, SLOs en Inicio, y exploración de la API v2 (bloques a-f) en `docs/notas-api-v2.md`. Sin migraciones nuevas. Criterios automáticos de nivel 3 cumplidos en Windows (e2e ×3, repeticiones de views y tenants, dist:win y clon limpio con la instalación del README).
- **v0.8.1: cerrada.** Backlog P3 de AUD-21 (errores del SSO, huella ofrecida y del SSO en `certificates:pin`, errores de main traducidos por clave, plurales y locale de ECharts, fila de Problemas con `memo`, colación de entornos, limpieza de los e2e en Windows), el aviso de los SLO con problemas sin calcular y `views.spec` independiente del orden. Sin migraciones nuevas. Quedan anotados el fusible del asar y las particiones de red. Criterios automáticos de nivel 3 cumplidos en Windows (e2e ×3, views ×10 con `--workers=1`, tls y tenants ×20, dist:win y clon limpio con la instalación del README).
- **v0.9.0: cerrada.** Rediseño de Problemas pedido por Dani: grid propio de 4 columnas con barra de estado, orden y teclado; detalle en página propia (`/problems/:problemId`) con vuelta a la lista conservando filtros, orden, fila y foco; exportación del detalle por secciones (`export:workbook`). Sin migraciones nuevas. `app:openExternal` se retiró por no tener uso (está en `0f4faa1`). Las ventanas de los e2e ya no toman el foco del sistema (`VIGIA_E2E`). Criterios automáticos de nivel 3 cumplidos en Windows (check 1342, e2e ×2, views ×3 con `--workers=1`, smoke ×3 y dist:win; sin clon limpio porque no cambian las dependencias).
- **v0.9.1: cerrada.** Detalle del problema centrado en evidencias y comentarios, pedido por Dani: fuera `impactAnalysis`; evidencias normalizadas (`src/shared/problem-evidence.ts`) con causa raíz arriba, grupos por entidad, filtros por tipo, tarjeta de cambio y "Abrir en Métricas"; comentarios con "Ver todos" (`problems:comments`). Sin migraciones nuevas. En vivo solo llegaron evidencias EVENT: METRIC y TRANSACTIONAL están probados solo con el simulador. Criterios automáticos de nivel 3 cumplidos en Windows (check 1520, e2e ×2, views ×3 con `--workers=1` y dist:win; sin clon limpio porque no cambian las dependencias).
- **v0.9.2: cerrada.** Mini gráfico en las evidencias EVENT con `dt.event.metric_selector` (clave observada en vivo, fuera de la OpenAPI): extracción en main sobre las propiedades en crudo, `metrics:query`, carga diferida con una cola de 3, umbral `dt.event.metric_threshold`, "Abrir en Métricas", exportación y captura. El selector nunca va al log de main. Sin migraciones nuevas. Criterios automáticos de nivel 3 cumplidos en Windows (check 1630, e2e ×2, views ×3 con `--workers=1` y dist:win; un fallo intermitente del tooltip de SLO, que no cambia en esta versión, pasó 10/10 aislado y 186/186 al repetir views ×3; sin clon limpio porque no cambian las dependencias).
- **v0.10.0: cerrada.** Evidencias del detalle como tabla (el mismo `DataGrid` que la lista de Problemas), pedido por Dani: estado propio de cada evento (`data.status` o, si no, por su fin) con abiertos primero, filtros con contadores Todos/Abiertos/Cerrados, filas desplegables con el detalle y el mini gráfico, resumen de la causa raíz que salta a su fila, y estado de la tabla recordado por entorno y problema (los 20 últimos). La exportación del detalle saca lo filtrado, en el orden de la tabla, y lo dice en Info. Sin migraciones nuevas. Criterios automáticos de nivel 3 cumplidos en Windows (check 1711, e2e ×2, views ×3 con `--workers=1` y dist:win; sin clon limpio porque no cambian las dependencias).
- **v0.10.1: cerrada.** Pantallas de error propias en lugar de la de React Router, pedido por Dani: error inesperado, interfaz cambiada (con cuenta atrás cancelable y marca anti-bucle), 404 propio, aviso compacto por panel y pantalla de último recurso, con el faro animado (quieto con movimiento reducido), detalles enmascarados con "Copiar detalles" (`app:copyText`) y los errores al log de main con freno (`app:logRendererError`). El "error al actualizar" de Dani era la recarga en caliente de Vite en desarrollo, no un fallo de la app empaquetada; en dev se dice así. Sin migraciones nuevas. Criterios automáticos de nivel 3 cumplidos en Windows (check 1779, e2e ×2, errors, smoke y views ×3 con `--workers=1`, el fallo de chunk ×15 y dist:win; sin clon limpio porque no cambian las dependencias).
- **Siguiente:** nada nuevo sin Dani (decisión de peticiones). Lo que puede venir está en `docs/propuestas-siguientes.md`, con la licencia aparte.
- **Primera versión: fases 1, 2, 3, 4 y 6, aceptada por Dani** (2026-10-04). Monaco (fases 5 y 7) está aparcado: no se implementa ni se pregunta por él hasta que Dani lo retome.
- Repositorio git local. Remoto público: https://github.com/Danik0rZz/Vigia.
- El código se escribió y se probó en Linux. Dani ha comprobado a mano la Fase 1 en Windows, y `npm run check` y `npm run test:e2e` pasan en Windows (2026-10-03).

Lo que se comprobó de la Fase 1 (en Linux): lint, tipos, 21 tests unitarios, 9 tests de extremo a extremo sobre la app compilada, `npm run dev` sin errores en consola, generación del zip de Windows y arranque de la app empaquetada (build de Linux).

Aceptación manual de la Fase 1 (comprobada por Dani en Windows):

- [x] `npm run dev` abre la ventana en Windows.
- [x] El zip (`npm run dist:win`) arranca en un PC sin Node.
- [x] El zip arranca en un PC corporativo (SmartScreen, AppLocker).

### Pendiente de Dani (aceptación manual)

No bloquea: se sigue con la fase siguiente y Dani lo prueba cuando pueda.

Dani aceptó la v0.6.0 el 2026-10-04 (cliente y entorno que se conservan al reiniciar) y dio por cumplidos los criterios manuales de las fases 2, 3, 4 y 6. "Probar conexión contra un tenant real" queda cubierto por las pruebas en vivo (`npm run test:live`, v0.7.0), y "XLSX y CSV en Excel" se revisa con las exportaciones reales de esas pruebas.

v0.8.0 (incluye lo de la v0.7.0), pruebas a mano con los datos reales:

- [ ] Al marcar "ignorar certificados" en el formulario del entorno aparece el aviso.
- [ ] La ruta de la barra superior muestra Cliente › tipo de entorno, y el menú tiene tooltips.
- [ ] "Probar conexión" describe el token (nombre, caducidad y scopes).
- [ ] Problemas: filtro de Clúster y filtros de severidad e impacto. (El panel lateral del detalle ya no existe: desde la 0.9.0, el detalle va en su propia página; ver abajo.)
- [ ] Los avisos "Mostrando N de M" y los avisos de Dynatrace se entienden.
- [ ] Métricas: con 7 días y 1 min aparece el aviso de puntos y "Usar 10m". SLOs de Inicio: el estado de aviso con su color, "Sin evaluar" y los problemas relacionados.
- [ ] Guardar un secreto pulsando Enter en su campo.
- [ ] Arrancar el zip 0.8.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

v0.8.1, pruebas a mano (se pueden hacer junto con las de la 0.8.0, con el zip 0.8.1):

- [ ] Con la interfaz en inglés, un error de "Probar conexión" (por ejemplo, un certificado no fiable o un token caducado) sale en inglés.
- [ ] Si el SSO del entorno usa un certificado que Windows no reconoce: "Probar conexión" ofrece su huella, se acepta y OAuth conecta. Si no es el caso, no aplica.
- [ ] La lista de entornos (selector y Ajustes) sale en orden alfabético con tildes ("Ámbito" junto a "Alfa", no al final).
- [ ] Arrancar el zip 0.8.1 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

v0.9.0, pruebas a mano (Problemas rediseñado; se pueden hacer con el zip 0.9.0 en vez del 0.8.1):

- [ ] La lista se lee bien en claro y en oscuro: barra roja en los abiertos y verde (más fina) en los cerrados, 4 columnas y orden al pulsar cada cabecera.
- [ ] Con el teclado: Tab hasta la lista, flechas, Inicio y Fin, y Enter abre el problema; "Volver a Problemas" (o la flecha atrás) deja la lista como estaba: filtros, orden, la fila que se veía y el foco en el problema abierto.
- [ ] El detalle de un problema real muestra sus secciones (solo las que tienen datos) y la exportación XLSX abre en Excel con las hojas Resumen, Entidades, Evidencias, Impacto y Comentarios.
- [ ] Arrancar el zip 0.9.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

v0.9.1, pruebas a mano (evidencias y comentarios; se pueden hacer con el zip 0.9.1 en vez del 0.9.0):

- [ ] En un problema real, las evidencias salen agrupadas (causa raíz arriba si la hay, después por entidad) y los filtros por tipo cuentan bien.
- [ ] Si un problema real trae evidencias de métrica o de transacción, la tarjeta "antes → después" y su unidad tienen sentido. Si no lo tienen, se pasan a "Más detalles" en una 0.9.2. ("Abrir en Métricas" abre la métrica con el rango del problema.)
- [ ] Un problema con más comentarios que los recientes enseña "Ver todos" y los trae; el XLSX del detalle ya no tiene la hoja Impacto.
- [ ] Arrancar el zip 0.9.1 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

v0.9.2, pruebas a mano (mini gráfico; se pueden hacer con el zip 0.9.2 en vez del 0.9.1):

- [ ] En un problema real con un evento de alerta de métrica, el mini gráfico sale, el periodo sombreado y la línea de inicio cuadran con la evidencia y, si hay umbral, la línea discontinua está donde toca.
- [ ] "Abrir en Métricas" desde el gráfico abre esa misma consulta con ese rango, y la exportación XLSX del gráfico abre en Excel.
- [ ] Arrancar el zip 0.9.2 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

v0.10.0, pruebas a mano (tabla de evidencias; se pueden hacer con el zip 0.10.0 en vez del 0.9.2):

- [ ] En un problema real, las evidencias salen en tabla con los abiertos arriba, y se ve de un vistazo qué eventos siguen abiertos (también en un problema cerrado, si tiene alguno). Los contadores Todos/Abiertos/Cerrados cuadran y filtran.
- [ ] Desplegar un evento con el ratón y con el teclado (Enter, Tab dentro, Escape): propiedades, zonas, etiquetas y, si lo tiene, el mini gráfico. El resumen de la causa raíz salta a su fila.
- [ ] Con un filtro puesto, exportar el XLSX: la hoja Evidencias trae solo lo filtrado, en el orden de la tabla, y la hoja Info lo dice. Volver a la lista y entrar otra vez al problema deja la tabla como estaba.
- [ ] Arrancar el zip 0.10.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

v0.10.1, pruebas a mano (pantallas de error). Para verlas en desarrollo: `$env:VIGIA_E2E='1'; npm run dev` y, como la app no tiene barra de direcciones, desde la consola de DevTools (Ctrl+Mayús+I en dev): `location.hash = '#/__errors/unexpected'` (y `chunk`, `panel`, `fatal`). Con `VIGIA_E2E` la ventana se abre sin tomar el foco.

- [ ] Cada variante se ve bien en claro y en oscuro: inesperado (Reintentar, Inicio, Recargar), actualizada (cuenta atrás que se puede cancelar), 404 (`#/esto-no-existe`), panel compacto y la de último recurso (`fatal`). El faro se mueve y, con "Reducir animaciones" de Windows, se queda quieto.
- [ ] "Detalles técnicos" → "Copiar detalles": lo pegado no lleva tu usuario en las rutas (sale `<usuario>`).
- [ ] Editar un fichero con `npm run dev` abierto: si sale una pantalla, es la de "El código ha cambiado mientras Vigía estaba abierta" con Recargar, no la de React Router.
- [ ] Arrancar el zip 0.10.1 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

Fase 2:

- [x] Se navega por todas las secciones (vacías) en ambos idiomas y temas.
- [x] La barra de título propia funciona: se arrastra la ventana y los botones nativos siguen al tema.
- [x] El tema cristal se lee bien en claro y en oscuro.
- Sin probar: el material nativo de Windows 11 (`backgroundMaterial: 'mica'`), que es opcional.

Fase 3:

- [x] Crear un cliente y un entorno real, guardar un token y comprobar que tras reiniciar sigue "Configurado" y el entorno sigue activo.
- [x] Exportar la configuración, importarla en otro PC (o en una carpeta de datos vacía) y comprobar el resumen.
- [x] Con el tema "Oscuro" y Windows en claro, la barra de título ya no parpadea al arrancar.

Fase 4:

- [x] "Probar conexión" funciona contra un tenant real con token clásico (y, si se usa, OAuth y platform token), y avisa de los scopes que faltan.
- [x] Detrás del proxy corporativo y con su CA: con el nivel "sistema" conecta sin tocar nada.
- [x] La tarjeta del pie muestra el estado real y la caducidad del token OAuth.
- [x] Arrancar el zip 0.4.0 sobre sus datos: aplica la migración 0001 sin perder clientes, entornos ni credenciales.

Fase 6:

- [x] El XLSX se abre en Excel con los tipos correctos (fechas y números) y el CSV muestra bien los acentos.
- [x] Inicio, Problemas y Métricas contra un tenant real, con exportación y capturas.
- [x] El zip 0.6.0 sobre sus datos aplica la migración 0002 (consultas guardadas) sin perder nada.

### Mejoras para después de la primera versión

- Las vistas usan solo el token clásico; usar OAuth y el platform token en SaaS (ver la spec, "Funcionalidades").
- Streaming de exportaciones y aviso de filas de Excel en CSV, con DQL en la Fase 8 (ver la spec, "Exportación de datos").
- Fusible `enableEmbeddedAsarIntegrityValidation` (AUD-21): propuesto, sin activar. Solo afecta al zip y los e2e corren sobre `out/`, así que se activa cuando se pueda arrancar el zip en un perfil o una VM de prueba (nunca en el perfil de Dani).
- Particiones de red sin liberar (AUD-21): cada `reset` deja la sesión anterior hasta cerrar la app. Es una limitación de Electron; solo se anota.
- El futuro CI (AUD-15.4, lo decide Dani) tiene que instalar con `npm ci --ignore-scripts` y `npx install-electron` (ver "Primer paso al retomar").

## Primer paso al retomar

1. `npm ci --ignore-scripts` y `npx install-electron` (Electron 44 no descarga su binario al instalar; si se deja para el primer uso, los e2e en paralelo fallan), y después `npm run check` y `npm run test:e2e`. Si algo falla, arreglarlo antes de seguir. Sin `--ignore-scripts`, npm (10 y 11) intenta compilar better-sqlite3 con node-gyp, porque el lockfile no guarda su `gypfile: false`, y falla sin Visual Studio (detalles en el README). Si una dependencia nueva necesita su script de instalación, `npm rebuild <paquete>`.

## Reglas de trabajo

- Una fase cada vez; al terminarla, se continúa con la siguiente y la aceptación manual queda en la lista de pendientes de Dani.
- Las dudas de diseño, alcance dentro de una fase, orden o interpretación de la spec las deciden los agentes, y se anotan en la spec o en el CHANGELOG. Solo se escala a Dani lo destructivo o irreversible (lo aprueba él en la sesión que lo ejecuta), publicar algo nuevo hacia fuera, licencia, marca y temas legales, qué hacen las funciones sin definir, la API cuando no se puede deducir y retomar Monaco. Al cerrar cada fase, un solo resumen para Dani, sin esperar su respuesta: lo hecho, las decisiones tomadas y lo que tiene que probar a mano.
- Mientras Dani no está, peticiones decide en su nombre. Luz verde sin preguntar: lo recuperable con git que ya esté commiteado (código, dependencias exactas, node_modules, out, dist, tests, empaquetar, commits, push normal con el OK de senior y de test), lecturas del tenant de pruebas y matar procesos del equipo.
- Se pregunta a peticiones: borrar o mover lo que no está en git (`docs/especificacion.md`, `%APPDATA%\vigia`, `.env.live.local`, `..\API\` y nada fuera de `app/`), escrituras en el tenant, cambios globales en la máquina, y `git reset --hard`, `checkout --`, `clean` o `stash drop` con cambios sin commitear (salvo commit o stash previo). Antes de cada tanda grande de cambios en la spec, copia como docs/.respaldo/especificacion.AAAAMMDD-HHmm.md (carpeta ignorada), conservando las 5 últimas; borrar las más antiguas de esa carpeta está autorizado, y nada más.
- Carpeta de datos por modo: el zip usa `%APPDATA%\vigia`, `npm run dev` usa `%APPDATA%\vigia-dev` y cada e2e su carpeta temporal (VIGIA_USER_DATA_DIR, solo sin empaquetar). Es normal que en dev no aparezcan los datos del zip.
- Solo lo decide Dani: force push, reescribir el historial publicado, borrar ramas remotas, tags, releases, publicar el zip, licencia y temas legales, y el qué de las funciones sin definir. El zip nunca se arranca en su perfil.
- La API de cada módulo (v1, v2 o plataforma) se deduce de `..\API\` y de la documentación oficial; solo si no se puede deducir, se pregunta a Dani. La elección se anota.
- El repositorio es público. Push automático: solo `git push origin main`, y solo después del visto bueno de senior y de test. Nunca `--force` ni `--force-with-lease`. Sin tags, releases ni subir el zip a GitHub (se escala a Dani). Antes de cada push, `npm run scan:tenant` (busca restos del tenant de pruebas sin mostrar sus valores) y revisar el contenido sensible: autor y committer noreply, sin `docs/especificacion.md`, sin nombres de clientes, secretos, URLs o IDs de tenants reales, logs ni `.env`.
- Pruebas en vivo (`npm run test:live`): solo lectura aunque el token permita escribir. Todo `*.live.test.ts` pasa por `createLiveClient`, cuya guarda rechaza antes de la red cualquier método que no sea GET salvo `POST /apiTokens/lookup`. Una petición detrás de otra, `pageSize` de 500 como máximo y pocas páginas. Nunca leer ni mostrar `.env.live.local` (solo lo carga el proceso de test); nada del tenant (nombres, IDs, URLs, valores) en el repositorio, en fixtures ni en mensajes entre sesiones. Los informes van a `live-reports/` (ignorado) y se resumen sin datos del tenant. En notas y fixtures, solo tipos estándar de Dynatrace: los tipos de entidad, métricas, SLOs y eventTypes personalizados o de extensión se describen por su forma y se cuentan, nunca por su nombre (ni en el informe local).
- Niveles de prueba. Durante el desarrollo: `npm run check` y `npm run test:e2e:affected` (mientras se itera, `vitest related <ficheros>` o `--changed`).
- Validación por BLOQUES: dev pasa a test un rango de commits cuando cierra algo lógico, no cada commit, con la salida de su `check` y su `test:e2e:affected`. test repite solo `check` (es barato) y lo afectado en su worktree, no lo que dev ya ejecutó.
- Si el cambio es transversal (lo decide `e2e/areas.json`): e2e completo. Los locales y `main.css` no son transversales: los cubren el test de paridad y el de contraste (los dos en `check`) y disparan el área shell, más la del módulo si el diff toca uno. `scripts/**` está en ignore porque solo contiene herramientas de desarrollo; un script que intervenga en el build o el empaquetado va a `build/` o se saca del ignore.
- `--repeat-each` solo si se toca temporización (esperas, animaciones, virtualización, navegación) o hubo un fallo intermitente: ×3 en ese spec.
- Al cerrar una versión: e2e completo dos veces, `--repeat-each 3` en los specs cambiados y `npm run dist:win`.
- Clon limpio (en el scratchpad, con la instalación del README, `npm run check`, `npm run test:e2e` completo y `npm run dist:win`) solo si cambian las dependencias, el empaquetado o la instalación (`package*.json`, scripts de npm, electron-builder). Comprobarlo en el árbol de trabajo no basta: ahí ya está todo instalado.
- test valida el rango que le pasa dev en un worktree propio (en su scratchpad); dev no espera a que termine y sigue en su árbol.
- Un criterio de aceptación manual no se da por cumplido; solo lo confirma Dani.
- No inventar endpoints ni parámetros de Dynatrace o de Monaco: consultar `..\API\` y la documentación oficial.
- Nunca escribir secretos, cabeceras `Authorization` ni cookies en logs, ficheros de configuración, mensajes de error ni en el repositorio.
- Sin definición cerrada no se implementan: Service flows avanzados, Vista de negocio, notificaciones, Favoritos y variación de los KPI.
- Commits pequeños por funcionalidad, con tests para la lógica de main.
- Dependencias con versión exacta: `npm install --save-exact <paquete>`.
- Comentarios, textos de interfaz y documentación en español; identificadores en inglés.
- Al cerrar una fase: subir la versión menor en `package.json` y `CHANGELOG.md` (Fase N → 0.N.0), y actualizar "Estado actual" de este fichero y, si cambia algo de lo acordado, `docs/especificacion.md`. Tags, releases y subir el zip a GitHub se escalan a Dani.

## Comandos

| Comando                                | Qué hace                                                          |
| -------------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                          | App en desarrollo con recarga en caliente                         |
| `npm run check`                        | Lint, tipos, formato y tests unitarios con umbral de cobertura    |
| `npm run test:e2e`                     | Compila y prueba la app de punta a punta (Playwright)             |
| `npm run build`                        | Tipos y compilación a `out/`                                      |
| `npm run dist:win`                     | Zip de Windows en `dist/`                                         |
| `npm run format`                       | Prettier                                                          |
| `npm run test:e2e:affected -- [rango]` | Solo los e2e afectados (`e2e/areas.json`), compilando una vez     |
| `npm run test:e2e:nobuild`             | e2e sin compilar (si solo cambian los specs y `out/` está al día) |
| `npm run test:live`                    | Pruebas de solo lectura contra el tenant de pruebas               |
| `npm run scan:tenant`                  | Busca restos del tenant de pruebas (antes de cada push)           |

Antes de dar una tarea por terminada: `npm run check` (ya incluye `format:check` y la cobertura de main y shared con umbral, ver `vitest.config.ts`) y `npm run test:e2e:affected` (o `npm run test:e2e` si el cambio es transversal). Playwright no reintenta y rechaza `test.only`.

## Arquitectura

Tres procesos. Solo main accede a red, disco, procesos externos y secretos; la interfaz lo pide todo por IPC.

- `src/shared/ipc.ts`: contrato IPC. Cada canal tiene esquema Zod de entrada y de salida. TypeScript no compila si falta la implementación de un canal.
- `src/main/ipc/handler.ts`: envoltorio común de todos los canales (remitente de confianza, entrada, salida, errores sin detalle hacia el renderer). No importa Electron, para poder probarlo con Vitest.
- `src/main/ipc/handlers/`: implementaciones. Reciben sus dependencias de Electron inyectadas.
- `src/main/security/`: CSP, orígenes de confianza, navegación y rutas del protocolo `app://`.
- `src/preload/index.ts`: expone solo `window.vigia.invoke`. Nunca se entrega `ipcRenderer` a la interfaz.
- `src/renderer/`: React. No puede importar `electron`, `node:*` ni código de main o del preload (lo impide ESLint). Llama a main con `invoke()` de `src/renderer/src/lib/ipc.ts`.

Patrón para código nuevo de main: la lógica en módulos puros con tests, y el uso de Electron en una capa fina aparte.

Errores hacia la interfaz: main no traduce. Todo `DtError` o `DomainError` nuevo con texto para el usuario lleva `reason` (clave de `src/shared/error-reasons.ts` con su texto en `errorReasons.*` de es y en); su `message` en español es para el log. Solo los que llevan el texto propio de Dynatrace van sin `reason`, en la lista blanca de `src/main/error-reasons.test.ts`, que falla si alguno lo olvida.

## Cosas que ya se aprendieron

- **La tilde de "Vigía" no puede acabar en una cabecera HTTP ni en una ruta.** Electron mete el nombre de la app en el User-Agent y eso rompía el protocolo `app://`. Está resuelto en `src/main/user-agent.ts`. Para todo lo técnico se usa `vigia`.
- `URL.origin` devuelve `"null"` para `app://`. Los orígenes se comparan con `originOf` (`src/main/security/origins.ts`).
- El preload corre en sandbox y solo puede cargar `electron`, `events`, `timers` y `url`. Por eso `electron.vite.config.ts` tiene `externalizeDeps: false` en el preload.
- La CSP se envía como cabecera, no como etiqueta `meta`: en producción la pone el protocolo `app://` y en desarrollo `hardenDefaultSession`. Cualquier ampliación se anota en `src/main/security/csp.ts` con su motivo; nunca `unsafe-eval` ni orígenes remotos.
- Los permisos web están denegados para todo (`src/main/security/harden.ts`). Si una fase necesita uno (por ejemplo, portapapeles desde la interfaz), se concede ahí de forma explícita.
- Con los fusibles de Electron activos, Playwright no puede adjuntarse a la app empaquetada. Las pruebas e2e corren sobre `out/`, sin empaquetar.
- electron-vite 5 no admite Vite 8. No subir Vite, TypeScript (7) ni ESLint (10) sin comprobar la compatibilidad de electron-vite y de typescript-eslint.
- better-sqlite3 13 trae binarios precompilados N-API dentro del paquete: no hace falta recompilar ni `electron-builder install-app-deps`, y funciona igual en Vitest y en Electron. En el zip va fuera del asar (`asarUnpack`) y solo con el binario win32-x64.
- Tras cambiar `src/main/db/schema.ts`: `npm run db:generate` y commitear la migración nueva. Main aplica las migraciones al arrancar (en la app empaquetada, desde `resources/migrations`).
- `lower()` de SQLite solo pasa a minúsculas ASCII: los nombres únicos se comprueban en JS con `toLocaleLowerCase('es')`.
- Los e2e corren con 4 workers. `views` es el único spec que usa el portapapeles del sistema; sus tests corren en un mismo worker (sin `fullyParallel`), así que no necesitan modo serie. Otro spec que lo use va en un proyecto aparte. Con `--repeat-each`, `views` va con `--workers=1`: si no, dos copias se pisan el portapapeles, y una podría restaurar el PNG de la otra en vez del de Dani.
- Cada e2e usa su propia carpeta de datos (`VIGIA_USER_DATA_DIR`): el bloqueo de instancia única va por carpeta, así que no chocan con un `npm run dev` abierto.
- Las rutas de Windows van entre comillas invertidas (`%APPDATA%\vigia`) y los documentos se editan con las herramientas de edición: una ruta escrita desde la shell perdió `\v`, que se convirtió en un carácter de control (0x0B). Un test de `npm run check` falla si un fichero versionado de texto tiene caracteres de control.
- `Set-Content -Encoding utf8` de PowerShell 5.1 escribe BOM, y `Get-Content -Raw` sin `-Encoding utf8` lee los ficheros como ANSI y estropea las tildes al reescribirlos. Para editar ficheros, usar las herramientas de edición, `sed` o `node`.
- Electron cachea el resultado de `setCertificateVerifyProc` y no hay forma de borrarlo: desde la PR #26517 (2020) volver a llamarlo ya no limpia la caché, y el issue #41448 (pedir esa API) sigue abierto. Por eso cada cambio de nivel o de huellas de un entorno crea una partición nueva en memoria `env-<id>-<generación>` (`src/main/dynatrace/network.ts`). Fuentes: https://www.electronjs.org/docs/latest/api/session, https://github.com/electron/electron/pull/26517 y https://github.com/electron/electron/issues/41448.
- El verificador de certificados solo ve el nombre del host, sin puerto; las huellas se guardan con `URL.host` (con puerto) y se comparan por nombre.
- Con `asChild` de Radix (Slot), el hijo no puede recibir `className` ni `style` como función: Slot los fusiona como cadena. Para NavLink, el estado activo se pinta con `aria-[current=page]`.
- Electron 44 cambió el portapapeles al estilo W3C: `clipboard` de main solo tiene `clear`, `has`, `read`, `readText`, `write` y `writeText` (asíncronos). Ya no hay `readImage` ni `writeImage`: una imagen se copia con `clipboard.write([new ClipboardItem({ "image/png": blob })])`.
- Las vistas de datos no se refrescan solas (`staleTime: Infinity`, `refetchOnMount: false`): cada petición gasta cuota de la API. Solo "Actualizar" o una clave nueva (entorno, filtros, rango) piden datos.
- Cambios hechos por IPC directo (`window.vigia.invoke`) no actualizan la interfaz: TanStack Query solo se entera de las mutaciones que hace el renderer. En los e2e, recargar tras preparar datos por IPC.
- En producción no hay menú (`Menu.setApplicationMenu(null)`), así que tampoco hay atajos de recarga ni DevTools.
- Las librerías solo del renderer van en devDependencies: Vite las empaqueta y electron-builder metería en el asar todo lo de dependencies.
- `useVirtualizer` de TanStack Virtual hace que el React Compiler se salte el componente (aviso `react-hooks/incompatible-library`): es lo esperado y se desactiva el aviso en esa línea con su motivo.
- En PowerShell, `git commit -F -` con un here-string no lee el mensaje de la entrada: escribir el mensaje en un fichero y usar `git commit -F <fichero>`.
- Si `npm run dist:win` falla en Windows con un error de enlaces simbólicos, hace falta el Modo de desarrollador de Windows o una terminal de administrador.

## Versiones fijadas

Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6, React 19.3.0, TypeScript 5.9.3, Zod 4.6.5, electron-log 5.4.4, Vitest 5.0.3 (con @vitest/coverage-v8 5.0.3), Playwright 1.63.0, electron-builder 26.15.3, ESLint 9.39.5, React Router 8.4.0, Zustand 5.0.15, i18next 26.4.2, react-i18next 17.0.15, Tailwind CSS 4.3.3, Motion 14.0.0, cmdk 1.1.1, lucide-react 1.51.0, better-sqlite3 13.0.3, Drizzle ORM 0.45.3, drizzle-kit 0.31.11, TanStack Query 5.104.1, TanStack Virtual 3.14.13, react-hook-form 7.89.0, selfsigned 5.5.0 (solo tests), ExcelJS 4.4.0 (main), ECharts 6.1.0. Node 22 o superior.

`npm audit` (2026-10-04): 14 avisos en total (6 moderados y 8 altos), todos de herramientas de desarrollo o empaquetado (http-cache-semantics vía `@electron/get`, `esbuild` vía `drizzle-kit`, `uuid`) salvo dos. `npm audit --omit=dev` da 2 moderados: `uuid` anterior a 11.1.1 (GHSA-w5hq-g745-h8pq) a través de ExcelJS 4.4.0. No es alcanzable: el fallo está en `v3`, `v5` y `v6` con `buf`, y ExcelJS solo usa `v4`. No forzar overrides; revisar al subir ExcelJS o electron-builder. Deuda anotada: npm marca ESLint 9.39.5 como sin soporte (no subir a 10 sin typescript-eslint y electron-vite compatibles).
