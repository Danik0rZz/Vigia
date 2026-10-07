---
id: '0015'
titulo: 'SERVICE: sección «Información» con propiedades, zonas, etiquetas y relaciones (nombres a demanda)'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-2
depende_de: ['0014']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0015-servicio-informacion
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:get` y `entities:names` de la 0014)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio-2» (0011 a 0015). Dani pide, con los datos de `GET /entities/<id>`, una vista "clara,
bonita y bien nutrida, sin pasarse: la app es para ver las cosas de forma amigable y ágil", y poder
consultar a demanda las entidades relacionadas. La petición completa está en la ficha 0014.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «servicio-2»:** separador de miles siempre que
el número tenga 4 cifras o más, con punto en español («9.907», no «9907»; Dani: "más elegante y
cuidado"); la información de la entidad, breve, bonita y ágil, pero con el detalle a mano.

Lo que se enseña lo propone el Planificador (Dani le pidió elegirlo) a partir de la exploración en
vivo de la 0014. Criterio: lo que un usuario mira para situar un servicio de un vistazo; lo interno
de Dynatrace, plegado.

**Principio (Dani):** breve y bonita para ser ágil, con el detalle a un clic. Lo de arriba se lee en
unos segundos; lo largo (todas las propiedades, otras relaciones, listas de más de unas pocas
entidades) va plegado.

**Dónde:** en la página del servicio, entre la cabecera y los marcadores, una tarjeta
**«Información»** en dos columnas (una con la ventana estrecha):

- **Columna «Servicio»**, como lista de dato y valor, solo con lo que venga:
  - Tipo (`serviceType`) y tecnologías (`serviceTechnologyTypes` y `softwareTechnologies`, como
    chips).
  - Dónde escucha: `webServerName`, `webServiceName`/`webServiceNamespace`, `contextRoot` y
    `port`.
  - Servicio externo o de base de datos: «Externo» (`isExternalService`), `remoteEndpoint`,
    `databaseVendor` y `databaseName`.
  - Aplicación: `applicationName`, `applicationEnvironment` y `applicationReleaseVersion`.
  - Nube: `publicCloudId` y `publicCloudRegion`.
  - Visto por primera y última vez (fecha y hora local).
  - Management zones y etiquetas, como chips (las etiquetas, 6 y «+N» que despliega el resto).
- **Columna «Relaciones»**, agrupadas con nombres claros (es y en), en este orden y solo las que
  vengan:
  - «Se ejecuta en»: hosts (`runsOnHost`), procesos (`runsOnProcessGroupInstance`) y process group
    (`isServiceOfProcessGroup`).
  - «Llama a» (`calls` de `fromRelationships`) y «Lo llaman» (`calls` de `toRelationships`).
  - «Otras relaciones», plegada: el resto, con el nombre de la relación tal cual.
  - Cada grupo enseña cuántas hay y, al desplegarlo, la lista con el tipo (nombre de la ficha 0003)
    y el id. Si había más de 50, «Mostrando 50 de N».
  - **Nombres a demanda:** cada grupo desplegado tiene «Ver nombres», que llama a
    `entities:names` (una llamada por tipo dentro del grupo). Hasta pulsarlo no se pide nada. Los
    que no se resuelven se quedan con su id y «sin nombre».
  - Cada entidad de la lista es un enlace a su página de entidad (`#/entities/<tipo>/<id>`, con el
    nombre si ya se conoce); «Volver» regresa al servicio.
- **«Todas las propiedades»**, plegada al final de la tarjeta: todas las `properties` como dato y
  valor (texto), también las internas que no salen arriba.
- `iconType` no se pinta como icono (son iconos de Dynatrace, remotos); no se usa.

**Estados:** esqueleto mientras carga; aviso compacto con Reintentar si falla; sin el scope
`entities.read`, el aviso de "falta el scope" de `useModuleAccess` con el scope que falta. En
todos los casos, marcadores y gráficos siguen. Sin refresco solo (ADR-0004); «Actualizar» de la
página también la recarga. Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): con un servicio del simulador con todas las propiedades, la tarjeta enseña los datos
  de la columna «Servicio» en su orden, con las tecnologías y zonas como chips, y no enseña las
  claves internas fuera de «Todas las propiedades».
- CA2 (e2e): con un servicio con pocas propiedades, solo salen las filas que tienen dato (sin filas
  vacías ni «undefined»).
- CA3 (e2e): las relaciones salen en sus grupos y en su orden, con su número; al desplegar un grupo,
  tipo e id de cada una; con más de 50, «Mostrando 50 de N».
- CA4 (e2e): al abrir la página no se llama a `entities:names`; «Ver nombres» lo llama una vez por
  tipo del grupo y enseña los nombres, y los no resueltos quedan con «sin nombre».
- CA5 (e2e): pulsar una entidad relacionada abre su página de entidad (la del tipo) y «Volver»
  regresa al servicio sin volver a pedir sus datos.
- CA6 (e2e): sin el scope `entities.read`, la tarjeta enseña el aviso con el scope que falta, y los
  marcadores y gráficos siguen; con el canal caído, aviso con Reintentar.
- CA7 (e2e): con la ventana estrecha, una columna; con la normal, dos.
- CA8 (unitario): la función que elige y ordena las filas de «Servicio» y los grupos de relaciones a
  partir de la salida de `entities:get`.
- CA9 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con servicios reales: que la tarjeta se lee de un vistazo, que no sobra ni falta nada importante y
  que «Ver nombres» y los enlaces a las entidades relacionadas funcionan.

## Fuera de alcance

- Esta tarjeta en las páginas de otros tipos (cada una, su ficha, cuando Dani diga qué enseñar).
- Iconos de Dynatrace (`primaryIconType`).
- Editar etiquetas o zonas.

## Ideas surgidas (fuera de alcance)

- (developer) `useModuleAccess` da un módulo por disponible mientras `connection:status` no ha
  respondido. En la tarjeta se resuelve con `useConnectionStatusKnown`, pero los marcadores y los
  gráficos (métricas y problemas) tienen la misma carrera con un token sin su scope. Valdría una
  ficha que lo resuelva en el propio hook para todos los módulos.

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `172c2f7` (`test(servicio): criterios de la ficha 0015`). Ahora fallan porque
el código no existe (no hay tarjeta `service-info`, ni `service-info.ts`, ni textos
`entities.service.info`), no por el test.

| Criterio | Test                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| CA1      | `e2e/views.spec.ts` › `CA1 (0015): con un servicio con todas las propiedades, la columna «Servicio» enseña sus datos en su orden…`         |
| CA2      | `e2e/views.spec.ts` › `CA2 (0015): con un servicio con pocas propiedades solo salen las filas con dato…`                                   |
| CA3      | `e2e/views.spec.ts` › `CA3 (0015): las relaciones salen en sus grupos y en su orden, con su número…`                                       |
| CA4      | `e2e/views.spec.ts` › `CA4 (0015): al abrir la página no se pide ningún nombre; «Ver nombres» llama a entities:names una vez por tipo…`    |
| CA5      | `e2e/views.spec.ts` › `CA5 (0015): pulsar una entidad relacionada abre su página… y «Volver» regresa al servicio sin volver a pedir…`      |
| CA6      | `e2e/views.spec.ts` › `CA6 (0015): sin entities.read, la tarjeta dice qué scope falta y marcadores y gráficos siguen; con el canal caído…` |
| CA7      | `e2e/views.spec.ts` › `CA7 (0015): con la ventana estrecha, «Servicio» y «Relaciones» en una columna; con la normal, en dos`               |
| CA8      | `src/renderer/src/pages/entities/service-info.test.ts` › `CA8 (0015): filas de «Servicio» y grupos de relaciones a partir de entities:get` |
| CA9      | `src/renderer/src/locales/service-info.test.ts` › `CA9 (0015): textos de la tarjeta «Información» en es y en`                              |

Además, `src/renderer/src/data/modules.test.ts` › `useModuleAccess('entities')` (lo pidió el
revisor de la 0014); ese ya pasa, porque el hook es de la 0014.

**Decisiones del test-writer (delegadas por Dani, refinables):**

- Función de CA8: `buildServiceInfo(data: EntityData): { rows, groups }` en
  `src/renderer/src/pages/entities/service-info.ts`. Fila: `{ key, kind: 'text', text }`,
  `{ key, kind: 'chips', chips }` o `{ key, kind: 'date', time }` (epoch ms). Grupo:
  `{ key, total, entities: { id, type, relation, direction }[] }`.
- Claves de fila, en este orden: `serviceType`, `technologies`, `webServerName`, `webService`
  (nombre y namespace en una sola fila), `contextRoot`, `port`, `isExternalService`,
  `remoteEndpoint`, `databaseVendor`, `databaseName`, `applicationName`,
  `applicationEnvironment`, `applicationReleaseVersion`, `publicCloudId`, `publicCloudRegion`,
  `firstSeen`, `lastSeen`, `managementZones`, `tags`. Solo con dato: texto vacío o en blanco no
  cuenta; `isExternalService` solo sale con `"true"` (la fila dice «Externo»), con `"false"` no.
- Tecnologías: el texto de `serviceTechnologyTypes` y luego el de `softwareTechnologies`
  (formato de main en la 0014), partidos por «, », un chip por trozo.
- Grupos (`key`): `runsOn` («Se ejecuta en»: hosts, procesos y process group, en ese orden),
  `calls` («Llama a», `calls` de from), `calledBy` («Lo llaman», `calls` de to) y `other` (el
  resto, de las dos direcciones, con el nombre tal cual, también `runsOn` e `isServiceOf`). Solo
  los que tengan alguna; `total` suma los `total` de sus relaciones.
- El puerto del simulador es de 3 cifras (443): no se fija si un puerto de 4 lleva separador.
- Textos en `entities.service.info` (common): `title`, `service`, `relations`, `allProperties`,
  `showNames`, `noName`, `groups.<key>` con los textos de la ficha y `rows.<key>` por fila. El
  «Mostrando 50 de N» puede reutilizar `module.truncatedOf`.
- Testids: tarjeta `service-info`; columnas `service-info-service` y `service-info-relations`;
  fila `service-info-row` con `data-key`, su valor `service-info-value` y chips
  `service-info-chip`; «+N» de etiquetas `service-info-tags-more`; grupo `service-info-group`
  con `data-group`, `service-info-group-count`, `service-info-group-toggle` (con
  `aria-expanded`), `service-info-group-truncated` y «Ver nombres» `service-info-names`;
  entidad `service-info-entity` (enlace con `href` `#/entities/<tipo>/<id>` y `data-entity-id`)
  con su nombre en `service-info-entity-name`; «Todas las propiedades»:
  `service-info-properties-toggle` y `service-info-property` con `data-key`. Sin scope, el
  `module-unavailable` de siempre dentro de la tarjeta; con error, `role="alert"` y «Reintentar».
- Sin el scope no se pide `entities:get`. «Otras relaciones» empieza plegada; los demás grupos se
  despliegan si no lo están (no se fija si empiezan abiertos). «Todas las propiedades» empieza
  plegada.
- Simulador (`e2e/views.spec.ts`): servicios `INFO_FULL_ID` (todo, 55 en «Llama a», tipos
  mezclados en «Lo llaman», un id sin nombre) e `INFO_FEW_ID`; `SVC_ID` (el de los marcadores)
  devuelve las pocas propiedades, para que su página tenga tarjeta; `sim.entityInfoFail` (400) y
  el token `TOKEN_NO_ENTITIES` (sin `entities.read`), con su entorno creado y borrado dentro de
  CA6.

**Decisiones del Orquestador (delegadas por Dani), aplicadas por el developer:**

- Las propiedades llegan de main como texto y se pintan tal cual, sin `formatNumber`: el puerto,
  las versiones y los ids son identificadores, no cantidades (sin separador de miles). Los recuentos
  (número de cada grupo, «+N» de etiquetas y número de propiedades) sí van con `formatNumber`.
- Todos los grupos de relaciones empiezan plegados, con su número visible; «Otras relaciones» y
  «Todas las propiedades», también.
- Los valores del tenant se pintan como texto de React (nunca HTML).

**Decisiones del developer (refinables):**

- `isExternalService` es una fila de tipo `flag` (cuarto `kind` de `ServiceRow`): la etiqueta dice
  «Externo» y el valor, «Sí». `webService` junta nombre y namespace como «nombre (namespace)».
- Sin el scope, el aviso va dentro de la tarjeta; sin entorno o sin token clásico, la tarjeta no
  sale (la página ya da ese aviso y se repetiría).
- `entities:get` espera a que `connection:status` responda (`useConnectionStatusKnown`, en
  `data/tenants.ts`): antes de eso, `useModuleAccess` no sabe si falta `entities.read` y se pedía
  una vez sin el scope (lo cazó CA6). Ver «Ideas surgidas».
- Nombres: lotes por tipo con los ids de formato estándar, sin repetir y de 50 en 50; los de otro
  formato no se piden y quedan «sin nombre». Su clave de caché no cuelga del módulo `entities`: así,
  «Actualizar» recarga la tarjeta, pero no vuelve a pedir los nombres. Si fallan, aviso con
  `errorDetail` y Reintentar dentro del grupo.
- Los enlaces a las relacionadas viajan con `fromProblem` (y con el nombre, si se conoce), el
  estado que ya usa `EntityPageFrame` para que «Volver» haga `back()`.
- Dos columnas desde 990 px de ancho de ventana (`min-[990px]:`): entre la estrecha (960) y la del
  CI (1024), con margen para el redondeo de Windows.

## Resultado

(pendiente)
