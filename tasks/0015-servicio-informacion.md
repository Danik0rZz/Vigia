---
id: '0015'
titulo: 'SERVICE: sección «Información» con propiedades, zonas, etiquetas y relaciones (nombres a demanda)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
