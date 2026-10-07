---
id: '0005'
titulo: e2e de views.spec.ts que dependen de la máquina, sustituidos por tests estables
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0005-e2e-estables
adrs: [6, 7]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

"Vamos a solucionar los test que fallan por unos nuevos."

Se refiere a la mejora anotada en el BACKLOG «e2e de `views.spec.ts` que dependen de la máquina»
(primer candidato a ficha): fallan en el CI (`windows-latest`) y en la VPS sin cambios de código, y
mientras sigan así el CI sale en rojo.

## Especificación

**Objetivo:** que el e2e completo pase igual en la VPS y en el CI, sustituyendo los cinco tests por
versiones nuevas que comprueben **lo mismo** de forma estable. No se borra cobertura: cada
comprobación del test viejo está en el nuevo o se dice en "Resultado" por qué ya no aplica.

**Regla para todos (decisión del Planificador, que Dani aprueba con la ficha):** primero se busca la
causa y se reproduce. Si la causa está en el test (esperas, tiempos, geometría de la ventana), se
arregla el test. **Si la causa es un fallo real de la app, se arregla la app** y el test nuevo se
queda tan estricto como el viejo. Nunca se sube un tiempo de espera, se añade tolerancia o se quita
una comprobación solo para que pase. La causa de cada uno queda en "Resultado".

Los cinco (líneas de `e2e/views.spec.ts` en `main` tras la ficha 0004; si se han movido, se buscan
por nombre):

1. **«v0.9.0: volver del detalle conserva los filtros y la fila visible, con 300 filas
   virtualizadas»** (`:1724`). Espera la fila 150 al volver y ve la 146 (CI) o la 140 (VPS). Hay
   que saber si la lista restaura mal la fila de arriba con otra geometría (fallo de la app: Dani pidió
   «la fila que se veía», `docs/pendiente-dani.md`, v0.9.0) o si es el test el que mide antes de que
   termine de restaurar o con una ventana distinta.
2. **`Problemas: tabla, línea de tiempo y página de detalle con las entidades afectadas`**
   (`:1532`). La cabecera arrastrable (`app-drag` de `TopBar.tsx`) intercepta el clic en
   `breadcrumb-section`, aunque el enlace ya lleva `app-no-drag`. Si con la ventana del CI la ruta
   queda tapada (por ejemplo, por los botones nativos de la barra de título), un usuario con una
   ventana así tampoco puede pulsarla: fallo de la app.
3. **`i18n: cambiar de idioma con el gráfico de Métricas abierto lo rehace con el locale nuevo`**
   (`:3981`). La serie llega vacía, también aislado e intermitente. Deducción sin comprobar (verifier
   de la 0001): lee `data-series` sin `expect.poll` justo después de `runMetric`.
4. **`Inicio: estado de cada SLO (con texto y color), sin evaluar y problemas relacionados`**
   (`:4086`). Se agota una espera de 5 s; hay que saber en qué paso (probablemente el tooltip con
   `hoverFresh`).
5. **`exporta problemas a XLSX con su hoja Info, y a TXT alineado y con tabuladores`** (`:3620`).
   Intermitente, lee el fichero vacío. Causa probable: `exportTo` da el fichero por listo en cuanto
   aparece su nombre y main lo escribe con `writeFile` directo. Arreglo en el test: esperar a que el
   fichero tenga contenido y no cambie de tamaño. La app no cambia: avisa de «exportado» cuando
   `writeFile` ya ha terminado.

**Ventana de tamaño fijo en los e2e de `views`.** Si la geometría es parte de la causa (1 y 2), los
tests fijan el tamaño del contenido de la ventana al empezar (desde Playwright, por ejemplo con
`BrowserWindow.setContentSize` en `electronApp.evaluate`), no la app. Lo que dependa de la ventana
se prueba con ese tamaño fijo, y si el arreglo de la app es para ventanas pequeñas, con una pequeña
también.

**De paso, en el CI** (`.github/workflows/ci.yml`): `actions/checkout` y `actions/setup-node` a la
versión mayor que ya corre con Node 24 (quita el aviso de deprecación de Node 20). La versión se
comprueba en las notas de versión oficiales de cada acción; no se supone.

**Si los tests destapan un fallo de la app** (en estos cinco o en lo que se toque para
arreglarlos), se arregla en esta ficha y **se le informa a Dani**: en "Resultado" queda qué fallaba,
cómo se veía y qué se ha cambiado; cada arreglo añade su prueba a mano concreta en "Pruebas a mano
para Dani" (pasos para verlo), y el Orquestador lo destaca en su resumen y en el aviso de Telegram
(«Arreglado en la app, pruébalo: …»). Decisión de Dani (2026-10-07).

**Al terminar:** se quita la mejora anotada del BACKLOG. Si aparece otro e2e inestable al repetir,
se anota como mejora nueva (no entra en esta ficha salvo que sea de los mismos cinco).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
"Estable" quiere decir que pasa con
`npx playwright test e2e/views.spec.ts -g "<nombre>" --repeat-each 5 --workers=1` en la VPS (el
verifier lo ejecuta y lo copia en "Verificación"). Son 5 repeticiones, más que las 3 de
`e2e/CLAUDE.md`, por decisión de Dani (2026-10-07): uno de los fallos salía 1 de cada 3 veces y con
5 la probabilidad de no verlo baja al 13 %.

- CA1 (e2e, sustituye a `:1724`): con 300 filas, filtro y scroll a mitad, al volver del detalle con
  el botón y con la flecha atrás del historial se conservan el filtro, la primera fila visible
  (mismo índice, sin tolerancia) y la fila abierta marcada; además, la fila abierta queda dentro de
  la vista. Estable.
- CA2 (e2e, sustituye a `:1532`): la página de detalle con las entidades afectadas, «Volver a
  Problemas» y el enlace «Problemas» de la barra superior, pulsado con un clic normal (sin `force`
  ni `dispatchEvent`). Estable. Si el arreglo es de la app, otro e2e comprueba que con una ventana
  pequeña el enlace sigue recibiendo el clic.
- CA3 (e2e, sustituye a `:3981`): la serie del gráfico es la misma antes y después de cambiar a
  inglés y de volver a español, y el locale cambia, leyendo `data-series` con espera (nunca una
  lectura suelta tras `runMetric`). Estable.
- CA4 (e2e, sustituye a `:4086`): los cuatro estados de SLO con su texto y su color, «Sin
  evaluar», los problemas relacionados con su plural y el tooltip con el ratón y con el foco.
  Estable.
- CA5 (e2e, sustituye a `:3620`): XLSX con Datos e Info, TXT alineado y TXT con tabuladores, cada
  fichero leído cuando ya tiene contenido. Estable.
- CA6 (unitario): un test lee `.github/workflows/ci.yml` y comprueba que `actions/checkout` y
  `actions/setup-node` van en la versión mayor elegida (la que se anota en "Resultado").
- CA7 (verifier): `npm run check` y el e2e completo (`npm run test:e2e`) pasan en la VPS sin ningún
  fallo.

## Pruebas a mano para Dani

- Que el CI del push de esta ficha sale en verde (el enlace lo da el Orquestador en el resumen y en
  el aviso de Telegram). Si sale en rojo, decir qué test.
- Cada fallo de la app que se arregle en esta ficha, con sus pasos (los añade el developer al
  arreglarlo; el doc-writer los lleva a `docs/pendiente-dani.md` al cerrar la versión). Si se
  arregla el 1 o el 2, como mínimo: con la ventana pequeña, que la ruta de la barra superior se
  pulsa y que al volver de un problema la lista queda en la misma fila.

## Fuera de alcance

- Otros tests o specs que no sean los cinco (si aparece otro inestable, se anota en el BACKLOG).
- Reintentos de Playwright (`retries`): siguen en 0.
- Cambiar los workers, el orden o el reparto de los specs.
- Escritura atómica de las exportaciones en main.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
