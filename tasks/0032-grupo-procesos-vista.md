---
id: '0032'
titulo: 'PROCESS_GROUP: página con marcadores, gráficos, instancias e información'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos
depende_de: ['0031', '0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0032-grupo-procesos-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:processGroupMetrics` de la 0031, `entities:get`/`entities:names` de la 0014 y los canales de problemas de las fichas 0007 y 0010)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «grupo-procesos» (0031 y 0032). "Haz lo mismo para process_group". La petición completa está
en la ficha 0031.

## Especificación

En `ProcessGroupEntityPage.tsx` se quita «Página en construcción». Mismos componentes que el
proceso (0028) y el orden de página que dejan las fichas 0036 y 0037 (etiquetas arriba, información
abajo):

- **Marcadores:** Instancias (cuántas), CPU (media del grupo; debajo, máxima), Memoria (media),
  Red (entrada; debajo, salida) y Problemas. Umbrales de CPU como en el host (80/90 %, con texto).
- **Gráficos** (2×2, sin rejilla): CPU (con la franja de problemas), Memoria, Red y CPU por
  instancia (una línea por instancia, como mucho 5, las de más CPU).
- **Tabla «Instancias»:** nombre, host, CPU media (con barra) y memoria; ordenada por CPU; cada
  instancia enlaza a su página de proceso y su host a la del host.
- **Tarjeta «Información»** (al final, como todas tras la 0036): claves vistas en vivo en
  PROCESS_GROUP (`detectedName`, `listenPorts`, `softwareTechnologies` y `metadata`), con el mismo
  filtro de seguridad que la 0029 (nada de línea de comandos, argumentos, variables de entorno ni
  rutas completas); relaciones «Instancias», «Hosts», «Servicios» y «Otras», con «Ver nombres».
- Rango global, «Actualizar», errores por panel. Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de un process group del simulador enseña sus marcadores, los cuatro gráficos
  y la tabla de instancias con sus valores; no enseña «Página en construcción».
- CA2 (e2e): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su
  host abre la del host.
- CA3 (e2e): la franja de problemas sale sobre la CPU y abre el problema.
- CA4 (unitario, main): una entidad PROCESS_GROUP inventada con línea de comandos y rutas en
  `metadata` sale de `entities:get` sin esos valores.
- CA5 (e2e): la tarjeta «Información» sale la última y sin el valor de línea de comandos del
  simulador en ningún sitio de la página.
- CA6 (e2e): rango global, «Actualizar» y errores por panel como en el proceso.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con process groups reales, que marcadores, gráficos e instancias cuadran con Dynatrace.

## Fuera de alcance

- Métricas de tecnología.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
