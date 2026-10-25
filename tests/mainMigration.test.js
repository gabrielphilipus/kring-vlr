import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const mockApp = {
  isPackaged: false,
  getPath: vi.fn(() => 'C:\\mock-fallback-dir'),
  getAppPath: vi.fn(() => process.cwd()),
  getVersion: vi.fn(() => '1.0.15'),
  getName: vi.fn(() => 'kring-vlr'),
  whenReady: vi.fn(() => new Promise(() => {})),
  on: vi.fn(),
};

const mockElectron = {
  app: mockApp,
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
};

const mockUpdater = {
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
};

// Mock para CommonJS require() e ESM import
require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: mockElectron,
};
require.cache[require.resolve('electron-updater')] = {
  id: require.resolve('electron-updater'),
  filename: require.resolve('electron-updater'),
  loaded: true,
  exports: mockUpdater,
};

vi.mock('electron', () => mockElectron);
vi.mock('electron-updater', () => mockUpdater);

// Require main.cjs exports
const {
  stripUtf8Bom,
  getDataDir,
  createPreMigrationBackup,
  createPreImportBackup,
  migrateAndNormalize,
  loadData,
  handleDataImport,
} = require('../electron/main.cjs');

describe('Main Process Migration & Data Persistence Integration', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kring-test-data-'));
    process.env.KRING_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.KRING_DATA_DIR;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it('respects KRING_DATA_DIR override when app.isPackaged is false', () => {
    expect(getDataDir()).toBe(path.resolve(tempDir));
  });

  it('clean first start (ENOENT with no backups) returns schemaVersion 4', async () => {
    const result = await loadData();
    expect(result.ok).toBe(true);
    expect(result.isNew).toBe(true);
    expect(result.schemaVersion).toBe(4);
    expect(result.vods).toEqual([]);
    expect(result.lineups).toEqual([]);
  });

  it('migrates v3 data to v4, creates pre-migration backup and writes v4 atomically', async () => {
    const dataFilePath = path.join(tempDir, 'kring-vlr-data.json');
    const v3Data = {
      schemaVersion: 3,
      vods: [
        {
          id: 'v1',
          map: 'Ascent',
          agent: 'Jett',
          roundsWon: '13',
          roundsLost: '7',
          kills: '15',
          deaths: '10',
          assists: '4',
        },
      ],
      lineups: [
        {
          id: 'l1',
          title: 'A Site recon',
          map: 'Ascent',
          agent: 'Sova',
        },
      ],
    };

    await fs.writeFile(dataFilePath, JSON.stringify(v3Data, null, 2), 'utf8');

    const result = await loadData();

    // 1. Return structure
    expect(result.ok).toBe(true);
    expect(result.migratedV4).toBe(true);
    expect(result.schemaVersion).toBe(4);
    expect(result.vods[0].roundsWon).toBe(13);
    expect(result.vods[0].roundsLost).toBe(7);
    expect(result.vods[0].kills).toBe(15);
    expect(result.vods[0].deaths).toBe(10);
    expect(result.vods[0].assists).toBe(4);
    expect(result.vods[0].mapId).toBe('ascent');
    expect(result.vods[0].agentId).toBe('jett');

    // 2. Pre-migration backup was created
    const backupPath = path.join(
      tempDir,
      'kring-vlr-data.pre-migration-v4.bak'
    );
    const backupContent = await fs.readFile(backupPath, 'utf8');
    const parsedBackup = JSON.parse(backupContent);
    expect(parsedBackup.schemaVersion).toBe(3);
    expect(parsedBackup.vods[0].roundsWon).toBe('13');

    // 3. Main file in disk was updated to v4
    const fileOnDisk = JSON.parse(await fs.readFile(dataFilePath, 'utf8'));
    expect(fileOnDisk.schemaVersion).toBe(4);
    expect(fileOnDisk.vods[0].roundsWon).toBe(13);
  });

  it('does not accumulate pre-migration backups in repeated failures on identical file, appending timestamp only if file changed', async () => {
    const originalFile = path.join(tempDir, 'original.json');
    await fs.writeFile(originalFile, '{"version": 1}', 'utf8');

    // Primeira tentativa de backup
    const firstBackup = await createPreMigrationBackup(originalFile);
    expect(path.basename(firstBackup)).toBe(
      'kring-vlr-data.pre-migration-v4.bak'
    );

    // Segunda tentativa com o MESMO arquivo original (ex.: falhas consecutivas de migração)
    const secondBackup = await createPreMigrationBackup(originalFile);
    // NÃO deve gerar arquivo duplicado
    expect(secondBackup).toBe(firstBackup);

    // Terceira tentativa caso o arquivo original tenha sido alterado externamente
    await fs.writeFile(originalFile, '{"version": 2}', 'utf8');
    const thirdBackup = await createPreMigrationBackup(originalFile);
    expect(path.basename(thirdBackup)).toMatch(
      /^kring-vlr-data\.pre-migration-v4\.\d+\.bak$/
    );
    expect(firstBackup).not.toBe(thirdBackup);
  });

  it('rejects unsupported future schemaVersion (e.g. 99) without modifying original file', async () => {
    const dataFilePath = path.join(tempDir, 'kring-vlr-data.json');
    const futureData = {
      schemaVersion: 99,
      futureFeature: 'quantum-analysis',
      vods: [],
    };
    await fs.writeFile(
      dataFilePath,
      JSON.stringify(futureData, null, 2),
      'utf8'
    );

    const result = await loadData();

    // 1. Rejected with unsupported-version
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported-version');
    expect(result.currentVersion).toBe(99);

    // 2. Original file remains untouched on disk
    const contentOnDisk = await fs.readFile(dataFilePath, 'utf8');
    const parsedDisk = JSON.parse(contentOnDisk);
    expect(parsedDisk.schemaVersion).toBe(99);
    expect(parsedDisk.futureFeature).toBe('quantum-analysis');

    // 3. No pre-migration backup created
    const files = await fs.readdir(tempDir);
    expect(files.some((f) => f.includes('pre-migration-v4'))).toBe(false);
  });

  it('recovers from legacy backup file when main file is missing and saves v4 atomically', async () => {
    const backupFilePath = path.join(
      tempDir,
      'kring-vlr-data.20261025-1200.bak'
    );
    const backupData = {
      schemaVersion: 3,
      vods: [
        {
          id: 'v-legacy-bak',
          map: 'Bind',
          agent: 'Raze',
          roundsWon: '13',
          roundsLost: '11',
        },
      ],
      lineups: [],
    };
    await fs.writeFile(
      backupFilePath,
      JSON.stringify(backupData, null, 2),
      'utf8'
    );

    const result = await loadData();

    expect(result.ok).toBe(true);
    expect(result.recoveredFromBackup).toBe(true);
    expect(result.backupSource).toBe('kring-vlr-data.20261025-1200.bak');
    expect(result.schemaVersion).toBe(4);
    expect(result.vods[0].roundsWon).toBe(13);
    expect(result.vods[0].mapId).toBe('bind');

    // Main file was restored and saved as v4
    const restoredMain = JSON.parse(
      await fs.readFile(path.join(tempDir, 'kring-vlr-data.json'), 'utf8')
    );
    expect(restoredMain.schemaVersion).toBe(4);
    expect(restoredMain.vods[0].roundsWon).toBe(13);
  });

  it('migrateAndNormalize handles legacy backups and rejects future versions for data:import', () => {
    const seed = {
      maps: [{ id: 'haven', name: 'Haven' }],
      agents: [{ id: 'omen', name: 'Omen' }],
    };

    // 1. Legacy backup import
    const legacyImport = {
      vods: [{ map: 'Haven', agent: 'Omen', roundsWon: '13', roundsLost: '5' }],
      lineups: [],
    };
    const importRes = migrateAndNormalize(legacyImport, seed);
    expect(importRes.ok).toBe(true);
    expect(importRes.migratedV4).toBe(true);
    expect(importRes.data.schemaVersion).toBe(4);
    expect(importRes.data.vods[0].roundsWon).toBe(13);
    expect(importRes.data.vods[0].mapId).toBe('haven');
    expect(importRes.data.vods[0].agentId).toBe('omen');

    // 2. Future schemaVersion backup import
    const futureImport = {
      schemaVersion: 99,
      vods: [],
      lineups: [],
    };
    const futureRes = migrateAndNormalize(futureImport, seed);
    expect(futureRes.ok).toBe(false);
    expect(futureRes.reason).toBe('unsupported-version');
    expect(futureRes.currentVersion).toBe(99);
  });

  it('preserves original file intact if disk write fails during atomic migration', async () => {
    const dataFilePath = path.join(tempDir, 'kring-vlr-data.json');
    const originalV3Content = JSON.stringify(
      {
        schemaVersion: 3,
        vods: [{ id: 'v1', map: 'Ascent', agent: 'Jett', roundsWon: '13' }],
      },
      null,
      2
    );
    await fs.writeFile(dataFilePath, originalV3Content, 'utf8');

    // Simula falha catastrófica no rename da gravação atômica
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(
        new Error('EACCES: permission denied during atomic swap')
      );

    const result = await loadData();

    // 1. Informa falha na migração
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('migration-failed');
    expect(result.error).toContain('permission denied');

    // 2. Arquivo original permanece intacto com os dados v3
    const diskContent = await fs.readFile(dataFilePath, 'utf8');
    expect(diskContent).toBe(originalV3Content);

    renameSpy.mockRestore();
  });

  it('tolerates UTF-8 BOM (\\uFEFF) in stripUtf8Bom helper and loadData', async () => {
    expect(stripUtf8Bom('\uFEFF{"hello": "world"}')).toBe('{"hello": "world"}');
    expect(stripUtf8Bom('{"hello": "world"}')).toBe('{"hello": "world"}');

    const dataFilePath = path.join(tempDir, 'kring-vlr-data.json');
    const rawData = JSON.stringify({
      schemaVersion: 4,
      vods: [],
      lineups: [],
    });
    // Escreve com BOM UTF-8 no início (\uFEFF)
    await fs.writeFile(dataFilePath, '\uFEFF' + rawData, 'utf8');

    const result = await loadData();
    expect(result.ok).toBe(true);
    expect(result.schemaVersion).toBe(4);
    expect(result.vods).toEqual([]);
  });

  it('tolerates UTF-8 BOM in data:import string payload and creates pre-import backup of current data', async () => {
    // 1. Prepara dados atuais existentes em disco
    const dataFilePath = path.join(tempDir, 'kring-vlr-data.json');
    await fs.writeFile(
      dataFilePath,
      JSON.stringify(
        { schemaVersion: 4, vods: [{ id: 'current' }], lineups: [] },
        null,
        2
      ),
      'utf8'
    );

    // 2. Cria backup pré-importação
    const backupCreated = await createPreImportBackup();
    expect(backupCreated).not.toBeNull();
    expect(path.basename(backupCreated)).toMatch(
      /^kring-vlr-data\.pre-import-\d{8}-\d{4}(\.\d+)?\.bak$/
    );

    // 3. Testa que data:import tolera string com BOM UTF-8
    const rawBackupWithBom =
      '\uFEFF' +
      JSON.stringify({
        schemaVersion: 3,
        vods: [
          { map: 'Ascent', agent: 'Jett', roundsWon: '13', roundsLost: '8' },
        ],
        lineups: [],
      });

    const importRes = await handleDataImport(rawBackupWithBom);
    expect(importRes.ok).toBe(true);
    expect(importRes.migratedV4).toBe(true);
    expect(importRes.data.schemaVersion).toBe(4);
    expect(importRes.data.vods[0].roundsWon).toBe(13);
  });
});
