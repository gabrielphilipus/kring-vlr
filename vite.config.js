import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function tesseractAssets() {
  const coreNames = [
    'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm',
    'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm',
  ];
  const assets = () => {
    const coreDir = path.dirname(require.resolve('tesseract.js-core'));
    const langFile = require.resolve('@tesseract.js-data/eng');
    const langDir = path.join(path.dirname(langFile), '4.0.0');
    return [
      ['worker.min.js', require.resolve('tesseract.js/dist/worker.min.js')],
      ...coreNames.map((name) => [name, path.join(coreDir, name)]),
      ['eng.traineddata.gz', path.join(langDir, 'eng.traineddata.gz')],
    ];
  };
  return {
    name: 'tesseract-local-assets',
    configureServer(server) {
      server.middlewares.use('/ocr', (req, res, next) => {
        const name = decodeURIComponent((req.url || '').split('?')[0].replace(/^\//, ''));
        const item = assets().find(([assetName]) => assetName === name);
        if (!item) return next();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.gz') ? 'application/gzip' : 'application/javascript');
        fs.createReadStream(item[1]).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, file] of assets()) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: fs.readFileSync(file) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tesseractAssets()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
