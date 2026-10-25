import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('IPC Channels Consistency (main.cjs vs preload.cjs)', () => {
  const mainPath = path.resolve(__dirname, '../electron/main.cjs');
  const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');

  const mainContent = fs.readFileSync(mainPath, 'utf8');
  const preloadContent = fs.readFileSync(preloadPath, 'utf8');

  // Extracts strings like ipcRenderer.invoke('channel:name', ...)
  const extractInvokedChannels = (code) => {
    const matches = code.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g);
    return Array.from(matches, (m) => m[1]);
  };

  // Extracts strings like ipcMain.handle('channel:name', ...)
  const extractHandledChannels = (code) => {
    const matches = code.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g);
    return Array.from(matches, (m) => m[1]);
  };

  // Extracts strings like ipcRenderer.on('channel:name', ...)
  const extractReceivedChannels = (code) => {
    const matches = code.matchAll(/ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g);
    return Array.from(matches, (m) => m[1]);
  };

  // Extracts strings like webContents.send('channel:name', ...)
  const extractSentChannels = (code) => {
    const matches = code.matchAll(/webContents\.send\(\s*['"]([^'"]+)['"]/g);
    return Array.from(matches, (m) => m[1]);
  };

  it('every channel invoked in preload.cjs has a handler in main.cjs', () => {
    const invoked = extractInvokedChannels(preloadContent);
    const handled = new Set(extractHandledChannels(mainContent));

    expect(invoked.length).toBeGreaterThan(0);
    for (const channel of invoked) {
      expect(
        handled.has(channel),
        `Canal invocado no preload '${channel}' não possui handler registrado no main.cjs`
      ).toBe(true);
    }
  });

  it('every handler registered in main.cjs is exposed and invoked by preload.cjs', () => {
    const handled = extractHandledChannels(mainContent);
    const invoked = new Set(extractInvokedChannels(preloadContent));

    expect(handled.length).toBeGreaterThan(0);
    for (const channel of handled) {
      expect(
        invoked.has(channel),
        `Handler '${channel}' registrado no main.cjs não possui chamada correspondente no preload.cjs`
      ).toBe(true);
    }
  });

  it('every event listener in preload.cjs has senders in main.cjs', () => {
    const listened = extractReceivedChannels(preloadContent);
    const sent = new Set(extractSentChannels(mainContent));

    expect(listened.length).toBeGreaterThan(0);
    for (const channel of listened) {
      expect(
        sent.has(channel),
        `Listener '${channel}' no preload.cjs não é enviado por nenhum webContents.send no main.cjs`
      ).toBe(true);
    }
  });

  it('every event sent by main.cjs is listened to by preload.cjs', () => {
    const sent = Array.from(new Set(extractSentChannels(mainContent)));
    const listened = new Set(extractReceivedChannels(preloadContent));

    expect(sent.length).toBeGreaterThan(0);
    for (const channel of sent) {
      expect(
        listened.has(channel),
        `Evento '${channel}' enviado pelo main.cjs não possui listener registrado no preload.cjs`
      ).toBe(true);
    }
  });
});
