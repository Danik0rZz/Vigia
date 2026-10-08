---
id: '0034'
titulo: 'APPLICATION: página con marcadores, gráficos, acciones de usuario e información'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion
depende_de: ['0033', '0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0034-aplicacion-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:applicationMetrics` de la 0033, `entities:get`/`entities:names` y los canales de problemas)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion» (0033 y 0034). La petición completa está en la ficha 0031.

## Especificación

En `WebApplicationEntityPage.tsx` se quita «Página en construcción». Mismos componentes que el
servicio y el orden de página de las fichas 0036 y 0037. Lo que no tenga métrica según la 0033 no
se pinta.

- **Marcadores:** Apdex (con su categoría: excelente ≥ 0,94, buena ≥ 0,85, aceptable ≥ 0,70, pobre
  ≥ 0,50, inaceptable; color y texto), Acciones (total), Duración (mediana o media), Errores
  (total; color de error si > 0) y Problemas.
- **Gráficos** (2×2, sin rejilla): Apdex (con la franja de problemas), Acciones (barras), Duración
  (línea) y Errores (barras).
- **Tabla «Acciones de usuario» (top 10 por volumen):** nombre, acciones, duración media (con
  barra); orden por columna.
- **Tarjeta «Información»** al final: las claves de `properties` que la 0033 vio en vivo (vistas
  antes en APPLICATION: `applicationType`, `applicationInjectionType`, `customizedName`,
  `detectedName`…), relaciones «Llama a» (servicios), «Monitores sintéticos» y «Otras», con «Ver
  nombres».
- Rango global, «Actualizar», errores por panel. Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de una aplicación del simulador enseña marcadores, gráficos y la tabla de
  acciones con sus valores; no enseña «Página en construcción».
- CA2 (unitario): categoría y color del Apdex en los cortes (0,94; 0,85; 0,70; 0,50), con texto.
- CA3 (e2e): con papeles `null`, sus marcadores y gráficos no salen y el resto sí.
- CA4 (e2e): la franja de problemas sale sobre el Apdex y abre el problema.
- CA5 (e2e): la tarjeta «Información» sale la última, con sus relaciones y enlaces.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con aplicaciones reales, que marcadores, gráficos y acciones cuadran con Dynatrace.

## Fuera de alcance

- Desglose por navegador, país o tipo de acción.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
