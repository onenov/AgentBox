import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import Pages from 'vite-plugin-pages'
import AutoImport from 'unplugin-auto-import/vite'
import { reactResolver } from 'vite-plugin-pages'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devPort = Number(env.FRONTEND_DEV_PORT || 5173)

  return {
    plugins: [
      react(),
      Pages({
        dirs: [
          { dir: 'src/pages/public', baseRoute: '' },
          { dir: 'src/pages/dashboard', baseRoute: 'dashboard' },
        ],
        extensions: ['tsx'],
        importMode: 'async',
        resolver: reactResolver(),
        moduleId: 'virtual:generated-pages-react',
      }),
      AutoImport({
        imports: [
          'react',
          'react-router-dom',
          {
            zustand: ['create'],
          },
        ],
        dirs: ['src/hooks', 'src/stores', 'src/utils'],
        dts: 'src/auto-imports.d.ts',
        eslintrc: {
          enabled: true,
          filepath: './.eslintrc-auto-import.json',
          globalsPropValue: true,
        },
      }),
      tailwindcss(),
    ],
    server: {
      port: devPort,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  }
})
