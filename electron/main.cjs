const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');

// Register custom protocol for high-performance hardware-accelerated local video playback
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-video',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow;
let currentAnalyzerProcess = null;
const dataFile = () => path.join(app.getPath('userData'), 'kring-vlr-data.json');
const emptyData = () => ({ vods: [], lineups: [], tactics: [], training: [], gameplans: [], schemaVersion: 3 });
const seedFile = () => path.join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'catalogs.json');

async function loadCatalogSeed() {
  try {
    const parsed = JSON.parse(await fs.readFile(seedFile(), 'utf8'));
    return { maps: Array.isArray(parsed.maps) ? parsed.maps : [], agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch { return { maps: [], agents: [] }; }
}

async function loadData() {
  try {
    const raw = await fs.readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw);
    const seed = await loadCatalogSeed();
    return {
      ...parsed,
      vods: Array.isArray(parsed.vods) ? parsed.vods : [],
      lineups: Array.isArray(parsed.lineups) ? parsed.lineups : [],
      tactics: Array.isArray(parsed.tactics) ? parsed.tactics : [],
      training: Array.isArray(parsed.training) ? parsed.training : [],
      gameplans: Array.isArray(parsed.gameplans) ? parsed.gameplans : [],
      maps: Array.isArray(parsed.maps) ? parsed.maps : seed.maps,
      agents: Array.isArray(parsed.agents) ? parsed.agents : seed.agents,
      schemaVersion: 3,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Não foi possível ler os dados:', error);
    return { ...emptyData(), ...await loadCatalogSeed() };
  }
}

ipcMain.handle('data:load', async () => loadData());
ipcMain.handle('data:save', async (_event, data) => {
  if (!data || !Array.isArray(data.vods) || !Array.isArray(data.lineups)) {
    throw new Error('Formato de dados inválido.');
  }
  const file = dataFile();
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ ...data, tactics: Array.isArray(data.tactics) ? data.tactics : [], training: Array.isArray(data.training) ? data.training : [], gameplans: Array.isArray(data.gameplans) ? data.gameplans : [], maps: Array.isArray(data.maps) ? data.maps : [], agents: Array.isArray(data.agents) ? data.agents : [], schemaVersion: 3 }, null, 2), 'utf8');
  await fs.rename(temp, file);
  return { ok: true };
});

ipcMain.handle('external:open', async (_event, url) => {
  if (typeof url !== 'string') return { ok: false };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return { ok: false };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// Select local video file via native dialog
ipcMain.handle('video:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar gravação da Scrim / Treino',
    filters: [
      { name: 'Vídeos de Valorant (*.mp4, *.mkv, *.webm, *.mov)', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

function resolvePython() {
  const fsSync = require('node:fs');
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
    path.join(process.env.PROGRAMFILES || '', 'Python312', 'python.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Python311', 'python.exe'),
  ];
  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) return c;
    } catch {}
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getAnalyzerDir() {
  const fsSync = require('node:fs');
  if (app.isPackaged) {
    const resPath = path.join(process.resourcesPath, 'analyzer');
    if (fsSync.existsSync(resPath)) return resPath;
  }
  const appPath = path.join(app.getAppPath(), 'analyzer');
  if (fsSync.existsSync(appPath)) return appPath;
  return process.resourcesPath || app.getPath('userData');
}

// Start native computer vision analyzer process
ipcMain.handle('vod:start-analysis', async (event, { videoPath, maxSeconds, userNick, userAgent }) => {
  if (currentAnalyzerProcess) {
    try { currentAnalyzerProcess.kill(); } catch {}
    currentAnalyzerProcess = null;
  }

  return new Promise((resolve, reject) => {
    const fsSync = require('node:fs');
    const analyzerDir = getAnalyzerDir();

    // Check if a compiled standalone analyzer binary exists (so Python is not required)
    const possibleBinaries = [
      path.join(analyzerDir, 'analyzer.exe'),
      path.join(analyzerDir, 'dist', 'analyzer.exe'),
      path.join(process.resourcesPath || '', 'analyzer.exe'),
      path.join(process.resourcesPath || '', 'analyzer', 'analyzer.exe'),
      path.join(app.getAppPath(), 'analyzer', 'analyzer.exe'),
    ];

    let standaloneExe = null;
    for (const bin of possibleBinaries) {
      try {
        if (fsSync.existsSync(bin)) {
          standaloneExe = bin;
          break;
        }
      } catch {}
    }

    let command;
    let args;

    if (standaloneExe) {
      command = standaloneExe;
      args = ['--video', videoPath];
      if (maxSeconds) args.push('--max-seconds', String(maxSeconds));
      if (userNick) args.push('--user-nick', String(userNick));
      if (userAgent) args.push('--user-agent', String(userAgent));
    } else {
      command = resolvePython();
      const analyzerScript = path.join(analyzerDir, 'analyzer.py');
      args = [analyzerScript, '--video', videoPath];
      if (maxSeconds) args.push('--max-seconds', String(maxSeconds));
      if (userNick) args.push('--user-nick', String(userNick));
      if (userAgent) args.push('--user-agent', String(userAgent));
    }

    let cwdDir = analyzerDir;
    try {
      if (!fsSync.existsSync(cwdDir)) {
        cwdDir = app.getPath('userData');
      }
    } catch {
      cwdDir = app.getPath('userData');
    }

    const pythonProcess = spawn(command, args, {
      cwd: cwdDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    currentAnalyzerProcess = pythonProcess;
    let finalResult = null;
    let stdoutBuffer = '';

    pythonProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // preserve incomplete line chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'progress') {
            mainWindow?.webContents.send('vod:progress', parsed);
          } else if (parsed.type === 'kill_event') {
            mainWindow?.webContents.send('vod:kill-event', parsed.event);
          } else if (parsed.type === 'complete') {
            finalResult = parsed.data;
          }
        } catch {}
      }
    });

    pythonProcess.stderr.on('data', (chunk) => {
      console.warn('[Analyzer STDERR]', chunk.toString('utf8'));
    });

    pythonProcess.on('close', (code) => {
      currentAnalyzerProcess = null;
      if (code === 0 && finalResult) {
        resolve({ ok: true, data: finalResult });
      } else if (code === 0) {
        try {
          const parsed = JSON.parse(stdoutBuffer.trim());
          if (parsed.type === 'complete') resolve({ ok: true, data: parsed.data });
          else resolve({ ok: true, data: parsed });
        } catch {
          resolve({ ok: false, error: 'A análise foi concluída, mas o JSON final não pôde ser lido.' });
        }
      } else {
        resolve({ ok: false, error: `Processo encerrado com código ${code}.` });
      }
    });

    pythonProcess.on('error', (err) => {
      currentAnalyzerProcess = null;
      let msg = err.message;
      if (err.code === 'ENOENT') {
        msg = 'Python não foi encontrado no sistema. Para analisar vídeos sem Python instalado, compile o executável analyzer.exe ou instale o Python marcando "Add Python to PATH".';
      }
      resolve({ ok: false, error: msg });
    });
  });
});

ipcMain.handle('vod:cancel-analysis', async () => {
  if (currentAnalyzerProcess) {
    try { currentAnalyzerProcess.kill(); } catch {}
    currentAnalyzerProcess = null;
    return { ok: true };
  }
  return { ok: false };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#080d18',
    title: 'Kring VLR',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.kring.vlrstats');

  protocol.handle('local-video', async (request) => {
    try {
      const url = new URL(request.url);
      let targetPath = url.searchParams.get('path');
      if (!targetPath) {
        let raw = decodeURIComponent(request.url.replace(/^local-video:\/\//, ''));
        if (process.platform === 'win32' && /^[a-zA-Z]\//.test(raw)) {
          raw = raw[0].toUpperCase() + ':/' + raw.slice(2);
        } else if (process.platform === 'win32' && raw.startsWith('/') && raw.length > 2 && raw[2] === ':') {
          raw = raw.slice(1);
        }
        targetPath = raw;
      }

      const stat = await fs.stat(targetPath);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      const ext = path.extname(targetPath).toLowerCase();
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
      };
      const contentType = mimeTypes[ext] || 'video/mp4';

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        const nodeStream = nodeFs.createReadStream(targetPath, { start, end });
        const webStream = Readable.toWeb(nodeStream);

        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
          },
        });
      }

      const nodeStream = nodeFs.createReadStream(targetPath);
      const webStream = Readable.toWeb(nodeStream);
      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Length': String(fileSize),
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      console.error('[local-video] Erro ao servir vídeo local:', err);
      return new Response('Vídeo não encontrado: ' + (err?.message || err), { status: 404 });
    }
  });

  createWindow();

  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      mainWindow?.webContents.send('updater:status', { status: 'checking', message: 'Verificando atualizações...' });
    });

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('updater:status', {
        status: 'available',
        version: info?.version,
        message: `Nova versão v${info?.version || ''} encontrada! Baixando...`
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      mainWindow?.webContents.send('updater:status', {
        status: 'downloading',
        percent: Math.round(progressObj.percent),
        message: `Baixando atualização: ${Math.round(progressObj.percent)}%`
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('updater:status', {
        status: 'downloaded',
        version: info?.version,
        message: `Versão v${info?.version || ''} pronta para instalar!`
      });
    });

    function formatUpdaterError(err) {
      const msg = err?.message || String(err);
      if (msg.includes('latest.yml') || msg.includes('404')) {
        return 'Uma nova versão está sendo compilada nos servidores do GitHub. Aguarde 1 a 2 minutos e tente novamente.';
      }
      if (msg.includes('net::ERR_INTERNET_DISCONNECTED') || msg.includes('ENOTFOUND')) {
        return 'Sem conexão com a internet para verificar atualizações.';
      }
      return `Erro ao verificar atualizações: ${msg}`;
    }

    autoUpdater.on('error', (err) => {
      mainWindow?.webContents.send('updater:status', {
        status: 'error',
        message: formatUpdaterError(err)
      });
    });

    // Check on startup after 2 seconds
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[AutoUpdater] Erro ao verificar atualizações:', err?.message || err);
      });
    }, 2000);
  }

  ipcMain.handle('updater:check', async () => {
    if (app.isPackaged) {
      try {
        const res = await autoUpdater.checkForUpdates();
        return { ok: true, updateInfo: res?.updateInfo };
      } catch (err) {
        const msg = err?.message || String(err);
        const friendly = (msg.includes('latest.yml') || msg.includes('404'))
          ? 'Uma nova versão está sendo compilada nos servidores do GitHub. Aguarde 1 a 2 minutos e tente novamente.'
          : (msg.includes('net::ERR_INTERNET_DISCONNECTED') || msg.includes('ENOTFOUND'))
          ? 'Sem conexão com a internet.'
          : `Erro: ${msg}`;
        return { ok: false, error: friendly };
      }
    }
    return { ok: false, message: 'Modo de desenvolvimento (app não empacotado)' };
  });

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall(true, true);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
