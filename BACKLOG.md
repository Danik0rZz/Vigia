# Backlog

Qué viene. Lo mantienen el Planificador (fichas nuevas) y el doc-writer (al cerrar una ficha). Lo
que ya se hizo está en `CHANGELOG.md`; las fichas, en `tasks/`. Nada pasa a "Próximo" sin el visto
bueno de Dani o de peticiones en su nombre.

## En curso

- Cola aprobada por Dani el 2026-10-07 (de noche, sin esperar a Dani): servicio-2 (lo que quede) →
  [0021](tasks/0021-e2e-ventana-del-ci.md) → host (0016–0020) → lote **monitores**
  ([0022](tasks/0022-monitores-exploracion-datos.md)–[0026](tasks/0026-monitores-informacion.md),
  browser y HTTP monitor) → lote **proceso**
  ([0027](tasks/0027-proceso-exploracion-datos.md)–[0029](tasks/0029-proceso-informacion.md)).
- Lote **host** (página de análisis de una entidad HOST), aprobado por Dani el 2026-10-07. Orden:
  [0016](tasks/0016-host-datos-metricas.md), [0017](tasks/0017-host-discos-procesos-datos.md),
  [0018](tasks/0018-host-marcadores-graficos.md), [0019](tasks/0019-host-discos-procesos-vista.md) y
  [0020](tasks/0020-host-informacion.md). La 0020 depende de la 0015 (lote servicio-2).
- Lote **servicio-2** (arreglos de tests, retoques del servicio e información de la entidad),
  aprobado por Dani el 2026-10-07. Orden: [0011](tasks/0011-tests-hora-y-escalado.md),
  [0012](tasks/0012-servicio-retoques-visuales.md), [0013](tasks/0013-servicio-franja-entera.md),
  [0014](tasks/0014-entidad-datos-api.md) y [0015](tasks/0015-servicio-informacion.md).

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
- Test de `useModuleAccess("entities")` (scope `entities.read`) al hacer la vista de la 0015.
  (surgió en 0014)
- e2e intermitente «v0.9.0 … exportación del detalle de un problema»: falló una vez en una tirada
  completa y pasó al repetir; no salió en la verificación. Causa sin investigar. (surgió en 0014)

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
