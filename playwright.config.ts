import { defineConfig } from '@playwright/test'

/** Etiqueta de los tests en cuarentena (ficha 0075): no bloquean, pero se siguen ejecutando aparte. */
const QUARANTINE = /@inestable(\s|$)/

/**
 * Workers sin CI (ficha 0087): 6 y no 8, el más rápido. Con 8 subieron los fallos de tiempos
 * (tooltips, tamaño de ventana) con la suite en paralelo; 6 cuesta unos 10-15 s más por pase
 * (medición de la 0070, en su «Verificación», en la VPS de 22 núcleos lógicos). En el CI, 4:
 * `windows-latest` tiene 4 núcleos.
 */
const LOCAL_WORKERS = 6

/** Pruebas de extremo a extremo sobre la app compilada (`npm run test:e2e`). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Un spec por worker (sin fullyParallel): cada uno lanza su app con su carpeta de datos y, los
  // de vistas, su simulador en el puerto del worker (e2e/worker-resources.ts). Solo
  // views-portapapeles usa el portapapeles del sistema; un test que lo use va a ese spec.
  workers: process.env['CI'] ? 4 : LOCAL_WORKERS,
  // Sin reintentos: un test inestable tiene que fallar y arreglarse, no pasar a la segunda.
  retries: 0,
  // Un test.only olvidado haría pasar la suite con un solo test: se rechaza.
  forbidOnly: true,
  // Sin trace ni screenshot: los specs lanzan Electron con electron.launch y esas
  // opciones solo valen para las fixtures de página. La captura y el log de un
  // test que falla los adjunta e2e/failure-capture.ts.
  reporter: 'list',
  // Ficha 0075: `e2e` es el que bloquea (test:e2e, test:e2e:nobuild, test:e2e:affected y el CI);
  // `inestables`, solo los de la cuarentena (test:e2e:inestables), que no bloquean. Los proyectos
  // solo cambian el filtro: el resto de opciones es el común de arriba.
  projects: [
    { name: 'e2e', grepInvert: QUARANTINE },
    { name: 'inestables', grep: QUARANTINE }
  ]
})
