import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // El preload corre en sandbox y no puede hacer `require` de paquetes:
      // todas sus dependencias (Zod) van dentro del fichero compilado.
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [
      // React Compiler (ficha 0059): memoiza componentes y valores en el build, para que una
      // fila del DataGrid solo se vuelva a pintar si cambia. Lo que no cumple sus reglas se lo
      // salta él solo (aviso de lint) o va con "use no memo" y su motivo.
      react({ babel: { plugins: ['babel-plugin-react-compiler'] } }),
      tailwindcss()
    ]
  }
})
