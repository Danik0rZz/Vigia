# Reglas de e2e/

- Playwright corre sobre `out/` (la app compilada, sin empaquetar): con los fusibles de Electron
  activos no puede adjuntarse a la app empaquetada (ADR-0006). Playwright no reintenta y rechaza
  `test.only`.
- Cada test lleva en su nombre el criterio de su ficha: `CA3 (0012): ...`. Si no imaginas cómo
  podría fallar un test, ese test no prueba nada.
- Cada e2e usa su propia carpeta de datos (`VIGIA_USER_DATA_DIR`): el bloqueo de instancia única va
  por carpeta, así que no chocan con un `npm run dev` abierto. Con `VIGIA_E2E` las ventanas no
  toman el foco del sistema.
- Los e2e corren con 4 workers. `views` es el único spec que usa el portapapeles del sistema; sus
  tests corren en un mismo worker (sin `fullyParallel`), así que no necesitan modo serie. Otro spec
  que lo use va en un proyecto aparte. Con `--repeat-each`, `views` va con `--workers=1`: si no, dos
  copias se pisan el portapapeles.
- Cambios hechos por IPC directo (`window.vigia.invoke`) no actualizan la interfaz: TanStack Query
  solo se entera de las mutaciones que hace el renderer. Recargar tras preparar datos por IPC.
- Datos de Dynatrace solo del simulador: nada del tenant (nombres, IDs, URLs, valores) en specs ni
  fixtures. En fixtures, solo tipos estándar de Dynatrace.
- Un fichero nuevo de `src/` necesita su área en `e2e/areas.json` (o queda "sin área" y dispara el
  e2e completo). `--repeat-each 3` solo si se toca temporización (esperas, animaciones,
  virtualización, navegación) o hubo un fallo intermitente.
