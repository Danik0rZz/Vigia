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
- La guarda de las pruebas en vivo (`src/test/live-usage.test.ts`) toma cualquier literal suelto
  `'http'` o `'https'` por un import de red: en un `*.live.test.ts`, escribir los esquemas sin ese
  literal (por ejemplo `'http:'`).
- `GET /problems` con `affectedEntities("<id>"),status("open")`: los criterios se combinan con AND y
  `pageSize=1` ya trae `totalCount`; para contar no hace falta paginar (ficha 0007).
- `GET /metrics/query`: `:fold(...)` y `resolution=Inf` en la misma consulta dan 400; para el valor
  de todo el rango, `Inf` (tiempos) o sumar la serie (recuentos; en los monitores, los recuentos con
  `Inf` difieren menos del 1 % de la suma). Cada expresión del canal tiene que ser exactamente la
  probada en vivo: el simulador acepta variantes que la API puede no aceptar (ficha 0022).
  `dataPointCountRatio` y
  `dimensionCountRatio` son «pedido / máximo permitido» y llegan siempre: recortado es un ratio
  **mayor que 1**, no menor (`truncatedResults`, ficha 0006).
- `GET /metrics/query`: los nombres de disco y proceso solo llegan con `:names` en cada expresión;
  `:last` con `resolution=Inf` da 400 (ficha 0017, `docs/notas-api-v2.md`).
- `GET /metrics/query`: con `entitySelector=entityId(...)`, una métrica puede devolver series de otras entidades si esa dimensión no es su principal (`browser.duration`); comprobarlo en vivo y acotar con `:filter(eq(...))` (ficha 0023, `docs/notas-api-v2.md`).
- `GET /metrics/query` por proceso: `network.packets.retransmissionIn/Out` y `network.sessions.connectivity` dan 400 con `resolution=Inf`, y las métricas sin dimensión de proceso (`handles.fileDescriptorsPercentUsed.new`, `mem.usage.new`) traen series de otros procesos con `entityId(...)`. `COMMAND_LINE_ARGS` y `EXE_PATH` van en `metadata` de la entidad y no se muestran (ficha 0027, `docs/notas-api-v2.md`).
- Toda propiedad de entidad pasa por `entity-secrets.ts` (desde `toEntityData`) antes de llegar a la interfaz: quita línea de comandos, argumentos, entorno y rutas de ejecutable, que pueden llevar contraseñas, tokens o el nombre del usuario. Una clave nueva con ese riesgo se añade ahí, con su test (ficha 0029).
- La guarda del contrato IPC contra secretos (`tenants.test.ts`) marca por nombre cualquier campo `value`, `token`…; si un campo legítimo cae en ella (el `value` de una etiqueta), se permite por ruta exacta (`canal.campo[].sub`) y con su motivo, nunca por patrón (ficha 0037).
