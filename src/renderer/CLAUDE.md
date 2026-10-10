# Reglas de src/renderer/

- No se importa `electron`, `node:*` ni código de main o del preload (lo impide ESLint). A main se le
  llama con `invoke()` de `src/renderer/src/lib/ipc.ts`.
- Textos en `locales/` de es y en, siempre los dos. Los colores y el contraste los vigila el test de
  contraste de `check`.
- Las vistas de datos no se refrescan solas (`staleTime: Infinity`, `refetchOnMount: false`): cada
  petición gasta cuota de la API. Solo "Actualizar" o una clave nueva (entorno, filtros, rango) piden
  datos (ADR-0004).
- Con `asChild` de Radix (Slot), el hijo no puede recibir `className` ni `style` como función: Slot
  los fusiona como cadena. Para NavLink, el estado activo se pinta con `aria-[current=page]`.
- `useVirtualizer` de TanStack Virtual hace que el React Compiler se salte el componente (aviso
  `react-hooks/incompatible-library`): es lo esperado y se desactiva el aviso en esa línea con su
  motivo.
- El React Compiler está activo en el build (ficha 0059). Una función en línea pasada a una tabla
  dentro de una rama condicional del JSX la memoiza junto con los datos de esa rama: sácala a una
  constante antes del `return` (`toggleRow` de `EvidenceSection.tsx`). Con `VIGIA_E2E`, las filas
  del DataGrid llevan `data-render-count` (`lib/render-count.ts`) para comprobarlo en e2e.
- Sin definición cerrada no se implementan: Service flows avanzados, Vista de negocio,
  notificaciones, Favoritos y variación de los KPI.
- Contenido del tenant con formato (Markdown): solo con `MarkdownText`, nunca
  `dangerouslySetInnerHTML`. El HTML de formato se interpreta solo con la lista blanca de
  `markdown-html.ts` (`rehype-raw` + `rehype-sanitize`; `style` reconstruido solo con color y
  fondo, ADR-0011); solo enlaces http/https y sin imágenes (ADR-0008). Los plugins de rehype
  propios (`markdown-plugins.ts`, `markdown-color.ts`) van después del saneado y solo transforman
  el árbol, sin generar HTML.
- React Router 8.4.0 convierte `%2F` en `/` al leer un parámetro de ruta: un `/` codificado en un
  segmento no hace ida y vuelta (`entity-route.ts`). Los ids de Dynatrace no lo llevan.
- Para pintar un componente sacado de un registro (`tipo → componente`), `createElement`: con JSX,
  `react-hooks/static-components` lo toma por un componente creado en el render (`EntityPage.tsx`).
- El aviso de error de un panel o marcador enseña `errorDetail` (`lib/error-detail.ts`) visible y
  lleva `role="alert"`, como `ModuleError`; no basta el código traducido ni un `title`.
- Un color nuevo de serie de gráfico: token en `main.css` (claro y oscuro), campo en `ChartColors` y caso en `src/main/env-colors.test.ts` (contraste ≥ 3:1 frente al fondo).
- Abrir un detalle desde un tramo o fila de otra página con el estado `fromList` de `ProblemDetailPage`: así «Volver» hace `back()` en el historial y no recarga lo de la página de origen (franja de `ProblemBand.tsx`).
- Varias consultas del mismo tipo (por ejemplo una por instancia) se combinan con `combineQueries` de `data/query-list.ts`: un solo estado de carga y error, y Reintentar repite solo las fallidas.
- Todo número que se enseña pasa por `formatNumber` (`src/shared/format-number.ts`): en ejes y tooltips de ECharts, con `formatter` (si no, ECharts pone comas); los textos de i18next ya lo hacen con el formateador global (`app/i18n-numbers.ts`). Un test vigila que no haya `new Intl.NumberFormat` por libre.
- Una consulta que depende de un scope espera a conocer `connection:status` (`useConnectionStatusKnown`, `data/tenants.ts`): `useModuleAccess` da el módulo por disponible hasta entonces y se pediría sin permiso (`ServiceInfo.tsx`).
- Las páginas de entidad comparten `EntityMarkers.tsx`, `EntityChartPanel.tsx` y `entity-charts.ts`: un tipo nuevo reutiliza esas piezas y `ProblemBand` con `testIdPrefix` (servicio y host ya lo hacen).
- Una página de entidad nueva toma el acceso de `useEntityPageAccess(id, schema)` (`entity-access.ts`, con la espera de la 0015); «Actualizar» sale con `canRefresh`. Sus marcadores usan `Level`, `LEVEL_CLASS`, `MarkerBody` y `BigValue` de `EntityMarkers.tsx` con `testIdPrefix`, y sus tablas `TableCard`, `NUMBER_CELL`, `BAR_CLASS` y `barWidth` de `EntityTables.tsx`, con `compareNullable`/`byNumber` de `@shared/grid-sort`. Un test de guardia (ficha 0058) falla si se vuelven a copiar.
- `EntityChartPanel` admite `selector` (sin él, sin «Abrir en Métricas»), `titleHint` (tooltip del título con ratón y foco) y `testIds` propios; `footer` (bajo el gráfico) y un `unit` por serie para la exportación; `axisTooltip` admite `formatOf` (formato por serie en el tooltip). `Chart` expone `data-thresholds` (valores `yAxis` numéricos de los `markLine`, JSON) para comprobar umbrales en e2e.
- Las tarjetas «Información» de entidad comparten `EntityInfoCard.tsx`: un tipo nuevo aporta su `buildXInfo` (como `host-info.ts`) con claves confirmadas en vivo.
- Un color nuevo de la cápsula de etiquetas: token `--tag-*` en `main.css` (la paleta `--tag-0` a `--tag-7` es igual en los dos temas, con texto blanco) y su caso en el test de contraste de `src/main/env-colors.test.ts`, que mezcla también el contexto al 85 % y el brillo de `capsule-gloss`.
- Las páginas de entidad ponen su contenido con `EntitySections` (`EntityPageFrame.tsx`), que fija el orden: etiquetas (`EntityTags`, ficha 0037), avisos de módulos sin acceso, marcadores, gráficos, demás tarjetas e «Información» la última; no lo repitas a mano en cada página.
- Un modal vistoso con transición de entrada usa `ShowcaseDialog` (`components/dialogs.tsx`, clase `vigia-dialog-in` de `main.css`, con su regla propia para `prefers-reduced-motion`, que si no lo dejaría en 0,01 ms). Sin `Dialog.Trigger`, Radix no devuelve el foco al cerrar: el componente guarda el elemento enfocado al abrir. Una consulta que pide el modal lleva `enabled: open` (ADR-0004) y su invalidación `refetchType: "none"`.
- Cada `PanelBoundary` pasa su `refetch` en `onRetry`; sin él, «Reintentar» solo limpia el error y repinta con la caché (nunca `refetchQueries({ type: 'active' })`, que repite todas las consultas de la app). El `onRetry` va donde la consulta sigue montada (en el mini gráfico de evidencia, dentro de `EvidenceMetricChart`), si no el `refetch` no tiene a quién pedir.
- Los títulos del Markdown del tenant salen con `MarkdownHeading` (`p` con `role="heading"` y `aria-level` 5 o 6, clase `md-h<nivel>`), no como `h1`…`h6`; los e2e los buscan como `p[role="heading"]`. Reenvía `id` (el título de las notas al pie lo necesita).
