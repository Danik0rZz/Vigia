---
id: '0029'
titulo: 'PROCESS_GROUP_INSTANCE: tarjeta «Información» del proceso (sin línea de comandos)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: proceso
depende_de: ['0015', '0020', '0027', '0028']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0029-proceso-informacion
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:get` y `entities:names` de la 0014; scope `entities.read`)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «proceso» (0027 a 0029). "Consultar la entidad y sacar la información relevante", como en
SERVICE. La petición completa está en la ficha 0022.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar los lotes «monitores» y «proceso»:** los datos del
monitor (de la sonda) salen de `GET /entities/{entityId}`, como en el servicio, no de la API v1;
colores de disponibilidad: error por debajo del 95 % y aviso por debajo del 99 %, siempre con
texto. Las colas trabajan solas de noche y lo que haya que refinar se refina después.

La tarjeta «Información» (0015, generalizada en la 0020) para PROCESS_GROUP_INSTANCE, breve y con el
detalle plegado:

- **Filas** (claves vistas en vivo en la 0027; en `PROCESS_GROUP` se vieron `detectedName`,
  `listenPorts`, `metadata` y `softwareTechnologies`): tecnologías como chips, puertos de escucha,
  nombre detectado, ejecutable (solo el nombre del fichero, si viene en `metadata`), visto por
  primera y última vez, management zones y etiquetas.
- **Seguridad:** la línea de comandos, los argumentos y las variables de entorno que puedan venir en
  `properties` (por ejemplo, dentro de `metadata`) **no se enseñan en ningún sitio**, tampoco en
  «Todas las propiedades»: pueden llevar contraseñas o tokens. Se filtran en main antes de mandar
  la entidad a la interfaz, con una lista de claves y de formas (las que encuentre la 0027) y un
  test. La ruta completa del ejecutable tampoco (puede llevar el nombre del usuario).
- **Relaciones:** «Se ejecuta en» (el host), «Process group» (`isInstanceOf`), «Servicios» (los
  que corren en él) y «Otras relaciones» plegada; «Ver nombres» a demanda y enlaces, como en la 0015.
- «Todas las propiedades», plegada (sin lo filtrado). Sin `entities.read`, aviso del scope.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario, main): una entidad inventada con línea de comandos, argumentos, variables de
  entorno y ruta completa en sus propiedades sale de `entities:get` sin ninguno de esos valores (ni
  en las filas ni en todas las propiedades).
- CA2 (unitario): la función que elige filas y grupos para PROCESS_GROUP_INSTANCE.
- CA3 (e2e): la página de un proceso del simulador enseña su tarjeta, relaciones con «Ver nombres»
  y enlaces (al host y a los servicios), y no enseña el valor de la línea de comandos del
  simulador en ningún sitio de la página.
- CA4 (e2e): sin `entities.read`, aviso del scope y los marcadores y gráficos siguen.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con procesos reales, que la tarjeta se lee de un vistazo y que no aparece ninguna línea de
  comandos ni ruta con nombres de usuario.

## Fuera de alcance

- Página de PROCESS_GROUP (el grupo), que sigue en construcción.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
