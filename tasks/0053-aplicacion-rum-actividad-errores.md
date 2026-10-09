---
id: '0053'
titulo: 'APPLICATION (RUM): marcadores nuevos y secciones «Actividad» y «Errores»'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion-rum
depende_de: ['0052']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0053-aplicacion-rum-actividad-errores
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:applicationRum` de la 0052 y lo que ya usa la página)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion-rum» (0052 a 0054). "Actividad de acciones (loads y XHR), errores HTTP y
JavaScript, sesiones de usuario, usuarios activos…". La petición completa está en la ficha 0052.

## Especificación

**Fuente de los datos (Dani, 2026-10-10):** Dynatrace tiene dos fuentes para RUM y Core Web Vitals:
Grail (DQL, plataforma) y la API clásica con métricas. Vigía y sus pruebas en vivo están limitadas a
la **API clásica**, así que solo se pintan **métricas de RUM** (`builtin:apps.web.*` por
`GET /api/v2/metrics/query`). Nada de Grail ni DQL en este lote.

La página de la aplicación (`WebApplicationEntityPage.tsx`) pasa a organizarse por secciones con
título, en este orden (etiquetas arriba e «Información» al final, como todas):

**Marcadores** (seis, centrados; en la ventana estrecha, en dos filas):

| Marcador         | Principal                     | Debajo                                   |
| ---------------- | ----------------------------- | ---------------------------------------- |
| Apdex            | como hoy, con su categoría    | —                                        |
| Usuarios activos | estimación del rango          | «estimado» (tooltip que lo explica)      |
| Sesiones         | iniciadas                     | duración media · rebote %                |
| Acciones         | total                         | load · XHR (· custom si hay)             |
| Errores          | total (color de error si > 0) | JavaScript · HTTP (si se pueden separar) |
| Problemas        | abiertos                      | cerrados                                 |

**Sección «Actividad»** (2 gráficos lado a lado):

- **Acciones por tipo:** barras apiladas load, XHR y custom (colores del tema, leyenda).
- **Duración por tipo:** líneas de load y XHR (y custom si hay), en ms o s, con la franja de
  problemas encima.

**Sección «Errores»** (2 gráficos):

- **Errores por tipo:** barras apiladas JavaScript, HTTP y otros (o un solo color si no se pueden
  separar, con una nota).
- **Acciones afectadas por errores:** línea en %.

El gráfico de Apdex se queda; la tabla de acciones clave también (en su sección «Acciones clave»).
Sin líneas de rejilla, tooltip, «Abrir en Métricas», exportar y errores por panel, como el resto.
Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de una aplicación del simulador enseña los seis marcadores con sus valores
  formateados (separador de miles) y sus líneas de debajo.
- CA2 (e2e): la sección «Actividad» enseña los dos gráficos con sus series (`data-series`): load,
  XHR, custom; y la sección «Errores», los suyos.
- CA3 (e2e): con los errores HTTP sin separar (`null` en el simulador), el gráfico de errores lleva
  una sola serie y la nota, y el marcador no enseña la línea JavaScript · HTTP.
- CA4 (e2e): con un papel `null`, su marcador o gráfico no sale y el resto sí.
- CA5 (e2e): rango global, «Actualizar» y errores por panel como en las demás páginas.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con aplicaciones reales, que actividad y errores cuadran con Dynatrace en el mismo rango.

## Fuera de alcance

- Grail y DQL (RUM y Web Vitals de la plataforma): solo API clásica, decisión de Dani.
- Usuarios, sesiones y experiencia en gráficos (0054).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
