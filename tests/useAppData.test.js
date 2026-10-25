import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canTriggerAutoSave,
  EMPTY_APP_DATA,
  normalizeLoadedData,
} from '../src/hooks/useAppData.js';

describe('useAppData: Data Normalization and Auto-Save Guards', () => {
  it('returns clean structure with default catalogs when loaded data is null or empty', () => {
    const seed = {
      maps: [{ id: 'ascent', name: 'Ascent' }],
      agents: [{ id: 'jett', name: 'Jett' }],
    };
    const normalized = normalizeLoadedData(null, seed);
    expect(normalized.vods).toEqual([]);
    expect(normalized.lineups).toEqual([]);
    expect(normalized.maps).toEqual(seed.maps);
    expect(normalized.agents).toEqual(seed.agents);
  });

  it('migrates legacy Roubo de ultimate category to Rounds de ultimate in tactics', () => {
    const loaded = {
      tactics: [
        { id: 't1', category: 'Roubo de ultimate' },
        { id: 't2', category: 'Default' },
      ],
    };
    const normalized = normalizeLoadedData(loaded);
    expect(normalized.tactics[0].category).toBe('Rounds de ultimate');
    expect(normalized.tactics[1].category).toBe('Default');
  });

  it('guarantees canTriggerAutoSave is false when not ready or when dataLoadError is present', () => {
    // 1. Initial state before load completes
    expect(canTriggerAutoSave(false, null)).toBe(false);

    // 2. Critical corruption error: MUST BLOCK AUTO-SAVE
    const corruptionError = {
      ok: false,
      reason: 'corrupted',
      preservedAs: 'kring-vlr-data.corrupted-123.json',
    };
    expect(canTriggerAutoSave(false, corruptionError)).toBe(false);
    expect(canTriggerAutoSave(true, corruptionError)).toBe(false);

    // 3. Successfully loaded and clean state
    expect(canTriggerAutoSave(true, null)).toBe(true);
  });
});

describe('useAppData: Auto-Save Protection Simulation with mocked kringAPI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('proves saveData is NEVER called when loaded data indicates corruption', async () => {
    const mockSaveData = vi.fn().mockResolvedValue({ ok: true });
    const mockLoadData = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'corrupted',
      preservedAs: 'kring-vlr-data.corrupted-999.json',
    });

    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      kringAPI: {
        loadData: mockLoadData,
        saveData: mockSaveData,
      },
    });

    // Simulate hook lifecycle
    const loaded = await window.kringAPI.loadData();
    let ready = false;
    let dataLoadError = null;

    if (loaded && loaded.ok === false) {
      dataLoadError = loaded;
      // ready remains false!
    } else {
      ready = true;
    }

    // Attempt auto-save trigger
    if (canTriggerAutoSave(ready, dataLoadError)) {
      window.setTimeout(() => {
        window.kringAPI.saveData({ ...EMPTY_APP_DATA, vods: [] });
      }, 500);
    }

    vi.advanceTimersByTime(2000);

    // CRITICAL PROOF: saveData must not have been called
    expect(mockSaveData).not.toHaveBeenCalled();
    expect(ready).toBe(false);
    expect(dataLoadError).not.toBeNull();
    expect(dataLoadError.reason).toBe('corrupted');
  });

  it('proves saveData is safely called after successful loading', async () => {
    const mockSaveData = vi.fn().mockResolvedValue({ ok: true });
    const mockLoadData = vi.fn().mockResolvedValue({
      ok: true,
      vods: [{ id: 'v1', title: 'Partida Teste' }],
    });

    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      kringAPI: {
        loadData: mockLoadData,
        saveData: mockSaveData,
      },
    });

    const loaded = await window.kringAPI.loadData();
    let ready = false;
    let dataLoadError = null;
    let dataState = EMPTY_APP_DATA;

    if (loaded && loaded.ok === false) {
      dataLoadError = loaded;
    } else {
      dataState = normalizeLoadedData(loaded);
      ready = true;
    }

    if (canTriggerAutoSave(ready, dataLoadError)) {
      window.setTimeout(async () => {
        await window.kringAPI.saveData(dataState);
      }, 500);
    }

    vi.advanceTimersByTime(600);

    expect(mockSaveData).toHaveBeenCalledTimes(1);
    expect(mockSaveData).toHaveBeenCalledWith(dataState);
  });
});
