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
- Sin definición cerrada no se implementan: Service flows avanzados, Vista de negocio,
  notificaciones, Favoritos y variación de los KPI.
- Contenido del tenant con formato (Markdown): solo con `MarkdownText`, nunca
  `dangerouslySetInnerHTML` ni `rehype-raw`; sin HTML en crudo, solo enlaces http/https y sin
  imágenes (ADR-0008).
- React Router 8.4.0 convierte `%2F` en `/` al leer un parámetro de ruta: un `/` codificado en un
  segmento no hace ida y vuelta (`entity-route.ts`). Los ids de Dynatrace no lo llevan.
- Para pintar un componente sacado de un registro (`tipo → componente`), `createElement`: con JSX,
  `react-hooks/static-components` lo toma por un componente creado en el render (`EntityPage.tsx`).
- El aviso de error de un panel o marcador enseña `errorDetail` (`lib/error-detail.ts`) visible y
  lleva `role="alert"`, como `ModuleError`; no basta el código traducido ni un `title`.
- Un color nuevo de serie de gráfico: token en `main.css` (claro y oscuro), campo en `ChartColors` y caso en `src/main/env-colors.test.ts` (contraste ≥ 3:1 frente al fondo).
- Abrir un detalle desde un tramo o fila de otra página con el estado `fromList` de `ProblemDetailPage`: así «Volver» hace `back()` en el historial y no recarga lo de la página de origen (franja de `ProblemBand.tsx`).
- Todo número que se enseña pasa por `formatNumber` (`src/shared/format-number.ts`): en ejes y tooltips de ECharts, con `formatter` (si no, ECharts pone comas); los textos de i18next ya lo hacen con el formateador global (`app/i18n-numbers.ts`). Un test vigila que no haya `new Intl.NumberFormat` por libre.
- Una consulta que depende de un scope espera a conocer `connection:status` (`useConnectionStatusKnown`, `data/tenants.ts`): `useModuleAccess` da el módulo por disponible hasta entonces y se pediría sin permiso (`ServiceInfo.tsx`).
- Las páginas de entidad comparten `EntityMarkers.tsx`, `EntityChartPanel.tsx` y `entity-charts.ts`: un tipo nuevo reutiliza esas piezas y `ProblemBand` con `testIdPrefix` (servicio y host ya lo hacen).
- Las tarjetas «Información» de entidad comparten `EntityInfoCard.tsx`: un tipo nuevo aporta su `buildXInfo` (como `host-info.ts`) con claves confirmadas en vivo.
- Las páginas de entidad ponen su contenido con `EntitySections` (`EntityPageFrame.tsx`), que fija el orden: etiquetas (`EntityTags`, ficha 0037), avisos de módulos sin acceso, marcadores, gráficos, demás tarjetas e «Información» la última; no lo repitas a mano en cada página.
