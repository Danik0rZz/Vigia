---
id: '0054'
titulo: 'APPLICATION (RUM): secciones «Usuarios y sesiones» y «Experiencia» (Core Web Vitals)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion-rum
depende_de: ['0052', '0053']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0054-aplicacion-rum-usuarios-experiencia
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:applicationRum` de la 0052)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion-rum» (0052 a 0054). "Sesiones de usuario, usuarios activos, etc." Y sobre Core Web Vitals: "Sí, core vitals también" (2026-10-10). La petición
completa está en la ficha 0052.

## Especificación

**Fuente de los datos (Dani, 2026-10-10):** Dynatrace tiene dos fuentes para RUM y Core Web Vitals:
Grail (DQL, plataforma) y la API clásica con métricas. Vigía y sus pruebas en vivo están limitadas a
la **API clásica**, así que solo se pintan **métricas de RUM** (`builtin:apps.web.*` por
`GET /api/v2/metrics/query`). Nada de Grail ni DQL en este lote.

Dos secciones nuevas en la página de la aplicación, después de «Errores» y antes de «Acciones
clave»:

**Usuarios y sesiones** (2 gráficos):

- **Usuarios activos:** línea (estimación, con la nota).
- **Sesiones:** iniciadas y terminadas (barras) y, en un segundo eje, la duración media de sesión
  (línea). Debajo del gráfico, tres datos pequeños del rango: acciones por sesión, tasa de rebote y
  clics de frustración (rage clicks) si hay datos.

**Experiencia** (Core Web Vitals, tres tarjetas y un gráfico):

- Tarjetas **LCP**, **CLS** e **INP** con el valor del rango y su calificación con los umbrales
  públicos de Google (LCP: bueno ≤ 2,5 s, mejorable ≤ 4 s; CLS: ≤ 0,1 y ≤ 0,25; INP: ≤ 200 ms y ≤
  500 ms): «Bueno», «Mejorable» o «Pobre», con color y texto. Un tooltip explica cada métrica en
  una frase.
- Gráfico con las tres a lo largo del rango (LCP e INP en tiempo; CLS en su propio eje), con líneas
  discontinuas en el umbral de «bueno».

Lo que no tenga datos según la 0052 no se pinta. Sin líneas de rejilla, tooltip, «Abrir en
Métricas», exportar y errores por panel, como el resto. Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de una aplicación del simulador enseña la sección «Usuarios y sesiones» con
  sus dos gráficos (`data-series`) y los tres datos pequeños.
- CA2 (unitario): calificación de LCP, CLS e INP en los cortes (2,5 s y 4 s; 0,1 y 0,25; 200 ms y 500
  ms), con texto además del color.
- CA3 (e2e): la sección «Experiencia» enseña las tres tarjetas con su calificación y el gráfico con
  sus tres series y las líneas de umbral.
- CA4 (e2e): con experiencia `null` en el simulador, la sección no sale; con rage clicks `null`, su
  dato no sale.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con aplicaciones reales, que usuarios, sesiones y Web Vitals cuadran con Dynatrace.

## Fuera de alcance

- Grail y DQL (RUM y Web Vitals de la plataforma): solo API clásica, decisión de Dani.
- Desglose de Web Vitals por página, navegador o país.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
