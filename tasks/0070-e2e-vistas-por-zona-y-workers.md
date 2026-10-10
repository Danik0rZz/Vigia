---
id: '0070'
titulo: 'e2e: partir views.spec.ts en un spec por zona (portapapeles juntos), afectados por zona y medir los workers'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067', '0069'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0070-e2e-vistas-por-zona-y-workers
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10): «partir `views.spec.ts` por zonas (los
tests del portapapeles, juntos y en serie) y medir con más workers».

## Especificación

Por qué: Playwright reparte **specs** entre workers (sin `fullyParallel`). `views.spec.ts` tiene
261 de los ~360 tests, corre en un solo worker y marca el tiempo de toda la tanda; y para
`test:e2e:affected` toda la parte de vistas es una sola área, así que tocar un fichero del servicio
lanza los 261 (ADR-0013, «Contexto»).

**1. Un spec por zona de vistas.** Con el arnés de la 0069 y las zonas de la 0067, los tests de
`views.spec.ts` se reparten en `e2e/views-<zona>.spec.ts`, uno por zona de vistas (`vistas-comun`,
`inicio`, `problemas`, `problema-detalle`, `metricas`, `entidad`, `servicio`, `host`, `proceso`,
`monitor`, `aplicacion`), y `views.spec.ts` desaparece.

- Cada spec llama a `setupViewsApp()` y `useCiWindow` como en la 0069.
- Los tests se mueven **sin cambiar títulos ni cuerpos**, en el mismo orden relativo.
- **Portapapeles:** todos los tests con `@portapapeles` van juntos a `e2e/views-portapapeles.spec.ts`
  (conservan su etiqueta de zona). Un spec corre en un solo worker y sus tests de uno en uno, así que
  no se pisan entre ellos; como ningún otro spec usa el portapapeles, no hace falta modo serie (que
  además saltaría los siguientes al primer fallo). Si el developer ve que sí hace falta, lo justifica.
- Con `--repeat-each`, solo `views-portapapeles.spec.ts` necesita `--workers=1`.

**2. Guarda ampliada** (la de la 0067): cada `views-<zona>.spec.ts` solo tiene tests de su zona; los
`@portapapeles` están todos en `views-portapapeles.spec.ts` y ese spec no tiene otros.

**3. `e2e/areas.json` por zona.** El área `views` se sustituye por un área por spec de vistas, con los
globs de su zona (por ejemplo, la página del servicio y su canal solo en `servicio`). Lo que comparten
varias zonas va en las áreas de todas ellas (por ejemplo, el código común de las páginas de entidad
en `entidad`, `servicio`, `host`, `proceso`, `monitor` y `aplicacion`). Un área cuya zona tenga tests
en `views-portapapeles.spec.ts` incluye también ese spec. La regla de siempre se mantiene: un fichero
de `src/` sin área dispara el e2e completo.

**4. Recursos propios de cada worker** (añadido por Dani al aprobar, 2026-10-10). Con más specs y
más workers, cada worker lanza su propia app y su propio simulador. Cada worker usa **su propio
puerto del simulador y su propia carpeta de datos de usuario** (`VIGIA_USER_DATA_DIR`) y de
exportación, derivados del `workerIndex` de Playwright (por ejemplo, un puerto base más el índice y
una carpeta temporal con el índice en el nombre). El cálculo es una función pura del arnés
(`workerResources(workerIndex)` o parecida) para poder probarla. Si el puerto calculado está ocupado,
el arnés falla con un mensaje claro que nombra el puerto (no prueba otro en silencio). El developer
comprueba también `tls.spec.ts` y los demás specs que levantan un servidor o una carpeta, y aplica la
misma regla si comparten algo entre workers.

**5. Medir los workers.** Con los specs ya partidos, en la VPS (22 núcleos lógicos), el e2e completo
(`npm run test:e2e:nobuild` tras un `npm run build`) **tres veces** con 4, 6 y 8 workers, y 10 si 8
mejora a 6. Se apuntan en «Verificación» la hora de inicio y fin de cada pase (`date`), la duración y
el resultado. Se queda el número más bajo de los que tienen **los tres pases en verde** y una media a
menos de un 5 % de la mejor. En el CI se mantiene 4 (`windows-latest` tiene 4 núcleos): `workers` pasa a
depender de `process.env.CI`. Medir el CI queda para cuando exista la medición automática (0074).

**Documentación:** `e2e/CLAUDE.md` (specs de vistas, portapapeles, workers), `docs/flujo.md` («Niveles
de prueba»: la línea de `views` con `--workers=1` pasa a `views-portapapeles`) y el comentario de
`playwright.config.ts`.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, amplía la guarda y añade `workerResources`.
2. No elimina nada visible para el usuario: se cumple; solo `e2e/`, `scripts/` y la configuración de
   Playwright.
3. No toca datos, API ni lógica: **no se cumple**, cambia la selección de afectados
   (`areas.json`).
4. No hay ninguna decisión que preguntar a Dani: se cumple; la regla para elegir los workers está
   escrita arriba.

## Criterios de aceptación

- CA1: `views.spec.ts` ya no existe; los títulos que da `playwright test --list` para los specs de
  vistas son los mismos 261 en `main` y en la rama (el verifier los compara con un `node -e` y deja
  el resultado en «Verificación»; la lista no se guarda en el repositorio), y todos pasan.
- CA2: la guarda pasa en el repositorio y, con specs de ejemplo, falla si un test está en el spec de
  otra zona, si un `@portapapeles` está fuera de `views-portapapeles.spec.ts` o si ese spec tiene un
  test sin `@portapapeles`.
- CA3: con `decide` (`scripts/affected-e2e.test.ts`): un cambio en un fichero de la página del
  servicio da solo `views-servicio.spec.ts` (más `smoke` y, si la zona tiene tests de portapapeles,
  `views-portapapeles.spec.ts`); uno en el código común de las páginas de entidad da las seis de
  entidad; uno en la página de Métricas, `views-metricas.spec.ts` y `views-portapapeles.spec.ts`.
- CA4: cada spec de `areas.json` existe en `e2e/` y cada `views-*.spec.ts` está en al menos un área
  (test sobre la config real).
- CA5: `playwright.config.ts` usa 4 workers con `CI` y el número medido sin él (test de `scripts/`
  que lee la config); en «Verificación», ese número tiene tres pases del e2e completo en verde.
- CA6: `workerResources` da puertos y carpetas distintos para los índices 0 a 15, siempre los mismos
  para el mismo índice, y los puertos caen en un rango válido (test unitario). Con un puerto ya
  ocupado, el arnés falla con un mensaje que nombra el puerto.
- CA7 (e2e, en `views-vistas-comun.spec.ts`): la app de ese worker usa la carpeta de datos y el
  puerto del simulador que da `workerResources(testInfo.workerIndex)`.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Medir y cambiar los workers del CI.
- `fullyParallel` dentro de un spec (cada spec lanza una app por worker; dentro de un spec se sigue
  en orden).
- `locales/` por zona (0071).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
