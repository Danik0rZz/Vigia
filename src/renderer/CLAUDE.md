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
