# Pendiente de Dani: aceptación manual

Pruebas a mano que solo puede dar por cumplidas Dani. No bloquean: se sigue con lo siguiente y Dani
las prueba cuando puede. Al cerrar una versión, `/cerrar-version` añade aquí su lista; al
confirmarlas Dani, se marcan con `[x]`. Un criterio manual nunca lo marca un agente.

Dani dio por cumplidas todas las pruebas a mano de la v0.8.0 a la v0.10.2 el 2026-10-10.

Dani aceptó la v0.6.0 el 2026-10-04 (cliente y entorno que se conservan al reiniciar) y dio por
cumplidos los criterios manuales de las fases 2, 3, 4 y 6. "Probar conexión contra un tenant real"
queda cubierto por las pruebas en vivo (`npm run test:live`, v0.7.0), y "XLSX y CSV en Excel" se
revisa con las exportaciones reales de esas pruebas.

## Sin publicar

Ficha 0066 (marcador «SLO» del servicio). Se añadirá a la lista de la próxima versión.

- [ ] **Seis marcadores del servicio (0066):** en la página de un servicio con todas las métricas, el marcador «SLO» sale el primero, a la izquierda de «Peticiones OK», en rojo y con «por debajo del 90 %» si baja del 90 % y en verde desde el 90 %; y el de «Tiempo de respuesta» (mediana, p90 y p99) se sigue leyendo bien en el ancho de tu pantalla. La fila de seis sale **desde 1280 px de ventana**; entre 1024 y 1279 px salen **dos filas de tres** (`lg:grid-cols-3 xl:grid-cols-6`: con seis a 1024 px y el menú abierto no cabían, y se rompía el centrado de la ficha 0012).

## v0.11.0

Fichas 0001 a 0045. Pruebas a mano con los datos reales (el detalle de cada una, en su ficha). Dani las dio por cumplidas el 2026-10-10, con algunos cambios pedidos al Planificador; queda el zip:

- [x] **Antes de nada:** añadir los scopes `entities.read` (0014) y `events.read` (0042) al token del
      entorno; «Probar conexión» deja de avisar con ellos y avisa sin ellos.
- [x] **Descripciones de problemas (0001, 0035, 0038, 0043):** con problemas reales, que las
      descripciones se ven bien (listas, tablas, enlaces, código con colores, avisos y marcas, HTML de
      formato), en claro y en oscuro; que los enlaces abren el navegador del sistema; que «Copiar»
      pega el texto original; que ninguna sale con la nota de recorte; que la descripción sale en
      todas las evidencias, y que las otras propiedades con «description» son de verdad Markdown.
      Abrir el problema del ejemplo y comprobar que se ve como la captura o mejor.
- [x] **«Analizar entidad» (0003):** sale en las evidencias con entidad y lleva a la página del tipo
      correcto (y a la genérica en los tipos personalizados o de extensión).
- [x] **Aviso por Telegram sin variables (0004):** con las variables quitadas un momento, una tarea
      termina igual, con el aviso en la terminal.
- [x] **Ventana pequeña (0005):** a 960×600 o unos 1024 px, la ruta de la barra superior se ve y se
      pulsa; al volver de un problema por la ruta, la lista queda en la misma fila; exportar los SLOs
      de Inicio a XLSX enseña «Guardado: …» dentro de la tarjeta y se puede repetir.
- [x] **Métricas (0006):** una consulta normal ya no avisa de «solo parte de los puntos».
- [x] **Servicio (0008, 0009, 0010, 0012, 0013, 0015):** marcadores, gráficos, franja de problemas e
      «Información» cuadran con Dynatrace en el mismo rango, se leen en claro y en oscuro y con la
      ventana pequeña; «Abrir en Métricas» desde cada gráfico; un servicio sin tráfico enseña «—»; en
      la VPS (150 %), la franja se ve entera.
- [x] **Host (0018, 0019, 0020, 0036, 0039, 0040, 0041, 0042):** marcadores y gráficos (con memoria
      usada, recuperable y total), discos y procesos, «Información» al final, página del disco,
      tarjetas «Logs» (sin rutas) y «Eventos» cuadran con Dynatrace.
- [x] **Monitores (0024, 0025, 0026):** marcadores, gráficos, localizaciones, pasos e «Información»
      cuadran con Dynatrace en los dos tipos; «Abrir en Métricas» trae solo ese monitor; «Cada N
      minutos» coincide con Dynatrace.
- [x] **Proceso (0028, 0029):** marcadores y gráficos cuadran; Recursos no sale 100 veces más
      pequeño; la tarjeta no enseña ninguna línea de comandos ni ruta con nombres de usuario.
- [x] **Grupo de procesos (0032):** marcadores, gráficos e instancias cuadran con Dynatrace.
- [x] **Aplicación (0034):** marcadores, gráficos y acciones cuadran; «Abrir en Métricas» trae solo
      esa aplicación.
- [x] **Etiquetas (0037):** las píldoras se leen bien en claro y en oscuro.
- [ ] Arrancar el zip 0.11.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de
      `%APPDATA%\vigia`**; lo hace Dani.

## v0.8.0

Incluye lo de la v0.7.0. Pruebas a mano con los datos reales:

- [x] Al marcar "ignorar certificados" en el formulario del entorno aparece el aviso.
- [x] La ruta de la barra superior muestra Cliente › tipo de entorno, y el menú tiene tooltips.
- [x] "Probar conexión" describe el token (nombre, caducidad y scopes).
- [x] Problemas: filtro de Clúster y filtros de severidad e impacto. (El panel lateral del detalle ya no existe: desde la 0.9.0, el detalle va en su propia página; ver abajo.)
- [x] Los avisos "Mostrando N de M" y los avisos de Dynatrace se entienden.
- [x] Métricas: con 7 días y 1 min aparece el aviso de puntos y "Usar 10m". SLOs de Inicio: el estado de aviso con su color, "Sin evaluar" y los problemas relacionados.
- [x] Guardar un secreto pulsando Enter en su campo.
- [x] Arrancar el zip 0.8.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.8.1

Pruebas a mano (se pueden hacer junto con las de la 0.8.0, con el zip 0.8.1):

- [x] Con la interfaz en inglés, un error de "Probar conexión" (por ejemplo, un certificado no fiable o un token caducado) sale en inglés.
- [x] Si el SSO del entorno usa un certificado que Windows no reconoce: "Probar conexión" ofrece su huella, se acepta y OAuth conecta. Si no es el caso, no aplica.
- [x] La lista de entornos (selector y Ajustes) sale en orden alfabético con tildes ("Ámbito" junto a "Alfa", no al final).
- [x] Arrancar el zip 0.8.1 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.9.0

Pruebas a mano (Problemas rediseñado; se pueden hacer con el zip 0.9.0 en vez del 0.8.1):

- [x] La lista se lee bien en claro y en oscuro: barra roja en los abiertos y verde (más fina) en los cerrados, 4 columnas y orden al pulsar cada cabecera.
- [x] Con el teclado: Tab hasta la lista, flechas, Inicio y Fin, y Enter abre el problema; "Volver a Problemas" (o la flecha atrás) deja la lista como estaba: filtros, orden, la fila que se veía y el foco en el problema abierto.
- [x] El detalle de un problema real muestra sus secciones (solo las que tienen datos) y la exportación XLSX abre en Excel con las hojas Resumen, Entidades, Evidencias, Impacto y Comentarios.
- [x] Arrancar el zip 0.9.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.9.1

Pruebas a mano (evidencias y comentarios; se pueden hacer con el zip 0.9.1 en vez del 0.9.0):

- [x] En un problema real, las evidencias salen agrupadas (causa raíz arriba si la hay, después por entidad) y los filtros por tipo cuentan bien.
- [x] Si un problema real trae evidencias de métrica o de transacción, la tarjeta "antes → después" y su unidad tienen sentido. Si no lo tienen, se pasan a "Más detalles" en una 0.9.2. ("Abrir en Métricas" abre la métrica con el rango del problema.)
- [x] Un problema con más comentarios que los recientes enseña "Ver todos" y los trae; el XLSX del detalle ya no tiene la hoja Impacto.
- [x] Arrancar el zip 0.9.1 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.9.2

Pruebas a mano (mini gráfico; se pueden hacer con el zip 0.9.2 en vez del 0.9.1):

- [x] En un problema real con un evento de alerta de métrica, el mini gráfico sale, el periodo sombreado y la línea de inicio cuadran con la evidencia y, si hay umbral, la línea discontinua está donde toca.
- [x] "Abrir en Métricas" desde el gráfico abre esa misma consulta con ese rango, y la exportación XLSX del gráfico abre en Excel.
- [x] Arrancar el zip 0.9.2 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.10.0

Pruebas a mano (tabla de evidencias; se pueden hacer con el zip 0.10.0 en vez del 0.9.2):

- [x] En un problema real, las evidencias salen en tabla con los abiertos arriba, y se ve de un vistazo qué eventos siguen abiertos (también en un problema cerrado, si tiene alguno). Los contadores Todos/Abiertos/Cerrados cuadran y filtran.
- [x] Desplegar un evento con el ratón y con el teclado (Enter, Tab dentro, Escape): propiedades, zonas y etiquetas. El resumen de la causa raíz salta a su fila.
- [x] El mini gráfico de una evidencia con métrica, al desplegarla: pendiente del arreglo del eje de tiempo de la 0.10.2 (ponía "00:00" en todas las marcas en rangos de varios días).
- [x] Con un filtro puesto, exportar el XLSX: la hoja Evidencias trae solo lo filtrado, en el orden de la tabla, y la hoja Info lo dice. Volver a la lista y entrar otra vez al problema deja la tabla como estaba.
- [x] Arrancar el zip 0.10.0 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.10.1

Pruebas a mano (pantallas de error). Para verlas en desarrollo: `$env:VIGIA_E2E='1'; npm run dev` y, como la app no tiene barra de direcciones, desde la consola de DevTools (Ctrl+Mayús+I en dev): `location.hash = '#/__errors/unexpected'` (y `chunk`, `panel`, `fatal`). Con `VIGIA_E2E` la ventana se abre sin tomar el foco.

- [x] Cada variante se ve bien en claro y en oscuro: inesperado (Reintentar, Inicio, Recargar), actualizada (cuenta atrás que se puede cancelar), 404 (`#/esto-no-existe`), panel compacto y la de último recurso (`fatal`). El faro se mueve y, con "Reducir animaciones" de Windows, se queda quieto.
- [x] "Detalles técnicos" → "Copiar detalles": lo pegado no lleva tu usuario en las rutas (sale `<usuario>`).
- [x] Editar un fichero con `npm run dev` abierto: si sale una pantalla, es la de "El código ha cambiado mientras Vigía estaba abierta" con Recargar, no la de React Router.
- [x] Arrancar el zip 0.10.1 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## v0.10.2

Pruebas a mano (eje de tiempo; con el zip 0.10.2):

- [x] Abrir de nuevo el problema del "00:00" y desplegar la evidencia con mini gráfico: el eje enseña horas y, en el cambio de día, la fecha; por defecto los últimos 7 días, con la nota si el inicio queda antes, y "Todo" amplía. Métricas con 7 días y la línea de tiempo de Problemas también enseñan fechas y horas. (Cierra también la casilla del mini gráfico de la 0.10.0.)
- [x] Arrancar el zip 0.10.2 sobre sus datos (sin migraciones nuevas). **Antes, hacer una copia de `%APPDATA%\vigia`**; lo hace Dani.

## Fase 2

- [x] Se navega por todas las secciones (vacías) en ambos idiomas y temas.
- [x] La barra de título propia funciona: se arrastra la ventana y los botones nativos siguen al tema.
- [x] El tema cristal se lee bien en claro y en oscuro.
- Sin probar: el material nativo de Windows 11 (`backgroundMaterial: 'mica'`), que es opcional.

## Fase 3

- [x] Crear un cliente y un entorno real, guardar un token y comprobar que tras reiniciar sigue "Configurado" y el entorno sigue activo.
- [x] Exportar la configuración, importarla en otro PC (o en una carpeta de datos vacía) y comprobar el resumen.
- [x] Con el tema "Oscuro" y Windows en claro, la barra de título ya no parpadea al arrancar.

## Fase 4

- [x] "Probar conexión" funciona contra un tenant real con token clásico (y, si se usa, OAuth y platform token), y avisa de los scopes que faltan.
- [x] Detrás del proxy corporativo y con su CA: con el nivel "sistema" conecta sin tocar nada.
- [x] La tarjeta del pie muestra el estado real y la caducidad del token OAuth.
- [x] Arrancar el zip 0.4.0 sobre sus datos: aplica la migración 0001 sin perder clientes, entornos ni credenciales.

## Fase 6

- [x] El XLSX se abre en Excel con los tipos correctos (fechas y números) y el CSV muestra bien los acentos.
- [x] Inicio, Problemas y Métricas contra un tenant real, con exportación y capturas.
- [x] El zip 0.6.0 sobre sus datos aplica la migración 0002 (consultas guardadas) sin perder nada.

## Fase 1

Lo que se comprobó de la Fase 1 (en Linux): lint, tipos, 21 tests unitarios, 9 tests de extremo a extremo sobre la app compilada, `npm run dev` sin errores en consola, generación del zip de Windows y arranque de la app empaquetada (build de Linux).

Aceptación manual de la Fase 1 (comprobada por Dani en Windows):

- [x] `npm run dev` abre la ventana en Windows.
- [x] El zip (`npm run dist:win`) arranca en un PC sin Node.
- [x] El zip arranca en un PC corporativo (SmartScreen, AppLocker).
