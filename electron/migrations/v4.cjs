const crypto = require('node:crypto');

const DEFAULT_SUPPORTED_SCHEMA_VERSION = 4;

/**
 * Normaliza strings para comparação insensível a caixa e acentuação.
 * Ex.: "KAY/O" -> "kay/o", "Ascent" -> "ascent", "Mecânica" -> "mecanica"
 */
function normalizeName(str) {
  if (typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Converte valor numérico flexível para number ou null.
 * Regra estrita: string vazia ou não numérica => null (Number('') é 0); null permanece null.
 */
function parseNullableNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Converte valor inteiro com fallback || 0 (mesmo padrão do app para kills/deaths/assists).
 */
function parseCounterNumber(val) {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

/**
 * Função pura de migração para o schema v4.
 *
 * @param {Object} rawData - Conteúdo JSON bruto carregado.
 * @param {Object} [options]
 * @param {() => string} [options.idGenerator] - Gerador de ID customizado (para testes determinísticos).
 * @param {{ maps?: Array, agents?: Array }} [options.catalogs] - Catálogo de referência para mapeamento de IDs.
 * @returns {{ migrated: Object, stats: Object }}
 */
function migrateV3ToV4(rawData, options = {}) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new Error(
      'Dados de entrada inválidos para migração (deve ser um objeto JSON).'
    );
  }

  const currentVersion = rawData.schemaVersion;
  if (
    typeof currentVersion === 'number' &&
    currentVersion > DEFAULT_SUPPORTED_SCHEMA_VERSION
  ) {
    throw new Error(
      `Versão de dados incompatível: o arquivo possui schemaVersion ${currentVersion}, mas este aplicativo suporta até a versão ${DEFAULT_SUPPORTED_SCHEMA_VERSION}.`
    );
  }

  const generateId =
    typeof options.idGenerator === 'function'
      ? options.idGenerator
      : () => crypto.randomUUID();

  const catalogs = options.catalogs || {};
  const mapsCatalog = Array.isArray(catalogs.maps) ? catalogs.maps : [];
  const agentsCatalog = Array.isArray(catalogs.agents) ? catalogs.agents : [];

  const stats = {
    schemaVersionBefore: currentVersion || 'legacy (sem versão)',
    schemaVersionAfter: DEFAULT_SUPPORTED_SCHEMA_VERSION,
    fieldsConverted: 0,
    idsGenerated: 0,
    linksPopulated: 0,
    countsBefore: {
      vods: Array.isArray(rawData.vods) ? rawData.vods.length : 0,
      lineups: Array.isArray(rawData.lineups) ? rawData.lineups.length : 0,
      tactics: Array.isArray(rawData.tactics) ? rawData.tactics.length : 0,
      training: Array.isArray(rawData.training) ? rawData.training.length : 0,
      gameplans: Array.isArray(rawData.gameplans)
        ? rawData.gameplans.length
        : 0,
      maps: Array.isArray(rawData.maps) ? rawData.maps.length : 0,
      agents: Array.isArray(rawData.agents) ? rawData.agents.length : 0,
    },
    countsAfter: {},
  };

  const unlinkedMaps = new Set();
  const unlinkedAgents = new Set();

  // Helper para resolver mapId
  function resolveMapId(item) {
    if (item.mapId) return item.mapId;
    if (!item.map || !mapsCatalog.length) {
      if (item.map) unlinkedMaps.add(item.map);
      return null;
    }
    const targetNorm = normalizeName(item.map);
    const found = mapsCatalog.find((m) => normalizeName(m.name) === targetNorm);
    if (found && found.id) {
      stats.linksPopulated += 1;
      return found.id;
    }
    unlinkedMaps.add(item.map);
    return null;
  }

  // Helper para resolver agentId
  function resolveAgentId(item) {
    if (item.agentId) return item.agentId;
    if (!item.agent || !agentsCatalog.length) {
      if (item.agent) unlinkedAgents.add(item.agent);
      return null;
    }
    const targetNorm = normalizeName(item.agent);
    const found = agentsCatalog.find(
      (a) => normalizeName(a.name) === targetNorm
    );
    if (found && found.id) {
      stats.linksPopulated += 1;
      return found.id;
    }
    unlinkedAgents.add(item.agent);
    return null;
  }

  // 1. Clonagem rasa das propriedades de topo para preservar campos desconhecidos
  const migrated = { ...rawData };

  // 2. VODs
  migrated.vods = (Array.isArray(rawData.vods) ? rawData.vods : []).map(
    (rawVod) => {
      const item = { ...rawVod };

      if (!item.id) {
        item.id = generateId();
        stats.idsGenerated += 1;
      }

      // roundsWon / roundsLost
      const convertedWon = parseNullableNumber(item.roundsWon);
      if (convertedWon !== item.roundsWon) {
        stats.fieldsConverted += 1;
        item.roundsWon = convertedWon;
      }

      const convertedLost = parseNullableNumber(item.roundsLost);
      if (convertedLost !== item.roundsLost) {
        stats.fieldsConverted += 1;
        item.roundsLost = convertedLost;
      }

      // kills, deaths, assists
      const convKills = parseCounterNumber(item.kills);
      if (convKills !== item.kills) {
        stats.fieldsConverted += 1;
        item.kills = convKills;
      }

      const convDeaths = parseCounterNumber(item.deaths);
      if (convDeaths !== item.deaths) {
        stats.fieldsConverted += 1;
        item.deaths = convDeaths;
      }

      const convAssists = parseCounterNumber(item.assists);
      if (convAssists !== item.assists) {
        stats.fieldsConverted += 1;
        item.assists = convAssists;
      }

      // Resolução de mapId e agentId
      item.mapId = resolveMapId(item);
      item.agentId = resolveAgentId(item);

      return item;
    }
  );

  // 3. Lineups
  migrated.lineups = (
    Array.isArray(rawData.lineups) ? rawData.lineups : []
  ).map((rawLineup) => {
    const item = { ...rawLineup };

    if (!item.id) {
      item.id = generateId();
      stats.idsGenerated += 1;
    }

    item.mapId = resolveMapId(item);
    item.agentId = resolveAgentId(item);

    return item;
  });

  // 4. Tactics
  migrated.tactics = (
    Array.isArray(rawData.tactics) ? rawData.tactics : []
  ).map((rawTactic) => {
    const item = { ...rawTactic };

    if (!item.id) {
      item.id = generateId();
      stats.idsGenerated += 1;
    }

    if (item.category === 'Roubo de ultimate') {
      item.category = 'Rounds de ultimate';
      stats.fieldsConverted += 1;
    }

    item.mapId = resolveMapId(item);

    return item;
  });

  // 5. Training
  migrated.training = (
    Array.isArray(rawData.training) ? rawData.training : []
  ).map((rawTraining) => {
    const item = { ...rawTraining };

    if (!item.id) {
      item.id = generateId();
      stats.idsGenerated += 1;
    }

    // minutes: number or null, sem arredondar decimais
    const convMin = parseNullableNumber(item.minutes);
    if (convMin !== item.minutes) {
      stats.fieldsConverted += 1;
      item.minutes = convMin;
    }

    // done: boolean
    const convDone = Boolean(item.done);
    if (convDone !== item.done) {
      stats.fieldsConverted += 1;
      item.done = convDone;
    }

    return item;
  });

  // 6. Gameplans
  migrated.gameplans = (
    Array.isArray(rawData.gameplans) ? rawData.gameplans : []
  ).map((rawPlan) => {
    const item = { ...rawPlan };

    if (!item.id) {
      item.id = generateId();
      stats.idsGenerated += 1;
    }

    item.mapId = resolveMapId(item);

    return item;
  });

  // 7. Maps
  migrated.maps = (Array.isArray(rawData.maps) ? rawData.maps : []).map(
    (rawMap) => {
      const item = { ...rawMap };
      if (!item.id) {
        item.id = generateId();
        stats.idsGenerated += 1;
      }
      if (typeof item.competitiveActive !== 'boolean') {
        item.competitiveActive = item.competitiveActive !== false;
        stats.fieldsConverted += 1;
      }
      return item;
    }
  );

  // 8. Agents
  migrated.agents = (Array.isArray(rawData.agents) ? rawData.agents : []).map(
    (rawAgent) => {
      const item = { ...rawAgent };
      if (!item.id) {
        item.id = generateId();
        stats.idsGenerated += 1;
      }
      if (typeof item.active !== 'boolean') {
        item.active = item.active !== false;
        stats.fieldsConverted += 1;
      }
      return item;
    }
  );

  // Atualização da versão do schema
  migrated.schemaVersion = DEFAULT_SUPPORTED_SCHEMA_VERSION;

  stats.countsAfter = {
    vods: migrated.vods.length,
    lineups: migrated.lineups.length,
    tactics: migrated.tactics.length,
    training: migrated.training.length,
    gameplans: migrated.gameplans.length,
    maps: migrated.maps.length,
    agents: migrated.agents.length,
  };

  stats.unlinkedMaps = Array.from(unlinkedMaps);
  stats.unlinkedAgents = Array.from(unlinkedAgents);

  return {
    migrated,
    stats,
  };
}

module.exports = {
  migrateV3ToV4,
  normalizeName,
  parseNullableNumber,
  parseCounterNumber,
  DEFAULT_SUPPORTED_SCHEMA_VERSION,
};
