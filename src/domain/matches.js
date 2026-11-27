import { MATCH_TYPES, REVIEW_NOTE_TAGS } from '../constants/game.js';
import { formatSeconds, parseTimeToSeconds } from '../utils/formatters.js';
import { stripUtf8Bom, uid } from '../utils/string.js';
import { normalizeSide } from './stats.js';

export const MATCH_SCHEMA_VERSION = 'kring-match-v1';

/**
 * Normaliza o tipo de partida para um dos valores canônicos de MATCH_TYPES.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeMatchType(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const match = MATCH_TYPES.find(
    (t) => t.toLowerCase() === trimmed.toLowerCase()
  );
  return match || '';
}

/**
 * Indica se o nome de autor/vítima de um abate veio do OCR sem identificação real.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isGenericKillName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return true;
  return /^(aliado|inimigo|agente|jogador|unknown|desconhecido)(\s+\d+|\s*\([^)]*\))?$/i.test(
    trimmed
  );
}

function isSameKillEvent(k, ref) {
  if (!k || !ref) return false;
  if (k === ref) return true;
  return (
    (k.round ?? null) === (ref.round ?? null) &&
    (k.timestamp_sec ?? null) === (ref.timestamp_sec ?? null) &&
    String(k.time || '') === String(ref.time || '') &&
    String(k.killer || '') === String(ref.killer || '') &&
    String(k.victim || '') === String(ref.victim || '')
  );
}

function resolveAgentFromStats(playersStats, playerName) {
  if (!playersStats || typeof playersStats !== 'object' || !playerName) {
    return '';
  }
  const trimmed = String(playerName).trim();
  if (!trimmed) return '';
  const exact = playersStats[trimmed];
  if (exact && typeof exact.agent === 'string' && exact.agent !== 'Agente') {
    return exact.agent;
  }
  const lower = trimmed.toLowerCase();
  for (const [key, stat] of Object.entries(playersStats)) {
    if (
      key.trim().toLowerCase() === lower &&
      stat &&
      typeof stat.agent === 'string' &&
      stat.agent !== 'Agente'
    ) {
      return stat.agent;
    }
  }
  return '';
}

/**
 * Aplica correção manual de autor, vítima ou headshot em um abate específico,
 * sincronizando `all_kills` e `rounds[].kills` de forma imutável sem alterar `players_stats`.
 *
 * @param {Object} analysisData
 * @param {Object} killRef
 * @param {Object} updates
 * @returns {Object}
 */
export function applyKillCorrection(analysisData, killRef, updates = {}) {
  if (!analysisData || typeof analysisData !== 'object' || !killRef) {
    return analysisData;
  }

  const playersStats = analysisData.players_stats;

  const patchKill = (k) => {
    const nextKiller =
      updates.killer !== undefined && String(updates.killer).trim()
        ? String(updates.killer).trim()
        : k.killer;
    const nextVictim =
      updates.victim !== undefined && String(updates.victim).trim()
        ? String(updates.victim).trim()
        : k.victim;
    const killerChanged = nextKiller !== k.killer;
    const victimChanged = nextVictim !== k.victim;
    const nextKillerAgent = killerChanged
      ? resolveAgentFromStats(playersStats, nextKiller)
      : k.killer_agent;
    const nextVictimAgent = victimChanged
      ? resolveAgentFromStats(playersStats, nextVictim)
      : k.victim_agent;

    return {
      ...k,
      killer: nextKiller,
      victim: nextVictim,
      killer_agent: nextKillerAgent,
      victim_agent: nextVictimAgent,
      headshot:
        typeof updates.headshot === 'boolean' ? updates.headshot : k.headshot,
      manually_corrected: true,
    };
  };

  let allKillsChanged = false;
  const nextAllKills = Array.isArray(analysisData.all_kills)
    ? analysisData.all_kills.map((k) => {
        if (!allKillsChanged && isSameKillEvent(k, killRef)) {
          allKillsChanged = true;
          return patchKill(k);
        }
        return k;
      })
    : analysisData.all_kills;

  let roundKillChanged = false;
  const nextRounds = Array.isArray(analysisData.rounds)
    ? analysisData.rounds.map((r) => {
        if (roundKillChanged || !Array.isArray(r?.kills)) return r;
        const idx = r.kills.findIndex((k) => isSameKillEvent(k, killRef));
        if (idx === -1) return r;
        roundKillChanged = true;
        return {
          ...r,
          kills: r.kills.map((k, i) => (i === idx ? patchKill(k) : k)),
        };
      })
    : analysisData.rounds;

  if (!allKillsChanged && !roundKillChanged) {
    return analysisData;
  }

  return {
    ...analysisData,
    all_kills: nextAllKills,
    rounds: nextRounds,
  };
}

/**
 * Adiciona manualmente um abate na timeline (`all_kills` e na rodada correspondente)
 * mantendo `players_stats` intacto.
 *
 * @param {Object} analysisData
 * @param {Object} killInput
 * @returns {Object}
 */
export function addManualKill(analysisData, killInput = {}) {
  const base =
    analysisData && typeof analysisData === 'object' ? analysisData : {};
  const killer = String(killInput.killer || '').trim();
  const victim = String(killInput.victim || '').trim();
  if (!killer || !victim) {
    return analysisData;
  }

  const rawSec =
    killInput.timestamp_sec !== null &&
    killInput.timestamp_sec !== undefined &&
    killInput.timestamp_sec !== '' &&
    Number.isFinite(Number(killInput.timestamp_sec))
      ? Number(killInput.timestamp_sec)
      : parseTimeToSeconds(killInput.time);
  const timestampSec = Math.max(0, Math.round(rawSec * 10) / 10);
  const rawRound = Number(killInput.round);
  const round =
    Number.isFinite(rawRound) && rawRound >= 1 ? Math.floor(rawRound) : null;
  const killerTeam =
    killInput.killer_team === 'enemy' ? 'enemy' : 'friendly';
  const victimTeam =
    killInput.victim_team === 'friendly' || killInput.victim_team === 'enemy'
      ? killInput.victim_team
      : killerTeam === 'friendly'
        ? 'enemy'
        : 'friendly';

  const playersStats = base.players_stats;
  const entry = {
    round,
    time: formatSeconds(timestampSec),
    timestamp_sec: timestampSec,
    killer,
    killer_team: killerTeam,
    killer_agent: resolveAgentFromStats(playersStats, killer),
    victim,
    victim_team: victimTeam,
    victim_agent: resolveAgentFromStats(playersStats, victim),
    headshot: Boolean(killInput.headshot),
    first_kill: false,
    manually_added: true,
  };

  const sortByTime = (list) =>
    list
      .slice()
      .sort(
        (a, b) =>
          (Number(a?.timestamp_sec) || 0) - (Number(b?.timestamp_sec) || 0)
      );

  const prevAllKills = Array.isArray(base.all_kills) ? base.all_kills : [];
  const nextAllKills = sortByTime([...prevAllKills, entry]);

  const prevRounds = Array.isArray(base.rounds) ? base.rounds : [];
  const nextRounds = prevRounds.map((r) => {
    if (round !== null && r?.round_number === round) {
      const rKills = Array.isArray(r.kills) ? r.kills : [];
      return { ...r, kills: sortByTime([...rKills, entry]) };
    }
    return r;
  });

  return {
    ...base,
    all_kills: nextAllKills,
    rounds: nextRounds,
  };
}

/**
 * Remove um abate específico (p. ex. falso positivo do OCR) de `all_kills` e `rounds[].kills`,
 * preservando `players_stats` intacto.
 *
 * @param {Object} analysisData
 * @param {Object} killRef
 * @returns {Object}
 */
export function removeKillEvent(analysisData, killRef) {
  if (!analysisData || typeof analysisData !== 'object' || !killRef) {
    return analysisData;
  }

  let removedFromAll = false;
  const nextAllKills = Array.isArray(analysisData.all_kills)
    ? analysisData.all_kills.filter((k) => {
        if (!removedFromAll && isSameKillEvent(k, killRef)) {
          removedFromAll = true;
          return false;
        }
        return true;
      })
    : analysisData.all_kills;

  let removedFromRound = false;
  const nextRounds = Array.isArray(analysisData.rounds)
    ? analysisData.rounds.map((r) => {
        if (removedFromRound || !Array.isArray(r?.kills)) return r;
        const idx = r.kills.findIndex((k) => isSameKillEvent(k, killRef));
        if (idx === -1) return r;
        removedFromRound = true;
        return {
          ...r,
          kills: r.kills.filter((_, i) => i !== idx),
        };
      })
    : analysisData.rounds;

  if (!removedFromAll && !removedFromRound) {
    return analysisData;
  }

  return {
    ...analysisData,
    all_kills: nextAllKills,
    rounds: nextRounds,
  };
}

/**
 * Normaliza e ordena cronologicamente as marcações/anotações com timestamp de um review.
 *
 * @param {Array} rawNotes
 * @returns {Array}
 */
export function normalizeReviewNotes(rawNotes = []) {
  if (!Array.isArray(rawNotes)) return [];
  const validTags = new Map(
    REVIEW_NOTE_TAGS.map((t) => [t.toLowerCase(), t])
  );

  return rawNotes
    .filter((n) => n && typeof n === 'object' && String(n.text || '').trim())
    .map((n) => {
      const rawSec =
        n.timestampSec !== null &&
        n.timestampSec !== undefined &&
        n.timestampSec !== '' &&
        Number.isFinite(Number(n.timestampSec))
          ? Number(n.timestampSec)
          : parseTimeToSeconds(n.time);
      const timestampSec = Math.max(0, Math.round(rawSec * 10) / 10);
      const rawRound = Number(n.round);
      const round =
        Number.isFinite(rawRound) && rawRound >= 1 ? Math.floor(rawRound) : null;
      const rawTag = String(n.tag || '').trim();
      const tag =
        validTags.get(rawTag.toLowerCase()) || rawTag || 'Geral';

      return {
        id: (n.id && String(n.id).trim()) || uid(),
        timestampSec,
        time: formatSeconds(timestampSec),
        round,
        tag,
        text: String(n.text).trim(),
        createdAt: n.createdAt || new Date().toISOString(),
      };
    })
    .sort((a, b) => a.timestampSec - b.timestampSec);
}

/**
 * Cria o payload JSON padronizado para exportação de uma partida / scrim individual.
 * @param {Object} vod Objeto do VOD / partida armazenado na biblioteca.
 * @returns {Object} Payload serializável pronto para exportação.
 */
export function createMatchExportPayload(vod) {
  if (!vod || typeof vod !== 'object') {
    throw new Error('VOD inválido para exportação.');
  }

  const tacticalSummary =
    vod.analysisData?.tactical_summary ||
    vod.tacticalSummary ||
    vod.tactical_summary ||
    null;

  return {
    schema: MATCH_SCHEMA_VERSION,
    version: 1,
    exportedAt: new Date().toISOString(),
    match: {
      title: (vod.title || '').trim(),
      map: (vod.map || '').trim(),
      agent: (vod.agent || '').trim(),
      date: (vod.date || '').trim(),
      result: vod.result || 'Vitória',
      matchType: normalizeMatchType(vod.matchType),
      opponent: String(vod.opponent || '').trim(),
      startingSide: normalizeSide(vod.startingSide) || '',
      roundsWon: typeof vod.roundsWon === 'number' ? vod.roundsWon : null,
      roundsLost: typeof vod.roundsLost === 'number' ? vod.roundsLost : null,
      kills: Math.max(0, Number(vod.kills) || 0),
      deaths: Math.max(0, Number(vod.deaths) || 0),
      assists: Math.max(0, Number(vod.assists) || 0),
      openingDuels: Array.isArray(vod.openingDuels)
        ? vod.openingDuels.map((od) => ({
            round: String(od.round || '').trim(),
            time: String(od.time || '').trim(),
            event: od.event === 'First Death' ? 'First Death' : 'First Kill',
            player: String(od.player || '').trim(),
          }))
        : [],
      roundResults: vod.roundResults && typeof vod.roundResults === 'object'
        ? {
            Ataque: { ...(vod.roundResults.Ataque || {}) },
            Defesa: { ...(vod.roundResults.Defesa || {}) },
          }
        : { Ataque: {}, Defesa: {} },
      notes: (vod.notes || '').trim(),
      reviewNotes: normalizeReviewNotes(vod.reviewNotes),
      gamePlan: (vod.gamePlan || '').trim(),
      link: (vod.link || '').trim(),
      tacticalSummary,
      analysisData: vod.analysisData && typeof vod.analysisData === 'object'
        ? {
            ...vod.analysisData,
            tactical_summary: vod.analysisData.tactical_summary || tacticalSummary,
          }
        : null,
    },
  };
}

/**
 * Valida e converte o texto de um arquivo JSON para um objeto de partida válido.
 * Tolera tanto arquivos com schema 'kring-match-v1' quanto objetos de VOD puros.
 *
 * @param {string} rawText Conteúdo textual do arquivo importado.
 * @returns {Object} Objeto de partida validado.
 */
export function validateAndParseMatchJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('O arquivo de partida está vazio.');
  }

  let parsed;
  try {
    parsed = JSON.parse(stripUtf8Bom(rawText));
  } catch (err) {
    throw new Error(`Arquivo JSON corrompido ou inválido: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Estrutura de arquivo inválida: esperava-se um objeto JSON.');
  }

  let matchData = parsed;
  if (parsed.schema === MATCH_SCHEMA_VERSION && parsed.match && typeof parsed.match === 'object') {
    matchData = parsed.match;
  } else if (parsed.match && typeof parsed.match === 'object') {
    matchData = parsed.match;
  }

  const hasMapOrTitle = Boolean(
    (matchData.map && String(matchData.map).trim()) ||
    (matchData.title && String(matchData.title).trim())
  );
  const hasAnalysis = Boolean(
    matchData.analysisData &&
    typeof matchData.analysisData === 'object' &&
    (Array.isArray(matchData.analysisData.rounds) || Array.isArray(matchData.analysisData.all_kills))
  );

  if (!hasMapOrTitle && !hasAnalysis) {
    throw new Error('O arquivo não contém uma partida de Valorant reconhecível (ausência de mapa, título ou análise).');
  }

  return matchData;
}

/**
 * Normaliza uma partida importada e gera um registro pronto para inclusão na biblioteca local.
 * Atribui um novo identificador único (uid) para evitar sobrescrever VODs existentes.
 *
 * @param {Object} matchData Objeto de partida validado.
 * @returns {Object} Registro de VOD pronto para ser inserido em data.vods.
 */
export function createMatchImportRecord(matchData) {
  if (!matchData || typeof matchData !== 'object') {
    throw new Error('Dados de partida inválidos para importação.');
  }

  const tacticalSummary =
    matchData.tacticalSummary ||
    matchData.tactical_summary ||
    matchData.analysisData?.tactical_summary ||
    null;

  let analysisData = matchData.analysisData || null;
  if (analysisData && typeof analysisData === 'object') {
    analysisData = {
      ...analysisData,
      tactical_summary: analysisData.tactical_summary || tacticalSummary,
    };
  }

  return {
    id: uid(),
    title: (matchData.title || `Partida importada - ${matchData.map || 'Valorant'}`).trim(),
    map: (matchData.map || '').trim(),
    agent: (matchData.agent || '').trim(),
    mapId: matchData.mapId || null,
    agentId: matchData.agentId || null,
    date: (matchData.date || new Date().toISOString().split('T')[0]).trim(),
    result: matchData.result || 'Vitória',
    matchType: normalizeMatchType(matchData.matchType),
    opponent: String(matchData.opponent || '').trim(),
    startingSide: normalizeSide(matchData.startingSide) || '',
    roundsWon: typeof matchData.roundsWon === 'number' ? matchData.roundsWon : null,
    roundsLost: typeof matchData.roundsLost === 'number' ? matchData.roundsLost : null,
    kills: Math.max(0, Number(matchData.kills) || 0),
    deaths: Math.max(0, Number(matchData.deaths) || 0),
    assists: Math.max(0, Number(matchData.assists) || 0),
    openingDuels: Array.isArray(matchData.openingDuels) ? matchData.openingDuels : [],
    roundResults: matchData.roundResults || { Ataque: {}, Defesa: {} },
    notes: (matchData.notes || '').trim(),
    reviewNotes: normalizeReviewNotes(matchData.reviewNotes),
    gamePlan: (matchData.gamePlan || '').trim(),
    link: (matchData.link || '').trim(),
    tacticalSummary,
    analysisData,
    importedAt: new Date().toISOString(),
  };
}

/**
 * Gera um nome de arquivo seguro e descritivo para download da partida.
 * @param {Object} vod
 * @returns {string} Nome de arquivo formatado (ex: "kring-match-ascent-2026-11-01.json").
 */
export function getMatchExportFilename(vod) {
  const mapSlug = (vod?.map || 'scrim')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-');
  const dateStr = vod?.date || new Date().toISOString().split('T')[0];
  return `kring-match-${mapSlug}-${dateStr}.json`;
}
