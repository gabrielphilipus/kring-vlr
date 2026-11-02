import { toLocalDateString } from '../utils/formatters.js';

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

export function calcSideStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let atkWon = 0;
  let atkLost = 0;
  let defWon = 0;
  let defLost = 0;
  let pistolWon = 0;
  let pistolPlayed = 0;

  list.forEach((vod) => {
    const atk = vod?.roundResults?.Ataque || {};
    const def = vod?.roundResults?.Defesa || {};
    const hasManualRounds =
      Object.keys(atk).length > 0 || Object.keys(def).length > 0;

    if (hasManualRounds) {
      Object.entries(atk).forEach(([roundType, res]) => {
        if (res === 'Vitória') atkWon++;
        else if (res === 'Derrota') atkLost++;
        if (roundType.toLowerCase().includes('pistol')) {
          pistolPlayed++;
          if (res === 'Vitória') pistolWon++;
        }
      });
      Object.entries(def).forEach(([roundType, res]) => {
        if (res === 'Vitória') defWon++;
        else if (res === 'Derrota') defLost++;
        if (roundType.toLowerCase().includes('pistol')) {
          pistolPlayed++;
          if (res === 'Vitória') pistolWon++;
        }
      });
    } else if (Array.isArray(vod?.analysisData?.rounds)) {
      vod.analysisData.rounds.forEach((r) => {
        const isFriendly = r.winner === 'friendly';
        const side = normalizeSide(r.side);
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

