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
const backupFile = () => path.join(app.getPath('userData'), 'kring-vlr-data.json.bak');
const emptyData = () => ({ vods: [], lineups: [], tactics: [], training: [], gameplans: [], schemaVersion: 3 });
const seedFile = () => path.join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'catalogs.json');

async function loadCatalogSeed() {
  try {
    const parsed = JSON.parse(await fs.readFile(seedFile(), 'utf8'));
    return { maps: Array.isArray(parsed.maps) ? parsed.maps : [], agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch { return { maps: [], agents: [] }; }
}

function formatDataPayload(parsed, seed) {
  return {
    ...parsed,
    vods: Array.isArray(parsed.vods) ? parsed.vods : [],
    lineups: Array.isArray(parsed.lineups) ? parsed.lineups : [],
    tactics: Array.isArray(parsed.tactics) ? parsed.tactics : [],
    training: Array.isArray(parsed.training) ? parsed.training : [],
    gameplans: Array.isArray(parsed.gameplans) ? parsed.gameplans : [],
    maps: Array.isArray(parsed.maps) ? parsed.maps : seed.maps,
    agents: Array.isArray(parsed.agents) ? parsed.agents : seed.agents,
    schemaVersion: parsed.schemaVersion || 3,
  };
}

async function loadData() {
  const file = dataFile();
  const bak = backupFile();
  const seed = await loadCatalogSeed();

  let fileContent = null;
  let fileExists = true;

  try {
    fileContent = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      fileExists = false;
    } else {
      console.error('[loadData] Erro ao acessar o arquivo de dados:', err);
    }
  }

  // 1. Arquivo não existe ainda (primeira execução limpa): retorna dados padrão/seed
  if (!fileExists) {
    return { ok: true, isNew: true, ...emptyData(), ...seed };
  }

  // 2. Arquivo existe: tentar analisar o JSON
  let parsed = null;
  try {
    if (fileContent && typeof fileContent === 'string' && fileContent.trim().length > 0) {
      parsed = JSON.parse(fileContent);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Conteúdo não é um objeto JSON válido.');
      }
    } else {
      throw new Error('Arquivo de dados está vazio.');
    }
  } catch (parseErr) {
    console.error('[loadData] Arquivo de dados principal ilegível/corrompido:', parseErr.message);
  }

  // Se o JSON principal for válido, retorna com sucesso
  if (parsed) {
    return { ok: true, ...formatDataPayload(parsed, seed) };
  }

  // 3. O arquivo principal falhou! Tentar carregar do backup (.bak)
  console.warn('[loadData] Tentando recuperação via arquivo de backup (.bak)...');
  let backupContent = null;
  let backupParsed = null;

  try {
    backupContent = await fs.readFile(bak, 'utf8');
    if (backupContent && backupContent.trim().length > 0) {
      backupParsed = JSON.parse(backupContent);
      if (typeof backupParsed !== 'object' || backupParsed === null) {
        backupParsed = null;
      }
    }
  } catch (bakErr) {
    console.error('[loadData] Backup (.bak) indisponível ou inválido:', bakErr.message);
  }

  if (backupParsed) {
    console.info('[loadData] Dados recuperados com sucesso a partir do backup (.bak)!');
    const timestamp = Date.now();
    const corruptedPreserved = path.join(app.getPath('userData'), `kring-vlr-data.corrupted-${timestamp}.json`);
    try {
      await fs.copyFile(file, corruptedPreserved);
    } catch {}

    return {
      ok: true,
      recoveredFromBackup: true,
      corruptedPreservedAs: path.basename(corruptedPreserved),
      ...formatDataPayload(backupParsed, seed),
    };
  }

  // 4. O backup também falhou ou não existe! Preservar o arquivo corrompido e NÃO sobrescrever com emptyData
  const timestamp = Date.now();
  const corruptedFile = path.join(app.getPath('userData'), `kring-vlr-data.corrupted-${timestamp}.json`);
  try {
    await fs.rename(file, corruptedFile);
    console.warn(`[loadData] Arquivo corrompido preservado em: ${corruptedFile}`);
  } catch (renameErr) {
    console.error('[loadData] Não foi possível renomear arquivo corrompido:', renameErr);
  }

  return {
    ok: false,
    reason: 'corrupted',
    preservedAs: path.basename(corruptedFile),
  };
}

ipcMain.handle('data:load', async () => loadData());
ipcMain.handle('data:save', async (_event, data) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.vods) || !Array.isArray(data.lineups)) {
    throw new Error('Formato de dados inválido.');
  }
  const file = dataFile();
  const bak = backupFile();
  const temp = `${file}.tmp`;

  // Antes de gravar, se o arquivo atual for um JSON válido, copie-o para .bak.
  // Se o arquivo atual for inválido, NÃO sobrescreva o .bak!
  try {
    const existingContent = await fs.readFile(file, 'utf8');
    const existingParsed = JSON.parse(existingContent);
    if (existingParsed && typeof existingParsed === 'object' && Array.isArray(existingParsed.vods)) {
      await fs.copyFile(file, bak);
    }
  } catch {
    // Arquivo atual não existe ainda ou está corrompido: preserva o .bak intacto
  }

  const payload = {
    ...data,
    tactics: Array.isArray(data.tactics) ? data.tactics : [],
    training: Array.isArray(data.training) ? data.training : [],
    gameplans: Array.isArray(data.gameplans) ? data.gameplans : [],
    maps: Array.isArray(data.maps) ? data.maps : [],
    agents: Array.isArray(data.agents) ? data.agents : [],
    schemaVersion: 3,
  };

  await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
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

const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi']);

function terminateProcessTree(proc) {
  if (!proc || !proc.pid) return;
  const pid = proc.pid;
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('node:child_process');
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 800);
    }
  } catch {}
}

// Start native computer vision analyzer process
ipcMain.handle('vod:start-analysis', async (event, { videoPath, maxSeconds, userNick, userAgent, timeoutMs }) => {
  if (currentAnalyzerProcess) {
    terminateProcessTree(currentAnalyzerProcess);
    currentAnalyzerProcess = null;
  }

  // 1. Validar que videoPath é string, existe e possui extensão permitida
  if (typeof videoPath !== 'string' || !videoPath.trim()) {
    return { ok: false, error: 'Caminho do arquivo de vídeo inválido ou não fornecido.' };
  }
  const normVideoPath = path.normalize(videoPath.trim());
  if (!path.isAbsolute(normVideoPath)) {
    return { ok: false, error: 'O caminho do vídeo deve ser um caminho absoluto.' };
  }
  const ext = path.extname(normVideoPath).toLowerCase();
  if (!ALLOWED_VIDEO_EXTS.has(ext)) {
    return { ok: false, error: `Extensão de vídeo não permitida (${ext || 'sem extensão'}). Formatos aceitos: .mp4, .mkv, .webm, .mov, .avi` };
  }
  try {
    const stat = await fs.stat(normVideoPath);
    if (!stat.isFile()) {
      return { ok: false, error: 'O caminho informado não é um arquivo válido.' };
    }
  } catch {
    return { ok: false, error: `Arquivo de vídeo não encontrado no caminho: ${normVideoPath}` };
  }

  return new Promise((resolve) => {
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
      args = ['--video', normVideoPath];
      if (maxSeconds) args.push('--max-seconds', String(maxSeconds));
      if (userNick) args.push('--user-nick', String(userNick));
      if (userAgent) args.push('--user-agent', String(userAgent));
    } else {
      command = resolvePython();
      const analyzerScript = path.join(analyzerDir, 'analyzer.py');
      args = [analyzerScript, '--video', normVideoPath];
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

    // 2. Timeout configurável para a análise (padrão generoso de 45 minutos)
    const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
    const timeoutDuration = (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0)
      ? Number(timeoutMs)
      : DEFAULT_TIMEOUT_MS;

    const timeoutTimer = setTimeout(() => {
      if (currentAnalyzerProcess === pythonProcess) {
        const timeoutMsg = `Tempo limite de análise excedido (${Math.round(timeoutDuration / 60000)} minutos). O processo foi encerrado para evitar travamento.`;
        console.warn(`[vod:start-analysis] ${timeoutMsg}`);
        mainWindow?.webContents.send('vod:error', timeoutMsg);
        terminateProcessTree(pythonProcess);
        currentAnalyzerProcess = null;
        resolve({ ok: false, error: timeoutMsg });
      }
    }, timeoutDuration);

    let finalResult = null;
    let reportedError = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';

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
          } else if (parsed.type === 'error') {
            reportedError = parsed.message;
            mainWindow?.webContents.send('vod:error', parsed.message);
          } else if (parsed.type === 'complete') {
            finalResult = parsed.data;
          }
        } catch {}
      }
    });

    // 3. Captura contínua de stderr do Python
    pythonProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;
      console.warn('[Analyzer STDERR]', text);
    });

    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutTimer);
      currentAnalyzerProcess = null;
      if (reportedError) {
        resolve({ ok: false, error: reportedError });
      } else if (code === 0 && finalResult) {
        resolve({ ok: true, data: finalResult });
      } else if (code === 0) {
        try {
          const parsed = JSON.parse(stdoutBuffer.trim());
          if (parsed.type === 'complete') resolve({ ok: true, data: parsed.data });
          else if (parsed.type === 'error') resolve({ ok: false, error: parsed.message });
          else resolve({ ok: true, data: parsed });
        } catch {
          resolve({ ok: false, error: 'A análise foi concluída, mas o JSON final não pôde ser lido.' });
        }
      } else {
        const detail = stderrBuffer.trim() ? `: ${stderrBuffer.trim().slice(-300)}` : '';
        const errMsg = `Processo do analisador encerrou com erro (código ${code})${detail}`;
        mainWindow?.webContents.send('vod:error', errMsg);
        resolve({ ok: false, error: errMsg });
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(timeoutTimer);
      currentAnalyzerProcess = null;
      let msg = err.message;
      if (err.code === 'ENOENT') {
        msg = 'Python não foi encontrado no sistema. Para analisar vídeos sem Python instalado, compile o executável analyzer.exe ou instale o Python marcando "Add Python to PATH".';
      }
      mainWindow?.webContents.send('vod:error', msg);
      resolve({ ok: false, error: msg });
    });
  });
});

ipcMain.handle('vod:cancel-analysis', async () => {
  if (currentAnalyzerProcess) {
    terminateProcessTree(currentAnalyzerProcess);
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

      // 1. Rejeitar caminhos não absolutos e normalizar
      if (!targetPath || !path.isAbsolute(targetPath)) {
        return new Response('Caminho de vídeo inválido ou não absoluto.', { status: 400 });
      }
      targetPath = path.normalize(targetPath);

      // 2. Rejeitar extensões não permitidas
      const ext = path.extname(targetPath).toLowerCase();
      if (!ALLOWED_VIDEO_EXTS.has(ext)) {
        return new Response('Extensão de arquivo não permitida para reprodução.', { status: 403 });
      }

      const stat = await fs.stat(targetPath);
      if (!stat.isFile()) {
        return new Response('O caminho informado não é um arquivo.', { status: 400 });
      }

      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
      };
      const contentType = mimeTypes[ext] || 'video/mp4';

      // 3. Suporte correto a Range requests incluindo sufixos (bytes=-N)
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          let start;
          let end;

          if (!match[1] && match[2]) {
            // Suffix range: bytes=-500 (solicita os últimos 500 bytes)
            const suffixLen = parseInt(match[2], 10);
            start = Math.max(0, fileSize - suffixLen);
            end = fileSize - 1;
          } else {
            start = parseInt(match[1], 10) || 0;
            end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          }

          if (start >= fileSize || end < start) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${fileSize}` },
            });
          }

          end = Math.min(end, fileSize - 1);
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

app.on('before-quit', () => {
  if (currentAnalyzerProcess) {
    terminateProcessTree(currentAnalyzerProcess);
    currentAnalyzerProcess = null;
  }
});

app.on('will-quit', () => {
  if (currentAnalyzerProcess) {
    terminateProcessTree(currentAnalyzerProcess);
    currentAnalyzerProcess = null;
  }
});

