import { execSync } from 'child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
const appVersion = rootPkg.version as string;

export default defineConfig({
  define: {
    __GIT_SHA__: JSON.stringify(gitSha),
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8090',
      '/_': 'http://127.0.0.1:8090'
    }
  }
});
