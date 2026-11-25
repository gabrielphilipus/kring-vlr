import { toLocalDateString } from '../utils/formatters.js';
import { cleanNick } from '../utils/string.js';

export function calcStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const wins = list.filter((r) => r.result === 'Vitória').length;
  const losses = list.filter((r) => r.result === 'Derrota').length;
  const draws = list.filter((r) => r.result === 'Empate').length;
  const decisions = wins + losses;
  const kills = list.reduce((sum, r) => sum + (Number(r.kills) || 0), 0);
  const deaths = list.reduce((sum, r) => sum + (Number(r.deaths) || 0), 0);
  const assists = list.reduce((sum, r) => sum + (Number(r.assists) || 0), 0);
  const kdRows = list.filter((r) => Number(r.deaths) > 0);
  const avgKD = kdRows.length
    ? kdRows.reduce(
        (sum, r) => sum + (Number(r.kills) || 0) / Number(r.deaths),
        0
      ) / kdRows.length
    : 0;
  return {
    wins,
    losses,
    draws,
    matches: list.length,
    decisions,
    kills,
    deaths,
    assists,
    avgKD,
    kdMatches: kdRows.length,
    winrate: decisions ? (wins / decisions) * 100 : 0,
    avgKills: list.length ? kills / list.length : 0,
  };
}

export function groupStats(rows = [], getKey) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  list.forEach((row) => {
    const key = getKey(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Array.from(groups.entries())
    .map(([name, groupList]) => ({ name, ...calcStats(groupList) }))
    .sort((a, b) => b.matches - a.matches || b.winrate - a.winrate);
}

export function filterVodsByPeriod(
  vods = [],
  period = 'all',
  now = new Date()
) {
  if (!Array.isArray(vods)) return [];
  if (!period || period === 'all') return vods;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const cutoffDate = new Date(now.getTime() - days * 86400000);
  const cutoff = toLocalDateString(cutoffDate);
  return vods.filter((v) => (v.date || '') >= cutoff);
}

export function calcRoundBalance(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let won = 0;
  let lost = 0;
  let matchesWithRounds = 0;

  list.forEach((vod) => {
    if (
      Number.isFinite(Number(vod.roundsWon)) &&
      Number.isFinite(Number(vod.roundsLost)) &&
      vod.roundsWon != null &&
      vod.roundsLost != null
    ) {
      won += Number(vod.roundsWon);
      lost += Number(vod.roundsLost);
      matchesWithRounds++;
    }
  });

  const diff = won - lost;
  return { won, lost, diff, matchesWithRounds };
}

export function normalizeSide(side) {
  if (typeof side !== 'string') return null;
  const s = side.trim().toLowerCase();
  if (s === 'attack' || s === 'ataque') return 'Ataque';
  if (s === 'defense' || s === 'defesa') return 'Defesa';
  return null;
}

export function inferRoundSide(roundNumber, startingSide) {
  const start = normalizeSide(startingSide);
  const num = Number(roundNumber);
  if (!start || !Number.isFinite(num) || num < 1) return null;
  const r = Math.floor(num);
  const other = start === 'Ataque' ? 'Defesa' : 'Ataque';
  if (r <= 12) return start;
  if (r <= 24) return other;
  return (r - 25) % 2 === 0 ? start : other;
}

export function calcSideStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let atkWon = 0;
  let atkLost = 0;
  let defWon = 0;
  let defLost = 0;
  let pistolWon = 0;
  let pistolPlayed = 0;

  const isWinVal = (res) => res === 'Vitória' || res === 'Ganhamos';
  const isLossVal = (res) => res === 'Derrota' || res === 'Perdemos';

  list.forEach((vod) => {
    const atk = vod?.roundResults?.Ataque || {};
    const def = vod?.roundResults?.Defesa || {};
    const hasManualRounds =
      Object.values(atk).some(Boolean) || Object.values(def).some(Boolean);

    if (hasManualRounds) {
      Object.entries(atk).forEach(([roundType, res]) => {
        if (isWinVal(res)) atkWon++;
        else if (isLossVal(res)) atkLost++;
        if (roundType.toLowerCase().includes('pistol')) {
          pistolPlayed++;
          if (isWinVal(res)) pistolWon++;
        }
      });
      Object.entries(def).forEach(([roundType, res]) => {
        if (isWinVal(res)) defWon++;
        else if (isLossVal(res)) defLost++;
        if (roundType.toLowerCase().includes('pistol')) {
          pistolPlayed++;
          if (isWinVal(res)) pistolWon++;
        }
      });
    } else if (Array.isArray(vod?.analysisData?.rounds)) {
      const vodStartSide = normalizeSide(vod?.startingSide);
      vod.analysisData.rounds.forEach((r) => {
        const isFriendly = r.winner === 'friendly';
        const side =
          normalizeSide(r.side) || inferRoundSide(r.round_number, vodStartSide);
        if (side === 'Ataque') {
          if (isFriendly) atkWon++;
          else atkLost++;
        } else if (side === 'Defesa') {
          if (isFriendly) defWon++;
          else defLost++;
        }
        if (r.round_number === 1 || r.round_number === 13) {
          pistolPlayed++;
          if (isFriendly) pistolWon++;
        }
      });
    }
  });

  const atkTotal = atkWon + atkLost;
  const defTotal = defWon + defLost;
  const atkWR = atkTotal ? (atkWon / atkTotal) * 100 : null;
  const defWR = defTotal ? (defWon / defTotal) * 100 : null;
  const pistolWR = pistolPlayed ? (pistolWon / pistolPlayed) * 100 : null;

  return {
    atkWon,
    atkLost,
    atkTotal,
    atkWR,
    defWon,
    defLost,
    defTotal,
    defWR,
    pistolWon,
    pistolPlayed,
    pistolWR,
  };
}

export function calcOpeningDuelStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let fk = 0;
  let fd = 0;

  list.forEach((vod) => {
    const hasManualDuels =
      Array.isArray(vod?.openingDuels) && vod.openingDuels.length > 0;

    if (hasManualDuels) {
      vod.openingDuels.forEach((d) => {
        if (d.event === 'First Kill') fk++;
        else if (d.event === 'First Death') fd++;
      });
    } else if (Array.isArray(vod?.analysisData?.all_kills)) {
      vod.analysisData.all_kills.forEach((k) => {
        if (k.first_kill) {
          if (k.killer_team === 'friendly') fk++;
          else fd++;
        }
      });
    }
  });

  const total = fk + fd;
  const diff = fk - fd;
  const fkRate = total ? (fk / total) * 100 : null;

  return { fk, fd, total, diff, fkRate };
}

export function sortCrossStats(
  cross = [],
  crossSort = { key: 'winrate', dir: 'desc' }
) {
  if (!Array.isArray(cross)) return [];
  return [...cross].sort((a, b) => {
    let comp = 0;
    if (crossSort.key === 'name')
      comp = (a.name || '').localeCompare(b.name || '');
    else if (crossSort.key === 'matches')
      comp = (a.matches || 0) - (b.matches || 0);
    else if (crossSort.key === 'wins') comp = (a.wins || 0) - (b.wins || 0);
    else if (crossSort.key === 'losses')
      comp = (a.losses || 0) - (b.losses || 0);
    else if (crossSort.key === 'draws') comp = (a.draws || 0) - (b.draws || 0);
    else if (crossSort.key === 'winrate')
      comp = (a.winrate || 0) - (b.winrate || 0);
    return crossSort.dir === 'desc' ? -comp : comp;
  });
}

export function getBestMap(mapsStats = []) {
  if (!Array.isArray(mapsStats)) return null;
  return (
    mapsStats
      .filter((s) => s.decisions > 0)
      .slice()
      .sort((a, b) => b.winrate - a.winrate || b.decisions - a.decisions)[0] ||
    null
  );
}

export function getWorstMap(mapsStats = []) {
  if (!Array.isArray(mapsStats)) return null;
  return (
    mapsStats
      .filter((s) => s.decisions > 0)
      .slice()
      .sort((a, b) => a.winrate - b.winrate || a.decisions - b.decisions)[0] ||
    null
  );
}

export function getBestAgent(agentsStats = []) {
  if (!Array.isArray(agentsStats)) return null;
  return (
    agentsStats
      .filter((a) => a.decisions > 0)
      .slice()
      .sort((a, b) => b.winrate - a.winrate || b.decisions - a.decisions)[0] ||
    null
  );
}

const GENERIC_PLAYER_KEYS = new Set(['aliado', 'inimigo', 'agente', 'jogador']);

export function calcTacticalAggregateStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let matchesWithTactics = 0;
  let fbWon = 0;
  let fbTotal = 0;
  let recoveryWon = 0;
  let recoveryTotal = 0;
  let tradedDeaths = 0;
  let totalDeaths = 0;
  let clutchesWon = 0;
  const clutchesByLabel = {};
  const clutches = [];
  let kastSum = 0;
  let kastSamples = 0;

  const playersMap = new Map();
  const byMapAccum = new Map();

  list.forEach((vod) => {
    const tactical =
      vod?.analysisData?.tactical_summary ||
      vod?.tacticalSummary ||
      vod?.tactical_summary ||
      null;
    if (!tactical || typeof tactical !== 'object') return;

    matchesWithTactics += 1;

    const fb = tactical.first_blood_conversion?.friendly;
    const mFbWon = Number(fb?.fb_rounds_won) || 0;
    const mFbTotal = Number(fb?.fb_rounds_total) || 0;
    fbWon += mFbWon;
    fbTotal += mFbTotal;

    const rec = tactical.man_disadvantage_recovery?.friendly;
    const mRecWon = Number(rec?.recovery_rounds_won) || 0;
    const mRecTotal = Number(rec?.recovery_rounds_total) || 0;
    recoveryWon += mRecWon;
    recoveryTotal += mRecTotal;

    const trade = tactical.team_trade_efficiency?.friendly;
    const mTraded = Number(trade?.traded_deaths) || 0;
    const mDeaths = Number(trade?.total_deaths) || 0;
    tradedDeaths += mTraded;
    totalDeaths += mDeaths;

    const vodClutches = Array.isArray(tactical.clutches)
      ? tactical.clutches.filter((c) => c && c.team === 'friendly')
      : [];
    clutchesWon += vodClutches.length;
    vodClutches.forEach((c) => {
      const label = c.label || `1v${c.vs_count || 1}`;
      clutchesByLabel[label] = (clutchesByLabel[label] || 0) + 1;
      clutches.push({
        map: vod.map || '',
        date: vod.date || '',
        round: c.round,
        label,
        player: c.player || '',
      });
    });

    // Lookup scoreboard stats by normalized nick for kills/deaths/assists enrichment
    const sbLookup = new Map();
    const rawSb = vod?.analysisData?.players_stats;
    if (rawSb && typeof rawSb === 'object') {
      Object.entries(rawSb).forEach(([sbName, sbVal]) => {
        const key = cleanNick(sbName);
        if (key && sbVal && typeof sbVal === 'object') {
          sbLookup.set(key, sbVal);
        }
      });
    }

    let mapKastSum = 0;
    let mapKastSamples = 0;

    const rawPlayerTact = tactical.player_tactical_stats;
    if (rawPlayerTact && typeof rawPlayerTact === 'object') {
      Object.entries(rawPlayerTact).forEach(([pName, pStats]) => {
        if (!pStats || typeof pStats !== 'object') return;
        if (pStats.team !== 'friendly') return;
        const key = cleanNick(pStats.player || pName);
        if (!key || GENERIC_PLAYER_KEYS.has(key)) return;

        const kastVal = Number(pStats.kast_pct);
        const hasKast =
          pStats.kast_pct !== null &&
          pStats.kast_pct !== undefined &&
          Number.isFinite(kastVal);
        if (hasKast) {
          kastSum += kastVal;
          kastSamples += 1;
          mapKastSum += kastVal;
          mapKastSamples += 1;
        }

        if (!playersMap.has(key)) {
          playersMap.set(key, {
            name: (pStats.player || pName).trim(),
            matches: 0,
            kastSum: 0,
            kastSamples: 0,
            tradeKills: 0,
            tradedDeaths: 0,
            untradedDeaths: 0,
            clutchesWon: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
          });
        }

        const acc = playersMap.get(key);
        acc.matches += 1;
        if (hasKast) {
          acc.kastSum += kastVal;
          acc.kastSamples += 1;
        }
        acc.tradeKills += Number(pStats.trade_kills) || 0;
        acc.tradedDeaths += Number(pStats.traded_deaths) || 0;
        acc.untradedDeaths += Number(pStats.untraded_deaths) || 0;
        acc.clutchesWon += Number(pStats.clutches_won) || 0;

        const sb = sbLookup.get(key);
        if (sb && sb.team === 'friendly') {
          acc.kills += Number(sb.kills) || 0;
          acc.deaths += Number(sb.deaths) || 0;
          acc.assists += Number(sb.assists) || 0;
        }
      });
    }

    const mapName = (vod?.map || '').trim();
    if (mapName) {
      if (!byMapAccum.has(mapName)) {
        byMapAccum.set(mapName, {
          map: mapName,
          matches: 0,
          fbWon: 0,
          fbTotal: 0,
          recoveryWon: 0,
          recoveryTotal: 0,
          tradedDeaths: 0,
          totalDeaths: 0,
          clutchesWon: 0,
          kastSum: 0,
          kastSamples: 0,
        });
      }
      const mAcc = byMapAccum.get(mapName);
      mAcc.matches += 1;
      mAcc.fbWon += mFbWon;
      mAcc.fbTotal += mFbTotal;
      mAcc.recoveryWon += mRecWon;
      mAcc.recoveryTotal += mRecTotal;
      mAcc.tradedDeaths += mTraded;
      mAcc.totalDeaths += mDeaths;
      mAcc.clutchesWon += vodClutches.length;
      mAcc.kastSum += mapKastSum;
      mAcc.kastSamples += mapKastSamples;
    }
  });

  const players = Array.from(playersMap.values())
    .map((p) => ({
      name: p.name,
      matches: p.matches,
      avgKast: p.kastSamples ? p.kastSum / p.kastSamples : null,
      tradeKills: p.tradeKills,
      tradedDeaths: p.tradedDeaths,
      untradedDeaths: p.untradedDeaths,
      clutchesWon: p.clutchesWon,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      kdRatio: p.deaths > 0 ? p.kills / p.deaths : p.kills,
    }))
    .sort(
      (a, b) =>
        b.matches - a.matches || (b.avgKast ?? -1) - (a.avgKast ?? -1)
    );

  const byMap = Array.from(byMapAccum.values())
    .map((m) => ({
      map: m.map,
      matches: m.matches,
      fbWon: m.fbWon,
      fbTotal: m.fbTotal,
      fbConversionRate: m.fbTotal > 0 ? (m.fbWon / m.fbTotal) * 100 : null,
      recoveryWon: m.recoveryWon,
      recoveryTotal: m.recoveryTotal,
      recoveryRate:
        m.recoveryTotal > 0 ? (m.recoveryWon / m.recoveryTotal) * 100 : null,
      tradedDeaths: m.tradedDeaths,
      totalDeaths: m.totalDeaths,
      tradeEfficiencyRate:
        m.totalDeaths > 0 ? (m.tradedDeaths / m.totalDeaths) * 100 : null,
      clutchesWon: m.clutchesWon,
      avgKast: m.kastSamples ? m.kastSum / m.kastSamples : null,
    }))
    .sort(
      (a, b) =>
        b.matches - a.matches ||
        (b.fbConversionRate ?? -1) - (a.fbConversionRate ?? -1)
    );

  return {
    matchesWithTactics,
    fbWon,
    fbTotal,
    fbConversionRate: fbTotal > 0 ? (fbWon / fbTotal) * 100 : null,
    recoveryWon,
    recoveryTotal,
    recoveryRate: recoveryTotal > 0 ? (recoveryWon / recoveryTotal) * 100 : null,
    tradedDeaths,
    totalDeaths,
    tradeEfficiencyRate:
      totalDeaths > 0 ? (tradedDeaths / totalDeaths) * 100 : null,
    teamAvgKast: kastSamples > 0 ? kastSum / kastSamples : null,
    clutchesWon,
    clutchesByLabel,
    clutches,
    players,
    byMap,
  };
}

