---
id: '0061'
titulo: 'La ventana se recupera si el renderer cae, y copia de la base antes de migrar'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(pendiente)

## Resultado

(pendiente)
