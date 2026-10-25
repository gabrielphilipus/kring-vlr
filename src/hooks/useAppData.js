import { useEffect, useState } from 'react';
import {
  cascadeRenameCatalogItem,
  isCatalogItemInUse,
  toggleAgentActive,
  toggleMapActive,
} from '../domain/catalog.js';
import { unlinkGameplanFromVods } from '../domain/gameplans.js';
import {
  toggleTrainingItem,
  toggleTrainingWeekItems,
} from '../domain/training.js';

export const EMPTY_APP_DATA = {
  vods: [],
  lineups: [],
  tactics: [],
  training: [],
  gameplans: [],
  maps: [],
  agents: [],
};

/**
 * Normaliza os dados carregados aplicando defaults e garantindo arrays válidos.
 * Função pura e idempotente.
 */
export function normalizeLoadedData(loaded, seed = { maps: [], agents: [] }) {
  if (!loaded || typeof loaded !== 'object') {
    return {
      ...EMPTY_APP_DATA,
      maps: Array.isArray(seed.maps) ? seed.maps : [],
      agents: Array.isArray(seed.agents) ? seed.agents : [],
    };
  }

  return {
    vods: Array.isArray(loaded.vods) ? loaded.vods : [],
    lineups: Array.isArray(loaded.lineups) ? loaded.lineups : [],
    tactics: Array.isArray(loaded.tactics)
      ? loaded.tactics.map((item) => ({
          ...item,
          category:
            item.category === 'Roubo de ultimate'
              ? 'Rounds de ultimate'
              : item.category,
        }))
      : [],
    training: Array.isArray(loaded.training) ? loaded.training : [],
    gameplans: Array.isArray(loaded.gameplans) ? loaded.gameplans : [],
    maps: Array.isArray(loaded.maps)
      ? loaded.maps
      : Array.isArray(seed.maps)
        ? seed.maps
        : [],
    agents: Array.isArray(loaded.agents)
      ? loaded.agents
      : Array.isArray(seed.agents)
        ? seed.agents
        : [],
  };
}

/**
 * Avalia se o salvamento automático deve ser disparado.
 * Retorna true apenas quando os dados foram carregados com sucesso e não há erro crítico.
 */
export function canTriggerAutoSave(ready, dataLoadError) {
  return Boolean(ready && !dataLoadError);
}

/**
 * Hook customizado para centralizar a gestão do estado global de dados,
 * ciclo de carregamento, bloqueio de auto-save em falhas e mutações puras.
 *
 * @param {Object} options
 * @param {(msg: string) => void} [options.onToast]
 * @returns {Object}
 */
export function useAppData({ onToast } = {}) {
  const [data, setData] = useState(EMPTY_APP_DATA);
  const [ready, setReady] = useState(false);
  const [dataLoadError, setDataLoadError] = useState(null);

  // 1. Carregamento inicial com proteção contra corrupção
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        let loaded;
        if (window.kringAPI?.loadData) {
          loaded = await window.kringAPI.loadData();
        } else {
          const raw = localStorage.getItem('kring-vlr-data');
          loaded = raw ? JSON.parse(raw) : EMPTY_APP_DATA;
        }

        if (!active) return;

        // Se o carregamento retornar falha crítica de corrupção ou incompatibilidade de versão:
        if (loaded && loaded.ok === false) {
          console.error('[useAppData] Falha crítica de integridade:', loaded);
          setDataLoadError(loaded);
          if (onToast) {
            if (loaded.reason === 'unsupported-version') {
              onToast(
                `⚠️ Versão de dados incompatível (schemaVersion ${loaded.currentVersion}). Atualize o aplicativo.`
              );
            } else {
              onToast(
                '⚠️ ATENÇÃO: Arquivo de dados corrompido! O salvamento automático foi BLOQUEADO para proteger seus dados.'
              );
            }
          }
          // Bloqueia setReady(true) impedindo qualquer auto-save
          return;
        }

        if (loaded?.migratedV4 && onToast) {
          onToast(
            '🛡️ Seus dados foram atualizados com sucesso para o formato v4 (cópia de segurança preservada).'
          );
        } else if (loaded?.recoveredFromBackup && onToast) {
          const src = loaded.backupSource ? ` (${loaded.backupSource})` : '';
          onToast(
            `🛡️ AVISO: Dados restaurados com sucesso a partir da cópia de segurança${src}.`
          );
        }

        let seed = { maps: [], agents: [] };
        if (!Array.isArray(loaded?.maps) || !Array.isArray(loaded?.agents)) {
          try {
            const response = await fetch('./catalogs.json');
            if (response.ok) seed = await response.json();
          } catch {
            // Fallback seguro se catalogs.json estiver ausente
          }
        }

        setData(normalizeLoadedData(loaded, seed));
        setReady(true);
      } catch (error) {
        console.error(error);
        if (active && onToast) {
          onToast('Não foi possível carregar os dados salvos.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [onToast]);

  // 2. Salvamento automático com debounce de 500ms
  useEffect(() => {
    if (!canTriggerAutoSave(ready, dataLoadError)) return undefined;

    const timer = window.setTimeout(async () => {
      try {
        if (window.kringAPI?.saveData) {
          await window.kringAPI.saveData(data);
        } else {
          localStorage.setItem('kring-vlr-data', JSON.stringify(data));
        }
      } catch (error) {
        console.error(error);
        if (onToast) {
          onToast(
            'Falha ao salvar. Faça uma cópia de segurança dos seus dados.'
          );
        }
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [ready, dataLoadError, data, onToast]);

  // 3. Ações de modificação do estado (usando sempre setData(prev => ...) sem closure de data)
  const startFromScratch = () => {
    setDataLoadError(null);
    setData((previous) => ({
      vods: [],
      lineups: [],
      tactics: [],
      training: [],
      gameplans: [],
      maps: previous.maps?.length ? previous.maps : [],
      agents: previous.agents?.length ? previous.agents : [],
    }));
    setReady(true);
  };

  const saveVod = (record, editingId) => {
    setData((prev) => ({
      ...prev,
      vods: editingId
        ? prev.vods.map((v) => (v.id === editingId ? record : v))
        : [record, ...prev.vods],
    }));
  };

  const saveLineup = (record, editingId) => {
    setData((prev) => ({
      ...prev,
      lineups: editingId
        ? prev.lineups.map((l) => (l.id === editingId ? record : l))
        : [record, ...prev.lineups],
    }));
  };

  const saveTactic = (record, editingId) => {
    setData((prev) => ({
      ...prev,
      tactics: editingId
        ? prev.tactics.map((t) => (t.id === editingId ? record : t))
        : [record, ...prev.tactics],
    }));
  };

  const saveTraining = (record, editingId) => {
    setData((prev) => ({
      ...prev,
      training: editingId
        ? prev.training.map((t) => (t.id === editingId ? record : t))
        : [record, ...prev.training],
    }));
  };

  const saveGameplan = (record, editingId) => {
    setData((prev) => ({
      ...prev,
      gameplans: editingId
        ? prev.gameplans.map((p) => (p.id === editingId ? record : p))
        : [record, ...prev.gameplans],
    }));
  };

  const saveCatalogItem = ({ isAgent, record, oldName, editingId }) => {
    setData((previous) => {
      const collection = isAgent ? 'agents' : 'maps';
      const updatedList = editingId
        ? previous[collection].map((item) =>
            item.id === editingId ? record : item
          )
        : [record, ...previous[collection]];

      const nextData = {
        ...previous,
        [collection]: updatedList,
      };

      if (oldName && oldName !== record.name) {
        return cascadeRenameCatalogItem(nextData, {
          isAgent,
          oldName,
          record,
        });
      }

      return nextData;
    });
  };

  const removeEntry = (kind, id) => {
    if (kind === 'gameplan') {
      setData((prev) => ({
        ...prev,
        gameplans: prev.gameplans.filter((plan) => plan.id !== id),
        vods: unlinkGameplanFromVods(prev.vods, id),
      }));
      return;
    }

    if (kind === 'catalogMap' || kind === 'catalogAgent') {
      const isMap = kind === 'catalogMap';
      const collection = isMap ? 'maps' : 'agents';
      setData((prev) => ({
        ...prev,
        [collection]: prev[collection].filter((item) => item.id !== id),
      }));
      return;
    }

    const key = {
      vod: 'vods',
      lineup: 'lineups',
      tactic: 'tactics',
      training: 'training',
    }[kind];

    if (key) {
      setData((prev) => ({
        ...prev,
        [key]: prev[key].filter((entry) => entry.id !== id),
      }));
    }
  };

  const toggleMap = (id) => {
    setData((prev) => ({
      ...prev,
      maps: toggleMapActive(prev.maps, id),
    }));
  };

  const toggleAgent = (id) => {
    setData((prev) => ({
      ...prev,
      agents: toggleAgentActive(prev.agents, id),
    }));
  };

  const toggleTraining = (id) => {
    setData((prev) => ({
      ...prev,
      training: toggleTrainingItem(prev.training, id),
    }));
  };

  const toggleTrainingWeek = (weekItems, markDone) => {
    setData((prev) => ({
      ...prev,
      training: toggleTrainingWeekItems(prev.training, weekItems, markDone),
    }));
  };

  const importBackupData = (parsed) => {
    setData((previous) => ({
      ...previous,
      vods: Array.isArray(parsed.vods) ? parsed.vods : [],
      lineups: Array.isArray(parsed.lineups) ? parsed.lineups : [],
      tactics: Array.isArray(parsed.tactics)
        ? parsed.tactics.map((item) => ({
            ...item,
            category:
              item.category === 'Roubo de ultimate'
                ? 'Rounds de ultimate'
                : item.category,
          }))
        : [],
      training: Array.isArray(parsed.training) ? parsed.training : [],
      gameplans: Array.isArray(parsed.gameplans) ? parsed.gameplans : [],
      maps: Array.isArray(parsed.maps) ? parsed.maps : previous.maps,
      agents: Array.isArray(parsed.agents) ? parsed.agents : previous.agents,
    }));
  };

  const importDefaultsTactics = (imported) => {
    setData((previous) => ({
      ...previous,
      tactics: [
        ...previous.tactics.filter((item) => item.category !== 'Default'),
        ...imported,
      ],
    }));
  };

  const restoreCatalogDefaults = (seed) => {
    if (!seed || !Array.isArray(seed.maps) || !Array.isArray(seed.agents))
      return;

    setData((previous) => {
      const existingMapIds = new Set(
        previous.maps.map((m) => (m.id || '').toLowerCase())
      );
      const existingMapNames = new Set(
        previous.maps.map((m) => (m.name || '').toLowerCase())
      );
      const newMaps = seed.maps.filter(
        (m) =>
          !existingMapIds.has((m.id || '').toLowerCase()) &&
          !existingMapNames.has((m.name || '').toLowerCase())
      );

      const existingAgentIds = new Set(
        previous.agents.map((a) => (a.id || '').toLowerCase())
      );
      const existingAgentNames = new Set(
        previous.agents.map((a) => (a.name || '').toLowerCase())
      );
      const newAgents = seed.agents.filter(
        (a) =>
          !existingAgentIds.has((a.id || '').toLowerCase()) &&
          !existingAgentNames.has((a.name || '').toLowerCase())
      );

      return {
        ...previous,
        maps: [...previous.maps, ...newMaps],
        agents: [...previous.agents, ...newAgents],
      };
    });
  };

  return {
    data,
    setData,
    ready,
    dataLoadError,
    startFromScratch,
    saveVod,
    saveLineup,
    saveTactic,
    saveTraining,
    saveGameplan,
    saveCatalogItem,
    removeEntry,
    toggleMap,
    toggleAgent,
    toggleTraining,
    toggleTrainingWeek,
    importBackupData,
    importDefaultsTactics,
    restoreCatalogDefaults,
    isCatalogItemInUse: (target) => isCatalogItemInUse(data, target),
  };
}
