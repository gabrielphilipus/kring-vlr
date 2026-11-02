import { stripUtf8Bom, uid } from '../utils/string.js';

export const MATCH_SCHEMA_VERSION = 'kring-match-v1';

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
    roundsWon: typeof matchData.roundsWon === 'number' ? matchData.roundsWon : null,
    roundsLost: typeof matchData.roundsLost === 'number' ? matchData.roundsLost : null,
    kills: Math.max(0, Number(matchData.kills) || 0),
    deaths: Math.max(0, Number(matchData.deaths) || 0),
    assists: Math.max(0, Number(matchData.assists) || 0),
    openingDuels: Array.isArray(matchData.openingDuels) ? matchData.openingDuels : [],
    roundResults: matchData.roundResults || { Ataque: {}, Defesa: {} },
    notes: (matchData.notes || '').trim(),
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
