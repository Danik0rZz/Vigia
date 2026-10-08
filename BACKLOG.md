# Backlog

Qué viene. Lo mantienen el Planificador (fichas nuevas) y el doc-writer (al cerrar una ficha). Lo
que ya se hizo está en `CHANGELOG.md`; las fichas, en `tasks/`. Nada pasa a "Próximo" sin el visto
bueno de Dani o de peticiones en su nombre.

## En curso

- Cola aprobada por Dani el 2026-10-07 (de noche, sin esperar a Dani): host (0016–0020, hecho) → lote **monitores** (0022 a 0026, hecho)
  ([0022](tasks/0022-monitores-exploracion-datos.md)–[0026](tasks/0026-monitores-informacion.md),
  browser y HTTP monitor) → lote **proceso**
  ([0027](tasks/0027-proceso-exploracion-datos.md), hecha–[0028](tasks/0028-proceso-marcadores-graficos.md), hecha–[0029](tasks/0029-proceso-informacion.md)).

## Próximo

(vacío: Dani elige de "Propuestas")

## Propuestas

Con su análisis (API, scopes, esfuerzo, riesgos y decisiones que necesitan de Dani) en
`docs/propuestas-siguientes.md`.

- Eventos en el detalle del problema (propuesta 2, S). Necesita antes una prueba en vivo de solo
  lectura de `evidenceDetails`.
- Agrupar Problemas por clúster (propuesta 3, S). Reabre la decisión de "sin agrupar".
- Gráfico de las evidencias de métrica METRIC (propuesta 4 bis, S o M).
- Unidad en los mini gráficos y en Métricas (propuesta 4 ter, S).
- Fusible de integridad del asar (propuesta 6, S). Necesita un perfil o una máquina virtual de
  prueba para arrancar el zip.
- Vista de Entidades (propuesta 1, L). Pide `entities.read`.
- Fase 8: DQL y Logs (propuesta 4, L). Coste por GiB escaneado; incluye el streaming de
  exportaciones y el aviso de filas de Excel en CSV.

## Mejoras anotadas

- Las vistas usan solo el token clásico; usar OAuth y el platform token en SaaS (ver la spec,
  "Funcionalidades").
- Particiones de red sin liberar (AUD-21, ADR-0003): cada `reset` deja la sesión anterior hasta
  cerrar la app. Es una limitación de Electron; solo se anota.
- Guarda de las pruebas en vivo (`src/test/live-usage.test.ts`): limitar los patrones de módulos de
  red a `from`, `import(` y `require(`, y prohibir en `*.live.test.ts` un `import(` o `require(` con
  argumento no literal. Quita falsos positivos (tomaba los literales `'http'` y `'https'` de un test
  por un import de red) y cierra el atajo del nombre calculado. (surgió en 0001)
- Descripción del evento: si algún día aparecen descripciones de más de 5 000 caracteres, la nota
  de recorte podría ofrecer pedir la descripción entera a main bajo demanda. (surgió en 0001)
- El recorte de la descripción del evento (`slice`) puede partir un emoji por la mitad: retroceder
  una posición si cae en un sustituto alto. Poco probable con el tope de 5 000. (surgió en 0001)
- `remark-gfm` pinta las notas al pie con textos fijos en inglés (`Footnotes` y su aria-label): se
  pueden pasar sus etiquetas con `t()`. (surgió en 0001)
- El aviso de «Copiado» de la descripción no se borra hasta plegar la fila (coherente con las
  pantallas de error); valorar que desaparezca solo. (surgió en 0001)
- e2e de la descripción del evento: activar «Copiar» también con Espacio, no solo con Enter (antes
  se probaba sobre los botones del conmutador). (surgió en 0002)
- La barra superior no enseña ruta en `#/entities/...` (no cuelga de ninguna sección de
  `NAV_SECTIONS`): se podría poner "Problemas › P-NNN › nombre de la entidad" cuando se llega desde
  un problema. (surgió en 0003)
- `EntityPage.tsx:8`: nombrar la regla `react-hooks/static-components` en el comentario que
  explica el `createElement`. (surgió en 0003)
- `EntityPageFrame`: sacar el nombre del tipo de la `labelKey` del registro, para tener una sola
  fuente. (surgió en 0003)
- Aviso por Telegram en otros momentos (cada ronda de revisión, CI en rojo después del push), que
  quedaron fuera de la ficha. (surgió en 0004)
- Recibir órdenes o lanzar tareas desde Telegram (Remote Control o Channels): estudiarlo aparte.
  (surgió en 0004)
- `entities:problemCounts`: el motivo `entityProblemsRejected` envuelve hoy también 401, 403 y 5xx;
  limitarlo a 400. (surgió en 0007)
- Ficha 0007: las "Decisiones del developer" quedaron fuera de su sitio; en las fichas siguientes,
  ponerlas junto a la "Verificación". (surgió en 0007)
- e2e CA2 de la ventana pequeña: comprobar también que el botón «Buscar» (solo con la lupa) se ve y
  tiene nombre accesible. (surgió en 0005)
- e2e de Métricas (AUD-13 y CA8): fijar el porcentaje del aviso («alrededor del 67 %» con ratio
  1,5). (surgió en 0006)
- `entities:serviceMetrics`: prefijar en español el `message` del `catch`, como en la 0007.
  (surgió en 0006)
- e2e intermitente `views.spec.ts:2482` («v0.10.0: tabla de evidencias: estado propio por evento
  en un problema cerrado»): falló una vez en la tirada completa y pasó 3/3 aislado; causa sin
  investigar. (surgió en 0006)
- `service-format.ts` está en `src/renderer/src/lib/**`, que cuenta como transversal y obliga a
  correr el e2e completo; moverlo a `pages/entities/`. (surgió en 0008)
- Fichas: poner las «Decisiones del developer» en su propia sección, no dentro de «Ideas surgidas».
  (surgió en 0008)
- Marcadores del servicio: si fallan las métricas salen cuatro `role="alert"` a la vez; dejar uno
  solo. (surgió en 0008)
- `entities:serviceMetrics`: que main devuelva `requests: null` en los totales cuando no hay
  datos, en vez de que la interfaz lo deduzca de la serie (`hasRequestData`). (surgió en 0008)
- Gráficos del servicio: la exportación XLSX lleva los valores ya convertidos (ms y /min); añadir una
  nota en la hoja Info o un módulo `entities` en `exportModules`. (surgió en 0009)
- Clave `entities.service.charts.loadError` sin usar en es y en: usarla o quitarla. (surgió en 0009)
- «Abrir en Métricas» de Actividad: la API v2 admite expresiones aritméticas, así que podría abrir OK
  como `(peticiones)-(errores)`; probarlo en vivo antes. (surgió en 0009)
- Franja de problemas: no pedir la lista de problemas cuando no hay acceso a Métricas
  (`ServiceEntityPage.tsx:34`). (surgió en 0010)
- Franja de problemas: un texto propio de la franja en el aviso de error, en vez del genérico
  (`ProblemBand.tsx:46-58`). (surgió en 0010)
- `withContentSize` (`e2e/views.spec.ts`): comentar que hoy ningún cuerpo usa el tamaño real
  (`actual`) que recibe. (surgió en 0011)
- Franja de problemas: con el ancho mínimo, dos problemas cortos y seguidos en la misma fila pueden
  quedar uno encima del otro (el reparto de filas cuenta el tiempo, no el ancho pintado). (surgió
  en 0013)
- e2e «CA4 (0013)»: repetir también las comprobaciones de filas con la ventana del CI. (surgió en 0013)
- e2e: renombrar `useCiWindow` (empieza por «use» y obliga a la excepción de lint
  `react-hooks/rules-of-hooks` en `e2e/**`) y quitar la excepción. Cambia el texto del CA1 de la
  0021: lo decide Dani. (surgió en 0021)
- `views.spec.ts`: reflujo de los JSDoc de `withContentSize` y `withContentWidth` (~1747 y ~5970).
  (surgió en 0021)
- `scripts/e2e-ci-window.test.ts`: `isUseCiWindow` no comprueba el argumento de la llamada.
  (surgió en 0021)
- `entityTypeOf` (`src/main/modules/entities.ts`): con un id sin guion recorta el último carácter;
  usar `requestedId` o devolver el texto entero. (surgió en 0014)
- Marcadores y gráficos del servicio (métricas y problemas) pueden pedir datos antes de conocer el
  scope, porque `useModuleAccess` da el módulo por disponible hasta que responde `connection:status`;
  resolverlo en el propio hook para todos los módulos. (surgió en 0015)
- `ServiceInfo.tsx:351`: crear el enlace a la entidad relacionada solo si su id pasa
  `entityIdSchema`. (surgió en 0015)
- Sacar las opciones comunes de `useConnectionStatus` y `useConnectionStatusKnown`
  (`data/tenants.ts`). (surgió en 0015)

- Marcadores del host (`src/main/modules/host-metrics.ts`): pedir `:avg` explícito (equivale al
  `defaultAggregation`). (surgió en 0016)
- Comentario de `fold` + `Inf` en `host-metrics.ts`: citar la 0006 (da 400). (surgió en 0016)
- CA5 de la 0016: comprobar también la clave `hostMetricsRejected`. (surgió en 0016)- Comentario de `host-breakdown.ts`: anotar que la API limita a 1.000 series por respuesta y que con
  3 expresiones por proceso la cuenta es exacta hasta unos 333 procesos por host. Si aparecen hosts
  más grandes: `:sort(value(avg,descending)):limit(10)` y recuento aparte (cambio de ficha; decide
  Dani). (surgió en 0017)
- El `detail` de `hostBreakdownRejected` puede llevar el selector con el id del host. (surgió en 0017)
- Textos de los marcadores del host: sacar el 80 y el 90 de «Aviso: más del 80 %» y «Crítico: más del
  90 %» de las constantes `USAGE_WARNING_PCT` y `USAGE_ERROR_PCT` en vez de escribirlos en los
  locales. (surgió en 0018)
- e2e CA8 (0003): que compruebe también que la página del servicio no hace peticiones de más (pasa
  también sin peticiones). (surgió en 0018)
- Marcador «Disco» del host: cuando la 0019 traiga los discos (`entities:hostBreakdown`), enseñar
  debajo el nombre del disco más lleno en vez de «Máximo del rango». (surgió en 0018)
- `scripts/e2e-export-read.test.ts` (CA2): no ve `let f; f = await exportTo(...)`; y `usesExportDir`
  marcaría una lectura legítima de `exportDir` tras un `exportSaved` (hoy no existe). (surgió en 0030)
- `DataGrid`: prop para filas no activables; las filas de discos del host llevan `cursor-pointer` sin
  acción. (surgió en 0019)
- Unitarios de `processLinkId`, `processesTruncated` y `diskTotal` (`host-tables.ts`), hoy cubiertos
  solo por los e2e. (surgió en 0019)
- Información de la nube del host: filas de región y tamaño de instancia. Solo llegan con claves propias de cada proveedor (`gce*`…); decide Dani de qué claves salen por proveedor. (surgió en 0020)
- Ficha 0022: añadir `browser.availability` con `splitBy` al paréntesis de la sección «Verificación» (la lista de lo probado con `splitBy` en browser). (surgió en 0022)
- Monitores: añadir la de pasos a la consulta de localización de browser (`CHANNEL_LOCATIONS.browser`) en la próxima pasada en vivo; hoy se probó sola (mismo ámbito, riesgo bajo). (surgió en 0023)
- Franja de problemas: los comentarios de `ProblemBand.tsx` y `EntityChartPanel.tsx` solo nombran servicio y host; añadir los monitores. (surgió en 0024)
- Marcador «Localizaciones» de monitores: el pie «Localizaciones con datos» solo es exacto si el desglose excluye las de sin dato; frente a «del rango», revisar el texto. (surgió en 0024)
- «Abrir en Métricas» de monitores: el filtro por el id del monitor (en HTTP, con el `and` de «Result status») no está probado en vivo; prueba a mano de Dani. (surgió en 0024)
- `MonitorTables.tsx`: en `StepsCard`, la rama `isEmpty` (`entities.monitor.steps.empty`) no se ve nunca porque `monitorStepsShown` oculta la tarjeta antes; quitarla o comentarla como defensa. (surgió en 0025)
- `monitor-tables.ts`: el comentario de `compareNullable` («va por debajo de todo») debería decir «sin dato, primero en ascendente». (surgió en 0025)
- `onActivate={() => undefined}` en las tablas de monitores: comprobar que `DataGrid` no pinte las filas como pulsables cuando no hacen nada (se une a la prop de filas no activables anotada en 0019). (surgió en 0025)
- `MonitorInfo.tsx:89`: el caso `'number'` da por hecho que el único número es la frecuencia; comprobar `row.key` como con `tags` si entra otra fila numérica. (surgió en 0026)
- Recursos del proceso (descriptores de fichero) sin color de nivel: la ficha solo fija umbrales para la CPU; si Dani los quiere, los del host (80 y 90 %) encajan. (surgió en 0028)
- Eje de Recursos del proceso fijo de 0 a 100 % (`process-charts.ts:166`): si con procesos reales la métrica resulta ser fracción, corregir a la vez marcador y eje. (surgió en 0028)
- e2e inestable `e2e/shell.spec.ts:402`: el tooltip de «nav-problems» no aparece en 5 s tras `hoverFresh` (visto en el CI del push de la 0027, run 37733715700, intento 1; al relanzar pasó). Posible arreglo: esperar más o reintentar el hover; ver la lección del tooltip de Radix en `e2e/CLAUDE.md`. (surgió en 0027)
- Host: los `warnings` de la API se repiten en las dos tarjetas (discos y procesos); mostrarlos una
  sola vez. (surgió en 0019)

## Aparcado

- Monaco (fases 5 y 7): no se implementa ni se pregunta por él hasta que Dani lo retome.
- Sin definición cerrada, no se implementan: Service flows avanzados, Vista de negocio,
  notificaciones, Favoritos y variación de los KPI.

## Hecho

- Fases 1, 2, 3, 4 y 6 (primera versión, aceptada por Dani el 2026-10-04) y versiones 0.7.0 a
  0.10.2: ver `CHANGELOG.md`.
- CI en GitHub Actions sobre Windows (propuesta 5), montado con el flujo de agentes (ADR-0007).
- [0001](tasks/0001-descripcion-evento-markdown.md): descripción del evento con formato Markdown en
  el detalle del problema, con «Copiar» (ADR-0008).
- [0002](tasks/0002-descripcion-siempre-markdown.md): la descripción del evento siempre con
  formato; se quitó el conmutador de la 0001 y se queda «Copiar».
- [0003](tasks/0003-pagina-analisis-entidad.md): «Analizar entidad» en el detalle de las
  evidencias, con una página en construcción por tipo de entidad (y una genérica para el resto).
- [0004](tasks/0004-aviso-telegram.md): aviso por Telegram al terminar `/tarea` o
  `/cerrar-version`, opcional y con filtro del tenant (ADR-0009).
- [0005](tasks/0005-e2e-estables.md): e2e de `views.spec.ts` estables y CI en verde (acciones en
  v7); arreglados la ruta de la barra superior y volver a exportar en Inicio con la ventana pequeña.
- [0007](tasks/0007-servicio-problemas.md) (lote servicio): canal `entities:problemCounts` con los
  problemas abiertos y cerrados de una entidad en el rango. Sin interfaz hasta la 0008.
- [0008](tasks/0008-servicio-marcadores.md) (lote servicio): la página del SERVICE enseña los cinco
  marcadores del rango (peticiones OK y KO, tasa de error, tiempos con mediana, p90 y p99, y
  problemas abiertos y cerrados).
- [0006](tasks/0006-servicio-datos-metricas.md) (lote servicio): canal `entities:serviceMetrics`
  con series y totales del servicio (sin interfaz hasta la 0008 y la 0009), y arreglo del aviso
  falso de «solo parte de los puntos» en Métricas.
- [0009](tasks/0009-servicio-graficos.md) (lote servicio): cuatro gráficos en la página del SERVICE
  (tiempos, actividad OK/KO, tasa de error y errores) con «Abrir en Métricas» y exportación.
- [0010](tasks/0010-servicio-banda-problemas.md) (lote servicio): franja con los problemas de la
  entidad sobre el gráfico de tasa de error, con tooltip y enlace al problema. Con ella queda
  completo el lote «servicio» (0006 a 0010).
- [0011](tasks/0011-tests-hora-y-escalado.md) (lote servicio-2): e2e independientes de la zona
  horaria y del escalado del escritorio; CI en verde.
- [0013](tasks/0013-servicio-franja-entera.md) (lote servicio-2): la franja de problemas del
  servicio se ve entera con cualquier zoom.
- [0012](tasks/0012-servicio-retoques-visuales.md) (lote servicio-2): gráficos del servicio sin rejilla,
  marcadores centrados y separador de miles siempre en toda la interfaz (`formatNumber`).
- [0021](tasks/0021-e2e-ventana-del-ci.md): todos los e2e arrancan con la ventana del CI (1024×720).
- [0014](tasks/0014-entidad-datos-api.md) (lote servicio-2): canales `entities:get` y `entities:names` y
  scope `entities.read` en «Probar conexión». Sin interfaz hasta la 0015.
- [0015](tasks/0015-servicio-informacion.md) (lote servicio-2): tarjeta «Información» en la página del
  servicio, con datos, relaciones agrupadas, nombres a demanda y todas las propiedades. Con ella
  queda completo el lote «servicio-2» (0011 a 0015).
- [0016](tasks/0016-host-datos-metricas.md): canal `entities:hostMetrics` con series y marcadores de CPU, memoria, red y disco del host (lote host; sin cambios visibles hasta la 0018).
- [0017](tasks/0017-host-discos-procesos-datos.md): canal `entities:hostBreakdown` con los discos y los 10 procesos con más CPU del host (lote host; sin cambios visibles hasta la 0019).
- [0018](tasks/0018-host-marcadores-graficos.md): página del host con cinco marcadores (umbrales 80/90 %) y cuatro gráficos (CPU con la franja de problemas, memoria, red y disco), con «Abrir en Métricas» y exportación (lote host).
- [0030](tasks/0030-e2e-exportacion-detalle.md): los e2e leen las exportaciones tras el aviso «Guardado» y con contenido (`exportSaved`); arregla un intermitente del CI.
- [0019](tasks/0019-host-discos-procesos-vista.md): tablas de discos y de los 10 procesos con más CPU en la página del host, con orden por columna, enlace al proceso y aviso de lista recortada (lote host).
- [0020](tasks/0020-host-informacion.md): tarjeta «Información» en la página del host, con datos, relaciones agrupadas, nombres a demanda y todas las propiedades; la tarjeta se comparte con el servicio. Con ella queda completo el lote «host» (0016 a 0020).
- [0022](tasks/0022-monitores-exploracion-datos.md) (lote monitores): canal `entities:monitorMetrics` con series y marcadores de browser y HTTP monitor, y análisis de métricas en vivo (sin cambios visibles hasta la 0024).
- [0023](tasks/0023-monitores-desglose-datos.md) (lote monitores): canal `entities:monitorBreakdown` con el desglose por localización y por paso o petición de browser y HTTP monitor (sin cambios visibles hasta la 0025).
- [0024](tasks/0024-monitores-marcadores-graficos.md) (lote monitores): páginas de browser y HTTP monitor con cinco marcadores (disponibilidad con umbrales 95/99 %) y cuatro gráficos (disponibilidad con la franja de problemas, duración, ejecuciones y rendimiento), con «Abrir en Métricas» y exportación.
- [0025](tasks/0025-monitores-localizaciones-pasos.md) (lote monitores): tablas de localizaciones (disponibilidad con umbrales 95/99 %) y de pasos o peticiones (con el más lento resaltado) en las páginas de browser y HTTP monitor; sin pasos que enseñar, la tarjeta de pasos no sale.
- [0026](tasks/0026-monitores-informacion.md) (lote monitores): tarjeta «Información» en las páginas de browser y HTTP monitor, con datos, relaciones agrupadas, nombres a demanda y todas las propiedades; la tarjeta se comparte con servicio y host. Con ella queda completo el lote «monitores» (0022 a 0026).
- [0027](tasks/0027-proceso-exploracion-datos.md) (lote proceso): canal `entities:processMetrics` con series y marcadores de CPU, memoria, red, salud de red, disponibilidad y recursos de un proceso, y análisis de métricas en vivo (sin cambios visibles hasta la 0028).
- [0028](tasks/0028-proceso-marcadores-graficos.md) (lote proceso): página del proceso con hasta cinco marcadores (CPU con umbrales 80/90 %, disponibilidad con 95/99 %) y cuatro gráficos (CPU con la franja de problemas, memoria, red y salud de red o recursos), con «Abrir en Métricas» y exportación.
