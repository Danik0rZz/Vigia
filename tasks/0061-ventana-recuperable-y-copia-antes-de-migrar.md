---
id: '0061'
titulo: 'La ventana se recupera si el renderer cae, y copia de la base antes de migrar'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-robustez
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0061-ventana-recuperable-y-copia-antes-de-migrar
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «auditoria-robustez» (0060 a 0062), de la revisión de código del 2026-10-09 (hallazgos C-05 y
C-06). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario.

## Especificación

**1. Renderer caído (C-05).** No hay oyentes de `render-process-gone` ni `unresponsive` en
`src/main`, y en producción no hay menú (`Menu.setApplicationMenu(null)`), así que no hay atajo de
recarga: si el proceso de la interfaz muere (memoria, GPU, un fallo de Chromium), la ventana queda en
blanco y solo se puede cerrar la app, sin nada en el log.

- Política en una función pura (por ejemplo `src/main/crash-policy.ts`) con test: ante
  `render-process-gone` con `reason` distinto de `clean-exit` y `killed`, registrar `reason` y
  `exitCode` en el log y **recargar una vez**; si vuelve a caer en menos de un minuto, diálogo de
  error (`dialog.showErrorBox`, texto en es o en según el idioma guardado) que remite al log, y
  cerrar.
- `unresponsive`: tras unos segundos, diálogo con «Esperar» y «Cerrar».
- La capa de Electron (`window.ts`) solo llama a la política.

**2. Copia antes de migrar (C-06).** `src/main/db/database.ts` abre `vigia.db` y aplica las
migraciones pendientes al arrancar, sin copia previa. La base guarda clientes, entornos, huellas,
consultas guardadas y los secretos cifrados. Drizzle aplica cada migración en transacción, pero una
migración que "acaba bien" y deja datos mal solo se ve después.

- Antes de `migrate`, si el fichero existe **y hay migraciones pendientes**, copia con la API de
  better-sqlite3 (`sqlite.backup(...)`, consistente con WAL) a `%APPDATA%\vigia\backups\`, con el
  nombre de la migración, y conservar las **3** últimas. Registrar la ruta en el log.
- `docs/ARCHITECTURE.md` (doc-writer): dónde están las copias y cómo restaurar (cerrar la app y
  copiar encima).

## Criterios de aceptación

- CA1 (unitario): la política recarga en la primera caída, muestra el diálogo y cierra en la segunda
  antes de un minuto, y vuelve a recargar si pasa más de un minuto; no hace nada con `clean-exit` ni
  `killed`.
- CA2 (unitario): con una base en un fichero temporal y una migración pendiente, se crea la copia y
  la base sigue funcionando; sin migraciones pendientes no se crea nada.
- CA3 (unitario): con cuatro copias se borra la más antigua.
- CA4 (unitario): textos nuevos de los diálogos en es y en.

## Pruebas a mano para Dani

- En desarrollo, matar el proceso de la interfaz desde el Administrador de tareas y ver que la
  ventana se recarga sola.

## Fuera de alcance

- Restaurar una copia desde la app.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Comprobado en `main` (2026-10-10) que lo descrito sigue igual: sin oyentes de `render-process-gone`
ni `unresponsive` en `src/main`, y `openDatabase` migra sin copia previa.

Tests escritos en `ce9fd08` (`test(main): criterios de la ficha 0061`); fallan porque faltan
`src/main/crash-policy.ts` y `src/main/db/backup.ts`.

- CA1: `src/main/crash-policy.test.ts`, «CA1 (0061)» (primera caída recarga y deja `reason` y
  `exitCode` en el log; segunda antes de un minuto, diálogo y después cierre; pasado el minuto,
  recarga otra vez; el minuto cuenta desde la última recarga; `clean-exit` y `killed` no hacen nada
  ni cuentan).
- CA2: `src/main/db/backup.test.ts`, «CA2 (0061)» (base en carpeta temporal migrada con un journal
  sin la última migración: copia con el nombre de la migración pendiente, con los datos de antes, la
  ruta en el log y la base se migra después; sin pendientes o sin fichero, nada; si la copia falla,
  rechaza, lo registra y la base queda intacta).
- CA3: `backup.test.ts`, «CA3 (0061)» (cuatro copias → se borra la primera; los ficheros ajenos de
  la carpeta no se tocan).
- CA4: `crash-policy.test.ts`, «CA4 (0061)» (mismas claves en es y en, traducidas; el mensaje de
  caída remite al log; «Esperar»/«Cerrar» y «Wait»/«Close»; el diálogo de la política sale en el
  idioma dado).

Decisiones del test-writer (Dani delegó; conservadoras y refinables):

- API de la política: `createCrashPolicy({ now, logger, reload, showErrorBox, quit, language })`
  con `renderProcessGone({ reason, exitCode })`; textos en `crashTexts(language)` con, al menos,
  `goneMessage`, `unresponsiveMessage`, `wait` y `close` (`CrashLanguage` = `'es' | 'en'`). La
  política muestra el diálogo y luego cierra; `window.ts` solo le pasa lo de Electron.
- «Idioma guardado»: el idioma vive en el `localStorage` del renderer, que main no lee. La política
  lo recibe como `language()`; de dónde lo saca main lo decide el developer (anotarlo). No se pide
  canal IPC nuevo por esto.
- `unresponsive` no tiene criterio propio: solo se prueban sus textos (CA4); los segundos de espera
  los fija el developer.
- Copia: `backupBeforeMigrations({ file, migrationsFolder, backupDir, logger, now? })` en
  `src/main/db/backup.ts`, asíncrona (porque `sqlite.backup` lo es) y aparte de `openDatabase`, que
  sigue síncrona (la usan los tests con `:memory:`). Devuelve la ruta de la copia o `null`.
- Sin pérdida de datos: **si la copia falla (también sin espacio), no se migra**: la función rechaza
  y lo registra, y el arranque cae en el diálogo ya existente de «No se pudo abrir la base de datos
  local». La poda de copias viejas va después de una copia correcta (no se puede probar sin forzar el
  fallo a mitad: queda para el reviewer). Se conservan 3 y solo se borran ficheros creados como
  copia, nunca otros de la carpeta.
- Sin espacio en disco no se simula: es el mismo camino que cualquier fallo de la copia.

Decisiones del developer (Dani delegó; conservadoras y refinables):

- Idioma de los diálogos de main: `crashLanguageFromLocale(app.getLocale())`: `en*` → inglés, el
  resto → español (el mismo valor por defecto que la interfaz). No lee el idioma elegido en la app
  (vive en el `localStorage` del renderer); afinarlo pediría guardarlo en main por IPC.
- Caída: el minuto se cuenta desde la última recarga; tras decidir cerrar se ignoran más avisos.
  `reload` es `webContents.reload()`; `quit`, `app.quit()`.
- `unresponsive`: `createUnresponsivePolicy` en `crash-policy.ts`, con tests propios en
  `src/main/crash-policy-unresponsive.test.ts`. Espera 5 s (`UNRESPONSIVE_DELAY_MS`); si sigue
  colgada, `showMessageBox` con «Esperar» (por defecto y al cancelar) y «Cerrar»; con «Esperar»
  vuelve a preguntar a los 5 s si sigue colgada; si responde entre medias, no pregunta. «Cerrar» hace
  `window.destroy()` (una interfaz colgada no contestaría a `beforeunload`), y la app se cierra por
  `window-all-closed`.
- Copia: nombre `vigia-<AAAAMMDDThhmmssmmmZ>-<última migración pendiente>.db` (fecha UTC primero,
  orden alfabético = cronológico) en `<userData>\backups` (`databaseBackupsDir()` en `paths.ts`).
  Pendientes = entradas del journal con `when` mayor que el último `created_at` de
  `__drizzle_migrations` (lo mismo que compara Drizzle). Nunca pisa un fichero existente; una copia a
  medias (solo la suya) se borra; la poda solo mira ficheros con ese patrón y, si falla, se registra
  y se arranca igual (la copia buena ya está). El arranque (`index.ts`) espera a la copia antes de
  `openLocalData`, dentro del mismo `try` del diálogo «No se pudo abrir la base de datos local».
- `src/main/crash-policy.ts` va en `transversal` de `e2e/areas.json`, junto a `window.ts`
  (`backup.ts` ya entra por `src/main/db/**`).

## Resultado

(pendiente)
