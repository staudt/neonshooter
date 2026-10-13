import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves maps/*.map (dev: straight from the project root; build: copied into dist/maps)
 * and pushes a `neon:map-changed` HMR event when one is saved, so the game hot-reloads
 * the level without a page reload.
 */
function neonMaps(): Plugin {
  const dir = resolve('maps');
  return {
    name: 'neon-maps',
    configureServer(server) {
      // Vite treats *.map URLs as sourcemaps, so serve level files ourselves.
      server.middlewares.use('/maps/', (req, res, next) => {
        const name = basename(decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!name.endsWith('.map')) return next();
        try {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(readFileSync(resolve(dir, name)));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
      server.watcher.add(dir);
      const notify = (file: string) => {
        if (!file.startsWith(dir) || !file.endsWith('.map')) return;
        server.ws.send({
          type: 'custom',
          event: 'neon:map-changed',
          data: { name: basename(file, '.map') },
        });
      };
      server.watcher.on('change', notify);
      server.watcher.on('add', notify);
    },
    generateBundle() {
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.map')))
        this.emitFile({
          type: 'asset',
          fileName: `maps/${f}`,
          source: readFileSync(resolve(dir, f)),
        });
    },
  };
}

export default defineConfig({
  plugins: [neonMaps()],
  server: { port: 5173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
