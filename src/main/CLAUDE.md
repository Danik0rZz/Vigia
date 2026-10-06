# Reglas de src/main/

- La lógica en módulos puros con tests (umbral de cobertura en `vitest.config.ts`), y el uso de
  Electron en una capa fina aparte. Los handlers reciben sus dependencias de Electron inyectadas.
- No inventar endpoints ni parámetros de Dynatrace: consultar `..\API\` (buscar en las OpenAPI, no
  leerlas enteras) y la documentación oficial. Si no se puede deducir, se pregunta a Dani.
- `URL.origin` devuelve `"null"` para `app://`. Los orígenes se comparan con `originOf`
  (`src/main/security/origins.ts`).
- Tras cambiar `src/main/db/schema.ts`: `npm run db:generate` y commitear la migración nueva. Main
  aplica las migraciones al arrancar (en la app empaquetada, desde `resources/migrations`). Una
  migración nueva es una prueba a mano para Dani (arrancar el zip sobre sus datos).
- `lower()` de SQLite solo pasa a minúsculas ASCII: los nombres únicos se comprueban en JS con
  `toLocaleLowerCase('es')`.
- Electron cachea el resultado de `setCertificateVerifyProc` y no hay forma de borrarlo: cada cambio
  de nivel o de huellas de un entorno crea una partición nueva en memoria
  `env-<id>-<generación>` (`src/main/dynatrace/network.ts`, ADR-0003).
- El verificador de certificados solo ve el nombre del host, sin puerto; las huellas se guardan con
  `URL.host` (con puerto) y se comparan por nombre.
- Electron 44 cambió el portapapeles al estilo W3C: `clipboard` de main solo tiene `clear`, `has`,
  `read`, `readText`, `write` y `writeText` (asíncronos). Ya no hay `readImage` ni `writeImage`:
  una imagen se copia con `clipboard.write([new ClipboardItem({ "image/png": blob })])`.
- En producción no hay menú (`Menu.setApplicationMenu(null)`), así que tampoco hay atajos de recarga
  ni DevTools.
