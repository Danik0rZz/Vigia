# Registro de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## [0.6.0] - 2026-10-03

Fase 6: primeras vistas core. Con ella se completa el alcance propuesto de la primera versión
(fases 1, 2, 3, 4 y 6).

### Añadido

- Inicio: problemas abiertos, SLOs (estado, objetivo y presupuesto de error) y salud de servicios
  derivada de los problemas abiertos.
- Problemas: filtros de estado y texto, línea de tiempo con ECharts, tabla y detalle con las
  entidades afectadas. Hasta 500 problemas, con aviso si la lista se trunca.
- Métricas: búsqueda, consulta con resolución, gráfico de líneas y consultas guardadas por entorno
  (también en `Ctrl+K`).
- Rango temporal personalizado, de un año como máximo.
- Exportación de toda tabla y gráfico a CSV (BOM, separador configurable, fórmulas
  neutralizadas), XLSX (tipos reales, hoja Info con rango y fechas) y TXT, y capturas PNG a doble
  resolución con pie opcional, al portapapeles o a fichero.
- Sin auto-refresco: los datos se piden al entrar y con "Actualizar". Los módulos sin token
  clásico o sin sus scopes aparecen desactivados con la explicación.

### Cambiado

- La URL de la API clásica que termina en `/api`, `/api/v1` o `/api/v2` ya no se rechaza: se
  normaliza quitando ese sufijo, y el formulario muestra el valor normalizado.

## [0.4.0] - 2026-10-03

Fase 4: cliente de Dynatrace.

### Añadido

- Cliente HTTP en main (`dtRequest` y `paginate`) para la API clásica y la de plataforma, con
  token clásico, OAuth `client_credentials` y platform token. Reintenta un 401 con OAuth (token
  nuevo) y los 429 (`Retry-After` o backoff con jitter, máximo 3 veces y 60 s), con timeout por
  petición y errores tipados que la interfaz traduce. `paginate` avisa si la lista se ha truncado
  al llegar al máximo de páginas.
- Gestor de tokens OAuth en memoria por entorno: usa `expires_in`, renueva con menos de 60 s y
  comparte una única renovación.
- Enmascarado de tokens y cabeceras en errores y logs; nunca se registran cabeceras ni cuerpos.
- Red por entorno con la sesión de Chromium y tres niveles de certificados: sistema, huella
  fijada (por host, en la base) e ignorar errores, con aviso rojo permanente en la barra superior.
  "Ignorar" solo vale para los hosts del entorno: nunca para el SSO, que recibe el client secret.
  Una huella nueva solo sustituye a la anterior si el usuario la acepta viendo las dos.
- "Probar conexión" por mecanismo, con los scopes que faltan para Problemas, Métricas y SLOs, y
  la tarjeta del pie con el estado real y la caducidad del token OAuth.

### Cambiado

- La URL de la API clásica es la base del entorno, sin `/api/v2`; se rechaza si termina en `/api`.
- El paquete ya no incluye `node-addon-api`.

## [0.3.0] - 2026-10-03

Fase 3: datos locales y secretos.

### Añadido

- Base de datos local con better-sqlite3 y Drizzle en la carpeta de datos, con migraciones que
  main aplica al arrancar (`npm run db:generate` para generarlas).
- Clientes y entornos: alta, edición y borrado desde Ajustes, con borrado en cascada y nombres
  únicos sin distinguir mayúsculas.
- Credenciales cifradas con `safeStorage`. El renderer solo puede guardarlas, borrarlas y saber
  si hay cifrado; nunca leerlas. Sin cifrado disponible no se guardan.
- Exportar e importar la configuración en JSON, sin secretos y como mucho de 1 MB, con resumen de
  creados, saltados y errores.
- Selector de entorno en la barra superior, ruta "Cliente › Entorno › Sección" y entornos en la
  paleta `Ctrl+K`. El entorno activo se recupera al arrancar.
- Distintivo fijo de los entornos de Producción y color de acento del cliente activo.
- La tarjeta de estado muestra los mecanismos con credencial como "Sin comprobar" hasta la Fase 4.

### Cambiado

- El tema guardado se aplica antes de crear la ventana: la barra de título ya no parpadea al
  arrancar.
- Las pruebas e2e usan cada una su propia carpeta de datos.

### Aplazado

- Logo del cliente y registro local de acciones de escritura (ver la especificación).

## [0.2.0] - 2026-10-03

Fase 2: esqueleto de la interfaz.

### Añadido

- Layout completo: barra lateral plegable con los grupos Monitorización, Análisis y
  Administración, barra superior con la ruta de la sección, búsqueda y cambio rápido de tema e
  idioma, y barra de título propia que conserva los botones nativos de Windows.
- Lista única de secciones (`src/renderer/src/app/navigation.ts`), de la que salen el menú, las
  rutas hash y la paleta de comandos `Ctrl+K`.
- Secciones vacías con su cabecera y pantalla de Ajustes con tema e idioma.
- Rango temporal global en la barra superior (2 h, 24 h, 7 d), como estado de trabajo sin
  guardar. "Personalizado" llega en la Fase 6.
- Tema cristal con tokens CSS (Tailwind CSS v4): Claro, Oscuro y Sistema, que sigue en caliente a
  `prefers-color-scheme`; main ajusta `nativeTheme` para la barra de título.
- Idiomas español e inglés con i18next, con un fichero por namespace en
  `locales/<idioma>/<namespace>.json` (por ahora solo `common`); la regla `i18next/no-literal-string` impide textos sin
  traducir en la interfaz.
- Transiciones de página con Motion y de la barra lateral con CSS, que respetan
  `prefers-reduced-motion`.
- Tarjeta de estado del entorno en el pie de la barra lateral, con un estado neutro mientras no
  haya entornos.
- La variable `VIGIA_USER_DATA_DIR` fija la carpeta de datos en pruebas; se ignora en la app
  empaquetada.

### Cambiado

- `docs/glosario.md`: se quita "Dynatrace Hub", que la app no usa.
- Las librerías que solo usa el renderer pasan a devDependencies: Vite ya las empaqueta, y así
  no entran en el asar (de 49 MB a 7,7 MB; el zip baja de 148,0 MB a 142,4 MB).

## [0.1.0] - 2026-10-03

Fase 1: base del proyecto.

### Añadido

- Proyecto Electron + React + TypeScript generado con electron-vite, con las carpetas
  `src/main`, `src/preload`, `src/renderer` y `src/shared`.
- Contrato IPC tipado y validado con Zod (`src/shared/ipc.ts`), con los canales de ejemplo
  `app:getInfo` y `app:ping`.
- Ventana con `contextIsolation`, `sandbox` y sin `nodeIntegration`; preload empaquetado en un
  único fichero.
- Protocolo propio `app://vigia/` para servir la interfaz, con CSP estricta en cada respuesta.
- Comprobación del remitente de cada mensaje IPC, navegación externa bloqueada y permisos web
  denegados.
- Instancia única.
- User-Agent solo con caracteres ASCII (`vigia/<versión>`).
- Logs en fichero rotado con electron-log en `%APPDATA%\vigia\logs`.
- ESLint, Prettier, Vitest (tests unitarios) y Playwright (prueba de extremo a extremo).
- Empaquetado con electron-builder: zip para Windows x64 y portable como opción secundaria,
  con fusibles de Electron.
