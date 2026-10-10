# Registro de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

Sin migraciones nuevas.

### Añadido

- **Página de la aplicación web con datos de RUM.** Ahora tiene seis marcadores (Apdex, usuarios activos —marcado como «estimado», con una explicación al pasar el ratón—, sesiones con duración media y rebote, acciones por tipo, errores por tipo y problemas) y se organiza en secciones: «Actividad» (acciones y duración por tipo), «Errores» (errores por tipo, con JavaScript y HTTP separados, y acciones afectadas), «Apdex» y «Acciones clave». Sustituye los totales de acciones, duración y errores de la ficha 0034. Una sección sin datos no sale. Sin migraciones nuevas. (ficha 0053)
- **Datos de RUM de la aplicación web (aún sin pantalla).** Un canal nuevo, `entities:applicationRum`, devuelve para una aplicación web, en el rango elegido, serie y total de: acciones y duración por tipo (carga, XHR y personalizada), errores por tipo (JavaScript, HTTP y otros), porcentaje de acciones con errores, usuarios activos (una estimación de Dynatrace), sesiones iniciadas y terminadas, duración de sesión, acciones por sesión, rebote, Core Web Vitals (LCP, CLS e INP, percentil 75) y clics de frustración. Solo usa la API clásica de métricas (nada de Grail ni DQL) y distingue los errores HTTP de los de JavaScript. Un 400 o un 404 de Dynatrace llega con su motivo. La vista llega en las fichas 0053 y 0054. Sin migraciones nuevas. (ficha 0052)
- **Process group: «Ver todas» con un modal de instancias.** La tabla de instancias enseña las 20 de más CPU y, si hay más, debajo dice «20 de 1.234 instancias, las de más CPU» (o «puede haber más» si no se sabe el total) con el botón «Ver todas». El botón abre un modal centrado, con la lista completa, un buscador por nombre o host, orden por columna y enlaces al proceso y al host (pulsar uno cierra el modal y navega; «Volver» regresa al grupo). Entra con una transición de fondo desenfocado y panel que sube con escala y un leve rebote, y sale más rápido; con «reducir el movimiento» de Windows, solo un fundido corto. La lista se pide al abrir y se guarda: reabrir no vuelve a pedirla, y «Actualizar» con el modal cerrado solo la marca como vieja. Si Dynatrace recorta la consulta (unas 498 instancias), un aviso arriba dice «se muestran N de M»; si falla, Reintentar dentro del modal. Si la lista de la tabla está recortada pero se sabe el total, el marcador «Instancias» enseña el número exacto y la tabla avisa de que la lista puede estar incompleta. Sin migraciones nuevas. (ficha 0051)
- **Etiquetas de las páginas de entidad en forma de cápsula.** Cada etiqueta `clave:valor` se ve como una píldora de dos mitades: la izquierda (la clave) en un color vivo con texto blanco y la derecha (el valor) clara en el tema claro y de gris profundo en el oscuro, con un borde fino que las rodea y divide, un degradado suave y un brillo arriba. El color depende de la clave (8 tonos; `Equipo` y `equipo` comparten color), así que las etiquetas de una misma familia se reconocen de un vistazo. Una etiqueta de solo clave es una cápsula entera de su color, y el contexto (si no es `CONTEXTLESS`) sale como prefijo pequeño y apagado (`AWS ·`). Al pasar el ratón hay un realce ligero. El orden, el «+N» y el tooltip no cambian, y los lectores de pantalla siguen oyendo `clave:valor`. Sin migraciones nuevas. (ficha 0049)
- **Gráfico de disponibilidad en la página del servicio.** Encima de la rejilla de gráficos sale «Disponibilidad (SLO calculado)», a todo el ancho: la línea de (peticiones − errores) / peticiones × 100, una línea discontinua en el **90 %** («Crítico 90 %») y los tramos por debajo sombreados en el color de error. Un tooltip en el nombre explica la fórmula y aclara que lo calcula Vigía (no es un SLO de Dynatrace). Sin peticiones, o si falta una de las dos series, queda un hueco, no un 0. El marcador «Tasa de error» añade debajo «Disponibilidad 99,5 %» con el valor del rango; si baja del 90 %, va en color de error y con el texto «por debajo del 90 %». En **Solo actividad** (colas) no hay errores y no salen ni el gráfico ni la línea. Sin migraciones nuevas. (ficha 0048)

### Cambiado

- **Process group: las 20 instancias de más CPU y el total real.** La tabla de instancias de un grupo grande pasa a traer las 20 que más CPU consumen (antes, un subconjunto cualquiera si había más de unas 498), con su memoria y su host, y el número total de instancias del grupo tal como lo cuenta Dynatrace; si no se puede saber (sin acceso a entidades), se dice. Un canal nuevo, `entities:processGroupInstances`, devuelve la lista completa ordenada por CPU y avisa si Dynatrace la recortó (tope de 1000 series, unas 500 instancias); se usará desde el botón «Ver todas» de la ficha 0051, así que aún no se ve en pantalla. Sin migraciones. (ficha 0050)

- **La página del servicio se adapta a su tipo.** La cabecera enseña el tipo junto a «Servicio» (por ejemplo «Servicio · Base de datos», con nombre legible en español e inglés; un tipo desconocido sale tal cual). Los marcadores y gráficos siguen el conjunto de métricas: en **Solo actividad** (colas) quedan Peticiones, Problemas y un gráfico de actividad, con una nota que lo explica; en **Cliente** y **Unificadas** salen los mismos marcadores y gráficos con una nota bajo ellos («Medido desde los clientes» / «Métricas unificadas») y su ayuda. Si no se puede leer la entidad (por ejemplo sin `entities.read`), una nota dice que se usan las métricas de servidor por defecto. «Abrir en Métricas» usa ya las métricas del conjunto del servicio. Los servicios web se ven como antes. Sin migraciones nuevas. (ficha 0047)
- **Las métricas de un servicio dependen ahora de su tipo (`serviceType`).** Antes todos los servicios usaban las métricas de servidor. Ahora la app lee primero la entidad y elige el conjunto: **Servidor** (WEB_SERVICE, CUSTOM_SERVICE, BACKGROUND_ACTIVITY, SPAN, MESSAGING_SERVICE, y WEB_REQUEST_SERVICE con servidor web o RPC_SERVICE sin extremo remoto), **Cliente** (WEB_REQUEST_SERVICE sin servidor web, DATABASE_SERVICE, RPC_SERVICE con extremo o servicio remoto), **Unificadas** (UNIFIED, con la tasa de error calculada por la app) y **Solo actividad** (QUEUE_LISTENER_SERVICE: solo peticiones, sin tiempos ni errores). Un tipo desconocido, o si no se puede leer la entidad (por ejemplo sin `entities.read`), usa Servidor y deja un aviso. **Decisión pendiente de que Dani la confirme:** EXTERNAL va a **Cliente**, no a Servidor como decía la tabla inicial, porque en vivo solo tiene datos de Cliente y con Servidor saldría vacío; es cambiar una fila si Dani lo prefiere distinto. Por dentro, `entities:serviceMetrics` devuelve además `serviceType`, `metricSet` y `metricKeys`, y en Solo actividad los tiempos y errores llegan vacíos. La vista por tipo llega en la ficha 0047. Sin migraciones nuevas. (ficha 0046)

## [0.11.0] - 2026-10-10

Análisis de entidades: páginas propias para servicio, host, disco, proceso, grupo de procesos,
browser y HTTP monitor y aplicación web, con marcadores, gráficos, franja de problemas, etiquetas e
«Información»; descripciones de problemas con Markdown y HTML de formato seguro; flujo con agentes y
avisos por Telegram. Fichas 0001 a 0045.

Sin migraciones nuevas.

### Añadido

- **Hace falta un scope nuevo: `events.read` en el token** (en OAuth, `environment-api:events:read`). «Probar conexión» lo da como scope que falta y la tarjeta enseña el aviso si no lo tiene (además de `entities.read`, que usa para leer las relaciones del host). Página del host: tarjeta «Eventos» justo antes de «Información», con los 20 eventos más recientes del rango de la barra superior, tanto los del host como los de lo que corre en él (procesos, discos, interfaces de red, grupos de contenedores, nodo de Kubernetes y máquina virtual de la nube). Cada fila enseña el tipo (en una píldora), el título como texto, la entidad (con enlace a su página si la tiene), el inicio, el fin o «Activo» y el estado; si hay más, «20 de N». Por dentro, canal nuevo `entities:hostEvents`, que reparte los identificadores en varias consultas si no caben en una. Por confirmar con Dani: que los eventos cuadran con Dynatrace. Sin migraciones nuevas. (ficha 0042)
- Página del host: tarjeta «Logs» entre las tablas de discos y procesos y la tarjeta «Información». Enseña un resumen («3 de 12 procesos con logs») y la lista de los procesos con logs detectados: nombre (con enlace a su página), estado del fichero de log (con texto y color: se lee, no existe, ya no se monitoriza), estado de la fuente y última actualización, de la más reciente a la más antigua. Sin procesos con logs sale «Sin logs detectados»; sin el permiso de entidades, el aviso de qué falta; y si Dynatrace tiene más procesos de los que se piden (10 páginas de 500), la tarjeta avisa de que el recuento es parcial. Nunca se enseñan las rutas de los ficheros de log. Por dentro, canal nuevo `entities:hostLogs`. Por confirmar con un host real con logs: que la tarjeta cuadra con Dynatrace. Sin migraciones nuevas. (ficha 0041)
- Página del disco: al pulsar un disco en la tabla «Discos» de un host se abre su página (con «Volver» al host, sin volver a pedir sus datos). Arriba, marcadores del rango de la barra superior: uso (máximo; aviso por encima del 80 % y error por encima del 90 %, siempre con texto), libre, lectura y escritura medias, latencia (o cola, si el disco no trae latencia) y problemas. Debajo, cuatro gráficos en rejilla de 2×2: uso con la franja de problemas, espacio (usado y libre apilados), lectura y escritura, y latencia o cola, con «Abrir en Métricas» y exportación. Al final, la tarjeta «Información» (sistema de ficheros, «Disco de» con enlace al host, fechas). Lo que un disco no trae no se pinta. Por dentro, canal nuevo `entities:diskMetrics`. Sin migraciones nuevas. (ficha 0040)
- En la página del host, la memoria enseña ahora la usada y la recuperable apiladas, con la total como línea discontinua, y el eje va en bytes (GB). El marcador de memoria sigue con el % usado y añade «usada de total» y la memoria recuperable, con un icono de ayuda que explica qué es (en español y en inglés). Sin migraciones nuevas. (ficha 0039)
- El visor de Markdown (descripciones de los eventos y de las evidencias) tiene ahora una capa visual más cuidada. Los bloques de código salen en una caja con el lenguaje arriba a la izquierda, números de línea, colores de sintaxis (yaml, json, bash, sql, javascript, typescript, python, java y xml; el resto, sin colores) y un botón «Copiar» que copia el código sin los números y avisa con «Copiado». El código en línea sale como una píldora de color de acento. Las citas `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` y `[!CAUTION]` salen como avisos con icono, título y color (en español y en inglés). Los elementos de lista o párrafos que empiezan por ✓ ✔ ✅, ✗ ✘ ❌ o ⚠ colorean la marca en verde, rojo o ámbar. Títulos, separadores, tablas y citas tienen más jerarquía, en claro y en oscuro. El HTML en crudo sigue saliendo como texto. Dependencias nuevas: lowlight 3.3.0 y highlight.js 11.11.2. Sin migraciones nuevas. (ficha 0038)
- En el detalle de un problema, la «Descripción» con formato Markdown sale ahora en todos los tipos de evidencia (métrica, transacción, disponibilidad…), no solo en los eventos. Las otras propiedades cuya clave lleva «description» también se enseñan como Markdown, cada una en su sección con «Copiar», en vez de como texto en la lista de propiedades. Sin migraciones nuevas. (ficha 0035)
- La página de la aplicación web deja de estar en construcción: enseña marcadores (Apdex con su categoría y color, acciones, duración, errores y problemas), cuatro gráficos (Apdex con la franja de problemas, acciones, duración y errores), la tabla de las 10 acciones clave con más volumen, ordenable por columna, y la tarjeta «Información» al final, con sus relaciones. Lo que una aplicación no tiene como dato no se pinta. Sin migraciones nuevas. (ficha 0034)
- Nuevo canal interno `entities:applicationMetrics` para la futura página de la aplicación web (todavía sin pantalla): devuelve, para una aplicación y el rango de la barra superior, las series y los totales de Apdex, acciones de usuario, duración (visually complete de las acciones de carga), errores y sesiones empezadas, y las 10 acciones con más volumen con su recuento y su duración media. Un papel sin datos llega con series vacías; si Dynatrace rechaza la consulta, el error lo explica. Las acciones solo salen si son acciones clave y la lista puede venir vacía. Medido en vivo y de solo lectura. Sin migraciones nuevas. (ficha 0033)
- Página del process group: ya no está en construcción. Arriba, las etiquetas y cinco marcadores del rango de la barra superior: instancias (cuántas), CPU (media del grupo y, debajo, la máxima; aviso por encima del 80 % y error por encima del 90 %, siempre con texto), memoria, red (entrada y salida) y problemas. Debajo, cuatro gráficos en rejilla de 2×2: CPU con la franja de problemas, memoria, red y CPU por instancia (una línea por instancia, las cinco con más CPU), con «Abrir en Métricas» y exportación. Después, la tabla «Instancias» (nombre, host, CPU con barra y memoria, de más a menos CPU), con enlace a la página de cada proceso y de su host, y al final la tarjeta «Información» (tecnologías, puertos, nombre detectado y relaciones con «Ver nombres»), sin línea de comandos ni rutas. Si Dynatrace recorta las instancias, el marcador sale como «N+» con la nota «Como mínimo» y la tabla avisa. «CPU por instancia» hace cinco consultas más (una por instancia) al pulsar «Actualizar» o cambiar el rango. Por confirmar con process groups reales: que marcadores, gráficos e instancias cuadran con Dynatrace. Sin migraciones nuevas. (ficha 0032)
- Nuevo canal interno `entities:processGroupMetrics` para la futura página del process group (todavía sin pantalla): devuelve, para un grupo y el rango de la barra superior, las series del total de sus instancias (CPU, memoria y red de entrada y salida), los marcadores (CPU media y máxima, memoria y red medias) y una lista de instancias con su nombre, su host y su CPU y memoria medias, de más a menos CPU. Un grupo sin datos llega con todo vacío; si Dynatrace rechaza la consulta, el error lo explica. Con muchas instancias (desde unas 498 en el rango) Dynatrace recorta la respuesta y el canal lo avisa. Medido en vivo y de solo lectura. Sin migraciones nuevas. (ficha 0031)
- Páginas de servicio, host, browser monitor, HTTP monitor y proceso: las etiquetas salen como píldoras `clave: valor` justo debajo de la cabecera, antes de los marcadores, y dejan de repetirse en la tarjeta «Información». La clave y el valor tienen tonos distintos (claro y oscuro); una etiqueta de solo clave enseña solo la clave; si tiene contexto, lleva un prefijo pequeño y apagado (`[AWS]`). Van en orden alfabético por clave, en dos líneas como mucho, con «+N» para desplegar el resto, y un tooltip con el texto completo. Sin etiquetas o sin el permiso de entidades, la fila no sale. Por dentro, el canal `entities:get` devuelve ahora las etiquetas estructuradas (`context`, `key`, `value`). Sin migraciones nuevas. (ficha 0037)
- Página del proceso: tarjeta «Información» entre la cabecera y los marcadores, breve y con el detalle plegado. Enseña, solo con lo que viene: tecnologías (como chips), puertos de escucha (separados por « · »), nombre detectado, ejecutable (solo el nombre del fichero), visto por primera y última vez, zonas y etiquetas. Debajo, las relaciones («Se ejecuta en», «Process group», «Servicios» y «Otras relaciones»), con «Ver nombres» a demanda y enlaces a cada página, y «Todas las propiedades» plegadas. Sin el permiso de entidades sale el aviso de qué falta y los marcadores y gráficos siguen. Sin migraciones nuevas. (ficha 0029)
- Página del proceso (desde la tabla de procesos del host o desde «Analizar entidad»): ya no está en construcción. Arriba, hasta cinco marcadores del rango de la barra superior: CPU (media y máxima, en aviso por encima del 80 % y en error por encima del 90 %, siempre con texto), memoria (media y máxima), red (entrada y salida medias), disponibilidad (aviso por debajo del 99 % y error por debajo del 95 %) o, si no hay, recursos (descriptores de fichero), y problemas abiertos y cerrados. Debajo, gráficos en rejilla de 2×2 (una columna si la ventana es estrecha): CPU con la franja de problemas encima, memoria, red (entrada y salida) y salud de red o recursos, con «Abrir en Métricas» y exportación. Lo que el proceso no tiene no se pinta, y cada panel falla por su lado con «Reintentar». Por confirmar con procesos reales: que recursos (en %) cuadra con Dynatrace. Sin migraciones nuevas. (ficha 0028)
- Nuevo canal interno `entities:processMetrics` para la futura página del proceso (todavía sin pantalla): devuelve, para un proceso y el rango de la barra superior, las series y los marcadores de CPU, memoria, red (entrada y salida), salud de red (retransmisiones), disponibilidad y descriptores de fichero. Un proceso sin datos de un apartado llega con ese apartado vacío; si Dynatrace rechaza la consulta, el error lo explica. Medido en vivo y de solo lectura; la línea de comandos del proceso no se usará porque puede llevar contraseñas. Sin migraciones nuevas. (ficha 0027)
- Páginas de browser monitor y de HTTP monitor: tarjeta «Información» entre la cabecera y los marcadores, breve y con el detalle plegado. Enseña, solo con lo que viene: tipo de monitor, estado (Activo o Inactivo), frecuencia («Cada N minutos»), dispositivo (browser), número de localizaciones y de pasos o peticiones, última ejecución, visto por primera y última vez, zonas y etiquetas. Debajo, las relaciones («Monitoriza», «Localizaciones», «Pasos» o «Peticiones» y «Otras relaciones»), con «Ver nombres» a demanda y enlaces a cada página, y «Todas las propiedades» plegadas. Sin el permiso de entidades sale el aviso de qué falta y el resto de la página sigue. Las tarjetas del servicio y del host no cambian. La unidad de la frecuencia (minutos) está por confirmar con monitores reales. Sin migraciones nuevas. (ficha 0026)
- Páginas de browser monitor y de HTTP monitor: debajo de los gráficos, dos tarjetas lado a lado (una columna si la ventana es estrecha). «Localizaciones»: nombre, barra de disponibilidad con su % (aviso por debajo del 99 % y error por debajo del 95 %, siempre con texto), duración media y ejecuciones fallidas, de peor a mejor disponibilidad. «Pasos» (browser) o «Peticiones» (HTTP): en su orden, con duración media y una barra con su peso en la duración total; el más lento va resaltado con texto. Ambas se ordenan por columna y cada una carga y falla por su lado (aviso con «Reintentar», sin afectar a los gráficos). Si no hay pasos que enseñar, la tarjeta de pasos no sale y la de localizaciones sí. Pulsar una localización no cambia los gráficos. Sin migraciones nuevas. (ficha 0025)
- Páginas de browser monitor y de HTTP monitor: ya no están en construcción. Arriba, cinco marcadores del rango de la barra superior: disponibilidad (con aviso por debajo del 99 % y error por debajo del 95 %, siempre con texto además del color), duración (media y, en browser, mediana), ejecuciones correctas y fallidas, localizaciones (y cuántas están por debajo del 100 %) y problemas abiertos y cerrados. Debajo, gráficos en rejilla de 2×2 (una columna si la ventana es estrecha): disponibilidad con la franja de problemas encima, duración, ejecuciones (correctas y fallidas apiladas) y rendimiento (experiencia en browser; tiempos DNS, TCP y TLS en HTTP; si no hay datos de rendimiento, el gráfico no sale). Cada gráfico tiene «Abrir en Métricas» y exportación. Sin migraciones nuevas. (ficha 0024)
- Página del host: tarjeta «Información» entre la cabecera y los marcadores, breve y con el detalle plegado. Enseña, solo con lo que viene: sistema, capacidad (memoria en GB), red (las primeras IP y «+N»), monitorización, grupo, nube o virtualización, visto por primera y última vez, zonas y etiquetas. Debajo, las relaciones con procesos, servicios, «Se ejecuta en» y grupo de hosts, con «Ver nombres» a demanda y enlaces a cada página (con «Volver» al host), y «Todas las propiedades» plegadas. Sin el permiso de entidades sale el aviso de qué falta y el resto de la página sigue. La tarjeta del servicio no cambia. Corregido de paso: «Ver las N IP/etiquetas restantes» ahora concuerda en singular y plural. Sin migraciones nuevas. (ficha 0020)
- Página del host: debajo de los gráficos, dos tablas lado a lado (una columna si la ventana es
  estrecha). «Discos»: uso con barra y nivel de aviso (más del 80 %) o error (más del 90 %) siempre
  con texto, usado y total, libre, lectura y escritura. «Procesos»: los 10 con más CPU, con CPU media
  (con barra) y máxima y memoria, y debajo «10 de N procesos». Ambas se ordenan por columna, cada una
  carga y falla por su lado (aviso con «Reintentar») y cada proceso enlaza a su página, con «Volver»
  al host. Si la lista de procesos viene recortada por el tope de la API, un aviso dice que la lista y
  el total pueden estar incompletos. Sin migraciones nuevas. (ficha 0019)
- Página del host (desde «Analizar entidad» en una evidencia de un host): ya no está en
  construcción. Arriba, cinco marcadores del rango de la barra superior: CPU (media y máxima),
  memoria (media y usada de total en GB), red (entrada y salida medias, con la unidad adaptada),
  disco (el más lleno) y problemas (abiertos y cerrados). CPU, memoria y disco se ponen en aviso por
  encima del 80 % y en error por encima del 90 %, siempre con texto además del color. Debajo,
  cuatro gráficos en rejilla de 2×2 (una columna si la ventana es estrecha): CPU (total y, aparte,
  `user`, `system` e `iowait`, sin apilar porque no suman el total) con la franja de problemas del
  host encima, memoria, red (entrada y salida) y disco, con «Abrir en Métricas» y exportación. El
  servicio no cambia de aspecto. Sin migraciones nuevas. (ficha 0018)
- Página del servicio (desde «Analizar entidad» en el detalle de un problema), completa con el lote
  «servicio» (fichas 0006 a 0010). Arriba, cinco marcadores del rango de la barra superior:
  peticiones OK y KO, tasa de error, tiempo de respuesta (mediana grande, con p90 y p99 debajo) y
  problemas abiertos y cerrados; sin datos sale «—», no 0. Una línea indica el rango y la resolución
  («Últimas 2 h · datos por minuto»), y «Actualizar» vuelve a pedir los datos. Debajo, «Métricas de
  peticiones» con cuatro gráficos en rejilla de 2×2 (una columna si la ventana es estrecha): tiempo
  de respuesta (mediana, p90 y p99), actividad (OK y KO apiladas, por minuto), tasa de error y
  errores por minuto. Los huecos sin datos se ven como huecos; el tooltip da la fecha y el valor de
  cada serie, y la leyenda oculta series. Cada gráfico se carga y falla por su lado (aviso con
  «Reintentar»), tiene «Abrir en Métricas» (con el rango que se ve) y se exporta como imagen o XLSX.
  Sobre el gráfico de tasa de error, una franja con un tramo por cada problema de la entidad en el
  rango, abiertos y cerrados (los abiertos en rojo y los cerrados apagados, siempre con icono y
  texto), repartidos en filas si se solapan (hasta 3; si hay más, «+N»). Cada tramo enseña al pasar
  el ratón o al enfocarlo el id, el título, el estado, el inicio y el fin (o «Activo»), y al
  pulsarlo abre el problema; «Volver» regresa a la página del servicio sin volver a cargarla. Sin
  problemas en el rango no hay franja; si falla, un aviso compacto con «Reintentar» y el gráfico
  sigue; si la lista viene recortada, una nota lo dice. Las páginas de los otros tipos de entidad
  siguen en construcción. Dos colores nuevos del tema para las series. Sin migraciones nuevas.
  (fichas 0008, 0009 y 0010)
- Página del servicio: tarjeta «Información» entre la cabecera y los marcadores, en dos columnas (una con la ventana estrecha). «Servicio» enseña, solo con lo que venga, el tipo, las tecnologías, dónde escucha, la aplicación, la nube, cuándo se vio por primera y última vez, las zonas y las etiquetas (seis y «+N» para el resto). «Relaciones» las agrupa en «Se ejecuta en», «Llama a», «Lo llaman» y «Otras relaciones», cada grupo con su número; al desplegarlo sale la lista (hasta 50, con «Mostrando 50 de N»), y «Ver nombres» pide los nombres solo entonces. Cada entidad es un enlace a su página y «Volver» regresa al servicio. «Todas las propiedades» queda plegada al final. Sin el permiso de lectura de entidades, la tarjeta dice qué falta y marcadores y gráficos siguen; si falla, aviso con «Reintentar». Sin migraciones nuevas. (ficha 0015)
- Detalle del problema: al desplegar un evento de la tabla de evidencias, su descripción sale la
  primera, en una sección «Descripción» con formato (títulos, listas, negrita, código, tablas, citas
  y enlaces), siempre con formato: no hay un modo para ver el texto tal cual, y «Copiar» copia el
  texto original (el Markdown sin pintar). La descripción ya no se repite en
  la lista de propiedades y llega entera aunque el evento tenga muchas propiedades (hasta 5 000
  caracteres; si se recorta, una nota lo dice). Por seguridad, el HTML que traiga se ve como texto,
  solo los enlaces web se abren (en el navegador del sistema) y las imágenes no se cargan: se ve su
  texto alternativo o su dirección. (fichas 0001 y 0002: la 0002 quitó, a petición de Dani, el
  conmutador «Con formato · Texto original» que añadía la 0001 antes de publicarse)
- Detalle del problema: al desplegar una evidencia que tiene entidad, un botón «Analizar entidad»
  lleva a una página de análisis de esa entidad, una por tipo (Host, Servicio, Proceso, Process
  group, Browser monitor, HTTP monitor, Aplicación web, Cloud application y Entorno); cualquier otro
  tipo, también los personalizados, abre una página genérica con el código del tipo. De momento
  todas están en construcción: enseñan el nombre de la entidad, su tipo y su id, sin pedir nada a
  Dynatrace. «Volver» regresa al problema con la evidencia aún desplegada y sin volver a cargarlo.
  (ficha 0003)

### Cambiado

- Las descripciones con Markdown (eventos y evidencias de los problemas) ahora interpretan el HTML de formato en vez de enseñarlo como texto: colores con `<span style="color:…">` o `<font color>`, fondos con `background-color`, `<b>`, `<i>`, `<mark>`, `<kbd>`, `<sub>`, `<sup>`, listas, tablas y `<details>`. Solo se admite una lista de etiquetas de formato; un color que no se leería sobre el fondo del tema se ajusta para que se lea en claro y en oscuro. Por confirmar con una descripción real con HTML de formato. Dependencias nuevas: rehype-raw 7.0.0 y rehype-sanitize 6.0.0 (ADR-0011, que sustituye la regla del HTML en crudo del ADR-0008). Sin migraciones nuevas. (ficha 0043)
- El límite de la descripción de una evidencia sube de 5 000 a 9 000 caracteres (en vivo la más larga mide 4 096); si se pasa, la interfaz avisa del recorte. (ficha 0035)
- Páginas de servicio, host, browser monitor, HTTP monitor y proceso: la tarjeta «Información» pasa al final de la página. El orden es ahora cabecera, marcadores, gráficos, demás tarjetas (discos y procesos del host, localizaciones y pasos de los monitores…) e «Información», que en un host puede ser muy alta. La tarjeta no cambia por dentro. Las páginas nuevas de entidad seguirán este orden solas. Sin migraciones nuevas. (ficha 0036)
- Proyecto: los e2e que leen una exportación esperan siempre al aviso «Guardado» y a que el fichero
  tenga contenido; un test lo vigila. Arregla un intermitente que ponía el CI en rojo. Sin
  migraciones nuevas. (ficha 0030)
- «Probar conexión» comprueba ahora también el permiso `entities.read` del token
  (`environment-api:entities:read` con OAuth), que la próxima sección «Información» de la página del
  servicio necesita; si falta, lo avisa como con los demás. Hay que añadirlo al token del entorno.
  Sin migraciones nuevas. (ficha 0014)
- Flujo de trabajo más ágil (no cambia la app): las peticiones grandes se trocean en lotes de fichas
  que se aprueban de una vez, `/tarea` admite varias fichas en cola, las fichas pequeñas y sin riesgo
  van por un camino corto, y el Planificador también avisa por Telegram cuando hay algo que aprobar.
  Ver `docs/flujo.md` y el ADR-0010.
- Forma de trabajar del proyecto (no cambia la app): fichas de tarea con criterios de aceptación,
  agentes especializados de Claude Code, hooks de git de pre-commit y pre-push, y CI en GitHub
  Actions sobre Windows (`check`, e2e completo y `dist:win`) en cada push a `main`. Ver
  `docs/flujo.md` y el ADR-0007.
- Forma de trabajar del proyecto (no cambia la app): aviso opcional por Telegram al terminar
  `/tarea` (hecha, bloqueada o parada esperando una decisión de Dani) y `/cerrar-version` (cerrada
  o fallida), con un resumen corto. Las credenciales van en variables de usuario de Windows, el
  texto pasa antes por el filtro de restos del tenant y, si algo falla, se avisa en la terminal y el
  flujo sigue. Ver `docs/flujo.md` y el ADR-0009. (ficha 0004)
- Forma de trabajar del proyecto (no cambia la app): el CI vuelve a salir en verde. Los cinco tests
  de punta a punta que fallaban según la máquina (en el CI y en el servidor de pruebas) se han
  sustituido por versiones estables que comprueban lo mismo, con la ventana a un tamaño fijo, y las
  acciones `checkout` y `setup-node` del CI pasan a la v7 (Node 24). (ficha 0005)
- Forma de trabajar del proyecto (no cambia la app): los tests de punta a punta ya no dependen de la
  zona horaria ni del escalado del escritorio, y el CI vuelve a salir en verde. El de la fecha
  personalizada calcula lo esperado en la zona del equipo (el CI está en UTC) y la espera del tamaño
  de ventana admite hasta 2 px de redondeo de Windows al escalar. Sin migraciones nuevas. (ficha 0011)
- Forma de trabajar del proyecto (no cambia la app): todos los tests de punta a punta arrancan con la
  ventana del tamaño del CI (1024×720), así que lo que pasa en local pasa en el CI. Sin migraciones
  nuevas. (ficha 0021)
- Página del servicio: los gráficos ya no llevan líneas horizontales de rejilla (se mantienen las
  etiquetas del eje) y el texto de las cinco tarjetas de marcadores queda centrado, también en las
  filas de p90/p99 y de abiertos/cerrados y con la ventana estrecha. Los números de cuatro cifras o
  más llevan siempre separador de miles en toda la interfaz («9.907» en español, «9,907» en inglés),
  también en los ejes, los tooltips y los avisos. Las exportaciones a Excel no cambian. Sin
  migraciones nuevas. (ficha 0012)

### Seguridad

- Las propiedades de log de los procesos (`logFileStatus`, `logPathLastUpdate` y `logSourceState`) ya no llegan a la interfaz: llevan rutas de ficheros en sus claves, que pueden incluir nombres de usuario o de cliente. Se quitan de `entities:get` y, con ello, de «Todas las propiedades»; el estado de los logs se ve en la tarjeta «Logs» del host, sin rutas. (ficha 0041)
- El HTML que se interpreta en las descripciones pasa por una lista blanca: `script`, `style`, `iframe`, `img`, `svg`, `form`, `object` y `embed` no se crean (los que llevan contenido se quitan con él), no se admiten atributos `on*`, `class` ni `id`, `style` solo conserva `color` y `background-color` con valores válidos, y los enlaces solo abren `http:` y `https:` en el navegador del sistema. La CSP no cambia. (ficha 0043)
- La línea de comandos, los argumentos, las variables de entorno y las rutas de ejecutable (como `COMMAND_LINE_ARGS` o `EXE_PATH`) ya no llegan a la interfaz desde ninguna entidad, ni en la tarjeta ni en «Todas las propiedades»: pueden llevar contraseñas, tokens o el nombre del usuario. El filtro está en el proceso principal, antes de mandar la entidad a la pantalla. Otras rutas de `metadata` (por ejemplo, de scripts o `.jar`) siguen pasando; queda anotado en el backlog. (ficha 0029)

### Corregido

- Pruebas automáticas: el test que comprueba que la ventana de la prueba se ve sin quitarle el foco a quien usa el PC deja de fallar de forma intermitente (leía el estado antes de que la ventana se enseñara). Ahora espera, con tiempo acotado, a verla y comprueba el foco en esa misma lectura, así que si tuviera el foco seguiría fallando. Cambia solo el código de pruebas; la app no cambia. Sin migraciones nuevas. (ficha 0045)
- Pruebas automáticas: el test del menú lateral plegado y los demás que usan el ratón sobre tooltips dejan de fallar de forma intermitente en el CI (el ratón llegaba antes de que acabara la animación del menú, o con el tooltip de otro botón aún abierto). Cambia solo el código de pruebas; la app no cambia. Sin migraciones nuevas. (ficha 0044)
- Página del servicio: la franja de problemas sobre «Tasa de error» se veía cortada (los tramos
  cortos dejaban el icono a medias). Ahora cada tramo se ve entero, con su icono, con cualquier
  escalado de pantalla; si no cabe el id, se ve solo el icono, centrado (también con ids largos), y el
  id sigue en el tooltip. Sin migraciones nuevas. (ficha 0013)
- Métricas: el aviso «la API ha devuelto solo parte de los puntos» salía en casi todas las consultas
  aunque no faltara nada. Ahora solo sale cuando de verdad falta algo, y dice qué parte llegó («…
  alrededor del 67 % de los pedidos»). Lo mismo para las dimensiones y para el aviso del XLSX. Por
  debajo hay además un canal interno nuevo con las métricas de un servicio (series y totales) que
  todavía no se ve en la interfaz: lo mostrarán las fichas siguientes del lote servicio.
  (ficha 0006)
- Con la ventana pequeña (unos 1024 px de ancho o menos), la ruta de la barra superior no se veía y
  no se podía pulsar para volver a la sección. Ahora la sección y el detalle se ven siempre enteros:
  se recorta «Cliente › Entorno» (que sigue en el selector de entorno, que también encoge) y la
  búsqueda queda solo con la lupa por debajo de 1280 px (Ctrl+K sigue igual). Con la ventana grande,
  la barra se ve como antes. (ficha 0005)
- En Inicio, con la ventana pequeña, tras exportar los SLOs el aviso «Guardado: …» sacaba el botón
  de exportar de la tarjeta y no se podía volver a exportar hasta recargar. Ahora el aviso se
  recorta con «…» (al pasar el ratón se ve entero) y el botón sigue en su sitio. (ficha 0005)

## [0.10.2] - 2026-10-04

Arreglo del eje de tiempo de los gráficos, visto por Dani en un problema real. Sin migraciones
nuevas.

### Corregido

- El eje de tiempo de los gráficos mostraba 00:00 en rangos de varios días. Ahora, en los tres
  gráficos (mini gráfico de las evidencias, Métricas y la línea de tiempo de Problemas), el eje sale
  en hora local con la fecha en el cambio de día y la hora en el resto, y solo la fecha cuando los
  puntos son diarios (según la resolución que devuelve Dynatrace). El tooltip enseña la fecha y la
  hora completas.

### Añadido

- Mini gráfico de una evidencia de más de 7 días: por defecto enseña los últimos 7 días, con un
  selector «7 d · 30 d · Todo». Si el inicio queda fuera, lo dice con una nota y no pinta su línea.
  «Abrir en Métricas» y la exportación llevan el rango que se ve (la hoja Info lo indica).

## [0.10.1] - 2026-10-04

Pantallas de error propias en lugar de la de React Router, a petición de Dani. Sin migraciones
nuevas.

### Añadido

- Pantalla de error con el faro de Vigía, dentro de la app (el menú sigue): error inesperado con
  Reintentar, Ir a Inicio y Recargar; «Vigía se ha actualizado» si falta una parte de la interfaz,
  con Recargar y una cuenta atrás de 5 s que se puede cancelar (recarga sola una vez por minuto
  como mucho); y una página propia para las rutas que no existen (antes llevaba a Inicio sin
  decir nada).
- Si falla un gráfico o una tabla, un aviso compacto en su sitio con Reintentar; el resto de la
  página sigue funcionando.
- Una pantalla mínima de último recurso si falla lo que está por encima de las páginas.
- «Detalles técnicos» plegados, con «Copiar detalles». Lo que se copia y lo que va al log no lleva
  secretos, ni el nombre del usuario en las rutas, ni credenciales en las URLs.
- Los errores de la interfaz quedan en el log de la app (sin repetidos y como mucho 10 por minuto).
- La animación del faro (haz que barre, cambiar la bombilla, buscar, sacudida) se queda quieta si
  Windows tiene activado reducir el movimiento.

### Causa del error al actualizar

- Causa del error al actualizar: recarga en caliente de Vite en desarrollo con cambios a medio
  escribir; no afecta a la app empaquetada. En desarrollo, un error justo después de una recarga en
  caliente lo dice así («El código ha cambiado mientras Vigía estaba abierta»), con Recargar y sin
  cuenta atrás. Ese código no llega a la app empaquetada.

## [0.10.0] - 2026-10-04

Las evidencias del detalle del problema pasan a ser una tabla con el estado propio de cada
evento, a petición de Dani. Sin migraciones nuevas.

### Añadido

- Tabla de evidencias con el mismo grid que la lista de Problemas: estado (Abierto/Cerrado, con
  su barra), evento, tipo, entidad (su tipo en un tooltip), inicio, fin («Activo»), duración («en
  curso»), etiquetas (2 y «+N»), causa raíz e indicadores (mantenimiento, frecuente, suprimido).
  Por defecto, abiertos primero y los más recientes arriba; orden por columna.
- Cada evento tiene su propio estado: el que manda Dynatrace en `data.status` o, si no viene, el
  que se deduce de su fin. Un problema cerrado puede tener eventos que siguen abiertos.
- Filtros: contadores Todos/Abiertos/Cerrados (que filtran por estado), texto (sin tildes ni
  mayúsculas), tipos con su cuenta, entidad, etiqueta y «Solo causa raíz».
- Filas desplegables con el detalle: en los eventos, propiedades, management zones, todas las
  etiquetas y el mini gráfico; en métrica y transacción, la tarjeta «antes → después». Con el
  teclado: Enter despliega, Tab entra en el detalle y Escape lo pliega.
- Resumen de la causa raíz encima de la tabla: al pulsarlo, quita los filtros que la ocultan, la
  despliega y la enfoca.
- Filtros, orden y filas desplegadas se recuerdan por entorno y problema (los 20 últimos) hasta
  cerrar la app.

### Cambiado

- La exportación del detalle saca las evidencias que muestra la tabla, con sus filtros y en su
  orden, y la hoja Info lo dice. La hoja Evidencias gana Estado, Evento, Tipo de entidad, Duración
  (min), Etiquetas, En mantenimiento, Frecuente e ID del evento, y va también al CSV y al TXT.
- La lista de Problemas usa el nuevo grid genérico (sin cambios visibles).

### Quitado

- Los grupos por entidad y los chips de tipo de la 0.9.1, y «Más detalles» (las propiedades van
  en el detalle desplegado).

## [0.9.2] - 2026-10-04

Mini gráfico en las evidencias de evento que traen una métrica, a petición de Dani. Sin
migraciones nuevas.

### Añadido

- Las evidencias de evento con `dt.event.metric_selector` enseñan un mini gráfico de esa métrica:
  el periodo de la evidencia sombreado, el inicio del problema, el umbral si lo hay y, como mucho,
  10 series (la de la entidad, la primera y resaltada). Se cargan al verse en pantalla y de 3 en 3.
- Desde el gráfico: «Abrir en Métricas» con ese selector y ese rango, y exportación (CSV, XLSX,
  TXT) y captura.
- «Actualizar» en la página del problema: vuelve a pedir el detalle y, si sigue abierto, sus
  gráficos.

### Cambiado

- El log de main ya no copia un selector (ni otro valor largo de la consulta) cuando Dynatrace lo
  repite en un mensaje de error.

### Limitación conocida

- El mini gráfico no muestra la unidad: `/metrics/query` no la devuelve (solo el descriptor de la
  métrica) y no se inventa. El eje va con números en el formato del idioma.

## [0.9.1] - 2026-10-04

El detalle del problema se centra en las evidencias y los comentarios, a petición de Dani. Sin
migraciones nuevas.

### Añadido

- Evidencias agrupadas: la causa raíz arriba y el resto por entidad, en orden cronológico, con
  grupos plegables y filtros por tipo con su contador.
- Tarjeta de cambio en las evidencias de métrica y de transacción: «antes → después» con su unidad
  (ms o s, %, KB, MB…), la variación y una flecha.
- «Más detalles» en las evidencias de evento, con sus propiedades.
- «Abrir en Métricas» desde una evidencia de métrica, con el rango del problema.
- Comentarios con su contexto y «Ver todos» cuando la API tiene más que los recientes.
- Avisos cuando la API recorta las evidencias o los comentarios.

### Cambiado

- El detalle ya no pide ni muestra el análisis de impacto (`impactAnalysis`): se centra en
  evidencias y comentarios. La exportación pierde la hoja Impacto y la de Evidencias gana causa
  raíz, fin, antes, después, unidad, métrica y tipo de evento.

## [0.9.0] - 2026-10-04

Rediseño de Problemas, a petición de Dani: lista en un grid propio y detalle en su propia página.
Sin migraciones nuevas.

### Añadido

- Detalle de un problema en su propia página (`/problems/<id>`), con la ruta en la barra superior
  («… › Problemas › P-1234») y un mensaje propio si el problema no existe. Al volver, la lista
  conserva filtros, orden, la fila que se veía y el foco.
- Secciones nuevas en el detalle: clúster y namespace; evidencias de 50 en 50 con «Ver todas».
- Exportación del detalle por secciones: XLSX con Resumen, Entidades, Evidencias, Impacto y
  Comentarios; CSV y TXT con Resumen y Entidades.
- Orden de la lista por ID (natural: P-9 antes que P-10), título, afectados o inicio.

### Cambiado

- La lista de Problemas es un grid de 4 columnas (ID, Título, Afectados e Inicio) con una barra de
  estado roja o verde, y se maneja con el teclado (flechas, Inicio, Fin, RePág, AvPág y Enter). Las
  demás columnas siguen en la exportación.
- Dynatrace devuelve los problemas más recientes primero: si la lista se recorta, lo que falta es lo
  más antiguo.
- El detalle ya no enseña secciones vacías.

### Eliminado

- El panel lateral del detalle (sustituido por la página).

### Corregido

- Una evidencia, un impacto o un comentario que Dynatrace manda con una forma inesperada ya no
  tumba el detalle: se descarta, se cuenta y se avisa.

## [0.8.1] - 2026-10-04

Correcciones y mejoras pequeñas: el backlog P3 de la auditoría n.º 1 (AUD-21) y un ajuste de los
SLO de Inicio. Sin funciones nuevas grandes ni migraciones nuevas.

### Añadido

- Ajustes › Probar conexión: si falla el certificado del SSO, se ofrece su huella para fijarla,
  como la de la API. Un pin del SSO solo vale para el SSO, y el nivel «ignorar» nunca se le aplica.
- Inicio: «N problemas abiertos» de un SLO lleva un tooltip que explica que lo calcula Dynatrace
  con el filtro de problemas del SLO.
- `docs/propuestas-siguientes.md`: fichas de lo que puede venir después, para que decida Dani.

### Cambiado

- Los errores que vienen de main se muestran en el idioma de la interfaz (antes, siempre en
  español). El texto propio de Dynatrace se muestra tal cual.
- Plurales en el resumen de la importación («1 cliente», «2 entornos»).
- Los gráficos usan el idioma de la interfaz (meses y días del eje).
- Los entornos se ordenan como los clientes, con la colación española («ámbito» antes que «Zeta»).
- La tabla de Problemas solo repinta las filas que cambian al seleccionar o filtrar.

### Corregido

- Un 400 del SSO por un scope no válido ya no dice que el client ID o el secret son incorrectos.
- Aceptar una huella solo funciona con la que enseñó la última prueba de conexión para ese host, y
  esa oferta caduca si cambia la URL del entorno o la del SSO.
- Un SLO cuyos problemas relacionados Dynatrace no pudo calcular (-1) ya no muestra nada en la
  tarjeta, y en la exportación deja la celda vacía con una nota en la hoja Info.

### Pruebas

- Los e2e limpian sus carpetas temporales aunque falle el cierre de la app, con reintentos en
  Windows.
- `views.spec` ya no depende del orden de los tests.

## [0.8.0] - 2026-10-04

Arreglos de la auditoría n.º 1 (AUD-01 a AUD-20 y los P2 de AUD-21), Problemas y Métricas más
completos, y exploración de la API v2 en un tenant de pruebas (`docs/notas-api-v2.md`). Sin
migraciones nuevas.

### Añadido

- Problemas:
  - Columna y filtro de clúster de Kubernetes. El filtro es local, porque la API no permite
    filtrar por clúster, y el aviso lo dice ("Mostrando N (filtro de clúster) de L cargados de M").
  - Filtros de severidad e impacto, que sí filtran en Dynatrace.
  - Los filtros se guardan por entorno y no se pierden al cambiar de sección.
  - El detalle se abre en un panel lateral, también con el teclado, y muestra al instante los datos
    de la fila mientras llega el resto.
- Métricas:
  - Antes de consultar se estiman los puntos por serie y, si son muchos, se avisa y se ofrece una
    resolución más gruesa (la API no la rebaja: 1 min en 7 días son más de 10 000 puntos).
  - Se muestran la resolución aplicada, los recortes de la API y sus avisos.
  - El buscador está fuera del formulario (Enter elige la métrica y no lanza la consulta).
  - La leyenda lleva la métrica cuando hay varias.
- Inicio:
  - Los SLO en aviso tienen su propio color.
  - Un SLO sin evaluar se muestra "Sin evaluar", nunca "Correcto".
  - Se muestran los problemas abiertos relacionados con cada SLO.
  - El total real de problemas abiertos.
- Listas: "Mostrando N de M" con el total real de la API, y SLOs paginados.
- Exportación:
  - La hoja Info del XLSX añade: avisos de Dynatrace, elementos descartados, filtro de clúster y
    resolución.
  - El rango de la hoja Info es el de cuando se cargaron los datos.
  - El aviso de guardado lleva el nombre real del fichero.
- Pruebas en vivo de solo lectura (`npm run test:live`), con una guarda que rechaza cualquier
  escritura antes de llegar a la red, y `npm run scan:tenant` antes de cada push.
- e2e por niveles (`npm run test:e2e:affected`) y captura con log al fallar un e2e.

### Cambiado

- Una lista con un elemento inesperado ya no falla entera: el elemento se descarta, se cuenta y
  se avisa.
- Un 400 de Dynatrace se muestra como "La consulta no es válida" con el mensaje de la API.
- Un plazo vencido mientras se lee la respuesta da error de tiempo, en vez de dejar la vista
  cargando.
- Credenciales:
  - Enter en una credencial la guarda a ella.
  - Borrar una credencial pide confirmación.
  - Pasar un entorno a Managed borra las credenciales de plataforma solo tras confirmarlo, y en
    una sola operación.
  - Una credencial guardada en otro equipo se marca "Hay que volver a introducirla".
- Al editar un entorno o sus credenciales se borran de la caché sus datos.
- La paleta Ctrl+K se abre por encima de los diálogos.
- El botón de borrar cumple el contraste AA en el tema oscuro.
- La URL del entorno no admite parámetros (`?…`).
- La exportación neutraliza las fórmulas por el valor y no por el tipo de columna, y `NaN` sale
  como celda vacía.
- Paginación: cada endpoint declara qué parámetros repite en la página siguiente (solo
  `/problems` repite `fields`).
- `npm run check` incluye el formato y la cobertura con umbral.
- Instalación: `npm ci --ignore-scripts` y `npx install-electron` (ver README).

### Corregido

- La salud de servicios de Inicio ordenaba la gravedad alfabéticamente.
- El verificador de certificados podía no responder si el entorno se borraba con una petición en
  curso.

## [0.7.0] - 2026-10-04

Mejoras sobre la primera versión: Problemas completo, entornos más claros y pruebas en vivo.

### Añadido

- Problemas: tabla con impacto, severidad, entidades afectadas, causa raíz, namespace, inicio, fin
  y duración. Las celdas con varios valores muestran el primero y "+N" con el resto en un
  tooltip, lo que falta se muestra como N/A y los abiertos llevan "(en curso)". Fechas con
  formato fijo (es `dd/mm/aaaa HH:mm`, en `yyyy-mm-dd HH:mm`). Desde 200 filas, la tabla se
  virtualiza.
- Detalle del problema: tipo e id de cada entidad afectada, evidencias, análisis de impacto,
  comentarios recientes, management zones, entidades impactadas, etiquetas y problema
  vinculado, con su propio menú de exportación.
- Exportación de problemas con 16 columnas comunes a la tabla (valores múltiples unidos con
  " | ", fin vacío si está abierto, duración en minutos) y una fila "Nota" en la hoja Info del
  XLSX.
- "Probar conexión" describe el token: nombre, estado, caducidad y scopes concedidos, que faltan
  o sobran (token clásico y OAuth).
- Ruta "Cliente › Entorno" con el tipo de entorno, entornos agrupados por cliente en el selector
  y en `Ctrl+K`, tooltips del menú (también para las secciones no disponibles) y marca DEV fuera
  de la app empaquetada.
- Aviso al marcar "ignorar certificados" en el formulario y en la tarjeta de estado.
- `npm run test:live`: pruebas de solo lectura contra un tenant de pruebas, con las credenciales
  en `.env.live.local` (ignorado), y `npm run scan:tenant` para buscar restos del tenant antes de
  cada push.

### Cambiado

- El rojo del tipo de entorno producción pasa de `#d4472f` a `#b42318` en el tema claro, para
  cumplir el contraste AA.
- Severidad e impacto de los problemas se aceptan como texto: un valor nuevo de Dynatrace se
  muestra tal cual en lugar de dar error.
- La paginación pide las páginas siguientes solo con `nextPageKey` (y `fields` donde la API lo
  exige).
- Cada modo usa su carpeta de datos: el zip `%APPDATA%\vigia`, `npm run dev` `vigia-dev` y los e2e
  una carpeta temporal.

### Corregido

- El icono y el nombre de cada sección del menú vuelven a ir en la misma línea.

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
