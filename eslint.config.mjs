import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import eslintPluginI18next from 'eslint-plugin-i18next'

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', '**/test-results', '**/playwright-report']
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // La interfaz solo habla con main a través de `window.vigia`.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'El renderer no puede importar Electron.' }],
          patterns: [
            {
              group: ['**/main/**', '**/preload/**', 'node:*'],
              message: 'El renderer no puede importar código de main, del preload ni de Node.'
            }
          ]
        }
      ]
    }
  },
  {
    // Ningún texto de interfaz escrito en los componentes: todo pasa por i18next.
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { i18next: eslintPluginI18next },
    rules: {
      'i18next/no-literal-string': 'error'
    }
  },
  {
    // Scripts de Node en JavaScript: sin tipos de retorno.
    files: ['scripts/**/*.{js,mjs}'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  eslintConfigPrettier
)
