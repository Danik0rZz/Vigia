---
id: '0051'
titulo: 'PROCESS_GROUP: tabla con las 20 de más CPU, aviso y modal «Ver todas» con transición de entrada'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos-2
depende_de: ['0050']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0051-grupo-procesos-modal-instancias
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:processGroupMetrics` y `entities:processGroupInstances` de la 0050)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «grupo-procesos-2» (0050 y 0051). La petición completa está en la ficha 0050: tabla con las 20
instancias que más CPU consumen, aviso de que hay más, botón «Ver todas» y un modal centrado con una
transición de entrada vistosa y la lista completa, que avisa si está recortada.

## Especificación

En la tabla «Instancias» de la página del process group (0032):

- Enseña las **20 de más CPU** (las de `instances.items`).
- Si `total` es mayor que 20, debajo: «20 de 1.234 instancias, las de más CPU» y el botón **«Ver
  todas»**. Si `totalKnown` es `false`: «20 instancias, las de más CPU; puede haber más» y el botón.
- **Modal** (el `Dialog` de Radix de `components/dialogs.tsx`, accesible: foco atrapado, Escape y
  clic fuera cierran, título «Instancias de <grupo>»):
  - Centrado, ancho amplio y alto máximo de la ventana con scroll interno; la tabla con las mismas
    columnas y enlaces que la de la página (a la página de cada proceso y de su host), orden por
    columna y un buscador por nombre o host.
  - **Transición de entrada vistosa:** el fondo se oscurece con desenfoque suave y el panel entra
    con escala (de 0,92 a 1), un leve desplazamiento hacia arriba y opacidad, con una curva con algo
    de rebote (unos 300 ms); al cerrar, la inversa más rápida. Con «reducir el movimiento» de
    Windows, solo un fundido corto.
  - Los datos se piden **al abrir** (`entities:processGroupInstances`, ADR-0004: lo pide el usuario)
    y se quedan en caché con la misma clave; mientras cargan, un esqueleto de filas; si falla, aviso
    con Reintentar dentro del modal.
  - Si `truncated`: aviso destacado arriba del modal («Dynatrace devuelve como mucho unas 498
    instancias por consulta: se muestran N de M»), con el número real si se conoce.
- Pulsar un proceso o un host en el modal cierra el modal y navega; «Volver» regresa al grupo.
- Textos en es y en.
- Del revisor de la 0050: `instancesTruncated` (`process-group-instances.ts`) solo mira `partial`; con `totalKnown: true` el marcador diría «al menos N» aunque el total sea exacto, hay que usar `total` y `totalKnown`. Y `truncated` de `processGroupInstances` también es `true` si `totalCount` cuenta instancias sin series: el aviso del modal no debe afirmar un recorte de Dynatrace sin más.

## Criterios de aceptación

- CA1 (e2e): con un grupo de 30 instancias en el simulador, la tabla enseña 20, ordenadas por CPU, y
  el aviso «20 de 30» con «Ver todas»; con 12 instancias, ni aviso ni botón.
- CA2 (e2e): «Ver todas» abre el modal con las 30, pide `entities:processGroupInstances` una sola
  vez (abrir y cerrar otra vez no vuelve a pedir) y la página no lo pide antes de pulsar.
- CA3 (e2e): con un grupo recortado, el modal enseña el aviso de recorte con los números.
- CA4 (e2e): en el modal, el buscador filtra, el orden por columna funciona, Escape cierra y el foco
  vuelve al botón «Ver todas»; pulsar un proceso abre su página.
- CA5 (e2e): el panel del modal tiene la animación de entrada (clase o atributo de estado de Radix
  con la transición) y, con `prefers-reduced-motion: reduce` emulado, solo el fundido.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un process group real grande: el aviso, el modal, la transición (que se ve vistosa) y el aviso
  de recorte si lo hay.

## Fuera de alcance

- Gráficos dentro del modal o seleccionar instancias para compararlas.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
