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
- Lo que dependa de la geometría se prueba con el contenido de la ventana fijado desde el test
  (`withContentSize` en `views.spec.ts`): el runner del CI tiene pantalla de 1024×768 y recorta la
  ventana, así que sin fijarla ve otra geometría que la VPS.
- Si la cabecera u otro elemento «intercepta» un clic, mirar antes si con esa ventana el control se
  ve de verdad: en la 0005 era un fallo de la app (la ruta quedaba en 0 px), no del test.
- Una exportación se lee tras el aviso «Guardado» y con el fichero no vacío (`exportSaved`): main
  crea el fichero al empezar `writeFile`, así que su nombre aparece antes de tener contenido.
- Tras `runMetric`, `data-series` se lee con espera (`toHaveAttribute`): el gráfico se monta con la
  serie vacía mientras la consulta no ha respondido.
- No hacer clic en una fila mientras la página se recoloca (por ejemplo, al salir la barra de
  scroll): `locator.click` reintenta desplazando la lista y cambia la fila de arriba. Usar
  `clickInPlace` sobre una fila del centro.
- Una hora escrita en un campo de fecha se interpreta en la zona del equipo: lo esperado se calcula
  con `wallTimeToEpoch` en la zona del renderer, nunca suponiendo Madrid (el CI está en UTC).
- `withContentSize` acepta hasta 2 px de redondeo de Windows al escalar y pasa el tamaño real al cuerpo.
- En Windows, desde Git Bash `TZ=Europe/Madrid` no llega al proceso (MSYS lo descarta; `TZ=UTC` sí): para
  zonas con barra, PowerShell (`$env:TZ`) o Node.
- El runner del CI tiene pantalla de 1024×768 y la ventana sale más pequeña: un elemento puede quedar
  fuera de la vista; antes de pulsar, traerlo a la vista (`clickInPlace(…, { scroll: true })`).
- El tooltip de Radix se cierra si se desplaza su contenedor, y `focus()` desplaza: primero traer el
  elemento a la vista y después abrir el tooltip.
- Un test no debe suponer el ancho de la ventana para decidir qué se ve: medir el sitio real del elemento (como `expectIdRule` en la 0013). Una precondición que dependa de la fuente del sistema puede fallar en el runner (Windows Server).
