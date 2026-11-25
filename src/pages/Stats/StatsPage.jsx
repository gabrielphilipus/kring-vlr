import { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CircleHelp,
  Copy,
  ListFilter,
  Swords,
  Trophy,
  Video,
} from 'lucide-react';
import { Field } from '../../components/common/Field.jsx';
import { MetricCard } from '../../components/common/MetricCard.jsx';
import { MATCH_TYPES } from '../../constants/game.js';
import {
  calcOpeningDuelStats,
  calcRoundBalance,
  calcSideStats,
  calcStats,
  calcTacticalAggregateStats,
  filterVodsByPeriod,
  getBestAgent,
  getBestMap,
  getWorstMap,
  groupStats,
  sortCrossStats,
} from '../../domain/stats.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import { percent } from '../../utils/formatters.js';
import { uniqueSorted } from '../../utils/string.js';

export function StatsPage({ vods, gameplans = [], onToast }) {
  const [selectedMap, setSelectedMap] = useState('Todos');
  const [selectedAgent, setSelectedAgent] = useState('Todos');
  const [selectedMatchType, setSelectedMatchType] = useState('Todos');
  const [selectedOpponent, setSelectedOpponent] = useState('Todos');
  const [period, setPeriod] = useState('all'); // 'all' | '7d' | '30d' | '90d'
  const [crossSort, setCrossSort] = useState({ key: 'winrate', dir: 'desc' });

  // 1. Filter by period
  const filteredByPeriod = useMemo(
    () => filterVodsByPeriod(vods, period),
    [vods, period]
  );

  // 2. Filter by map, agent, match type & opponent
  const mapNames = useMemo(
    () => uniqueSorted(filteredByPeriod.map((v) => v.map)),
    [filteredByPeriod]
  );
  const agentNames = useMemo(
    () => uniqueSorted(filteredByPeriod.map((v) => v.agent)),
    [filteredByPeriod]
  );
  const opponentNames = useMemo(
    () => uniqueSorted(filteredByPeriod.map((v) => v.opponent)),
    [filteredByPeriod]
  );

  const filtered = useMemo(() => {
    return filteredByPeriod.filter(
      (v) =>
        (selectedMap === 'Todos' || v.map === selectedMap) &&
        (selectedAgent === 'Todos' || v.agent === selectedAgent) &&
        (selectedMatchType === 'Todos' ||
          (v.matchType || '') === selectedMatchType) &&
        (selectedOpponent === 'Todos' || (v.opponent || '') === selectedOpponent)
    );
  }, [
    filteredByPeriod,
    selectedMap,
    selectedAgent,
    selectedMatchType,
    selectedOpponent,
  ]);

  const currentStats = useMemo(() => calcStats(filtered), [filtered]);
  const byMapInFilter = useMemo(
    () => groupStats(filtered, (v) => v.map),
    [filtered]
  );
  const byAgentInFilter = useMemo(
    () => groupStats(filtered, (v) => v.agent),
    [filtered]
  );
  const cross = useMemo(
    () =>
      groupStats(filtered, (v) =>
        v.map && v.agent ? `${v.map} · ${v.agent}` : ''
      ),
    [filtered]
  );

  // Round balance
  const roundBalanceStats = useMemo(
    () => calcRoundBalance(filtered),
    [filtered]
  );

  // Side & Pistol stats
  const sideStats = useMemo(() => calcSideStats(filtered), [filtered]);

  // Opening duel stats (First Kills vs First Deaths)
  const openingDuelStats = useMemo(
    () => calcOpeningDuelStats(filtered),
    [filtered]
  );

  // Aggregated tactical stats across analyzed VODs
  const tacticalStats = useMemo(
    () => calcTacticalAggregateStats(filtered),
    [filtered]
  );

  // Sort cross combinations
  const sortedCross = useMemo(
    () => sortCrossStats(cross, crossSort),
    [cross, crossSort]
  );

  const toggleCrossSort = (key) => {
    setCrossSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const copyDiscordOverview = async () => {
    const bestMap = getBestMap(byMapInFilter);
    const worstMap = getWorstMap(byMapInFilter);
    const bestAgent = getBestAgent(byAgentInFilter);

    const periodLabel =
      period === '7d'
        ? 'Últimos 7 dias'
        : period === '30d'
          ? 'Últimos 30 dias'
          : period === '90d'
            ? 'Últimos 90 dias'
            : 'Todo o histórico';

    let text = `**KRING VLR — RELATÓRIO ESTATÍSTICO DE DESEMPENHO**\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    const filterNotes = [];
    if (selectedMatchType !== 'Todos') filterNotes.push(`Tipo: \`${selectedMatchType}\``);
    if (selectedOpponent !== 'Todos') filterNotes.push(`Adversário: **${selectedOpponent}**`);
    text += `**Período:** \`${periodLabel}\`${filterNotes.length ? ` | ${filterNotes.join(' | ')}` : ''} | **Partidas:** **${currentStats.matches}** (${currentStats.wins}V - ${currentStats.losses}D - ${currentStats.draws}E)\n`;
    text += `**Winrate Geral:** \`${percent(currentStats.winrate)}\` | **K/D Médio:** \`${currentStats.kdMatches ? `${currentStats.avgKD.toFixed(2)}x` : '—'}\` | **Abates:** \`${currentStats.kills}\`\n`;
    if (roundBalanceStats.matchesWithRounds > 0) {
      text += `**Saldo de Rounds:** \`${roundBalanceStats.won} × ${roundBalanceStats.lost}\` (${roundBalanceStats.diff > 0 ? '+' : ''}${roundBalanceStats.diff})\n`;
    }
    text += `\n`;

    if (bestMap) {
      text += `⭐ **Melhor Mapa:** **${bestMap.name}** (\`${percent(bestMap.winrate)}\` · ${bestMap.wins}V - ${bestMap.losses}D)\n`;
    }
    if (worstMap && worstMap.name !== bestMap?.name) {
      text += `**Atenção no Mapa:** **${worstMap.name}** (\`${percent(worstMap.winrate)}\` · ${worstMap.wins}V - ${worstMap.losses}D)\n`;
    }
    if (bestAgent) {
      text += `**Agente Mais Efetivo:** **${bestAgent.name}** (\`${percent(bestAgent.winrate)}\` · ${bestAgent.wins}V - ${bestAgent.losses}D)\n`;
    }

    if (
      sideStats.atkWR != null ||
      sideStats.defWR != null ||
      sideStats.pistolWR != null
    ) {
      text += `\n`;
      text += `**Aproveitamento Tático por Lado:**\n`;
      if (sideStats.atkWR != null)
        text += `• Ataque: \`${percent(sideStats.atkWR)}\` (${sideStats.atkWon}/${sideStats.atkTotal} rounds)\n`;
      if (sideStats.defWR != null)
        text += `• Defesa: \`${percent(sideStats.defWR)}\` (${sideStats.defWon}/${sideStats.defTotal} rounds)\n`;
      if (sideStats.pistolWR != null)
        text += `• Pistols: \`${percent(sideStats.pistolWR)}\` (${sideStats.pistolWon}/${sideStats.pistolPlayed} rounds)\n`;
    }

    if (openingDuelStats.total > 0) {
      text += `\n`;
      text += `**Duelos de Abertura:** \`${openingDuelStats.fk} First Kills\` vs \`${openingDuelStats.fd} First Deaths\` (Saldo: \`${openingDuelStats.diff > 0 ? '+' : ''}${openingDuelStats.diff}\` | Taxa FK: \`${percent(openingDuelStats.fkRate)}\`)\n`;
    }

    if (tacticalStats.matchesWithTactics > 0) {
      text += `\n`;
      text += `**Métricas Táticas Agregadas (${tacticalStats.matchesWithTactics} scrim(s)):**\n`;
      if (tacticalStats.fbConversionRate != null) {
        text += `• Conversão 5v4: \`${percent(tacticalStats.fbConversionRate)}\` (${tacticalStats.fbWon}/${tacticalStats.fbTotal})\n`;
      }
      if (tacticalStats.recoveryRate != null) {
        text += `• Recuperação 4v5: \`${percent(tacticalStats.recoveryRate)}\` (${tacticalStats.recoveryWon}/${tacticalStats.recoveryTotal})\n`;
      }
      if (tacticalStats.tradeEfficiencyRate != null) {
        text += `• Eficiência de Trades: \`${percent(tacticalStats.tradeEfficiencyRate)}\` (${tacticalStats.tradedDeaths}/${tacticalStats.totalDeaths})\n`;
      }
      if (tacticalStats.teamAvgKast != null) {
        text += `• KAST Médio da Equipe: \`${percent(tacticalStats.teamAvgKast)}\`\n`;
      }
      if (tacticalStats.clutchesWon > 0) {
        text += `• Clutches Vencidos: \`${tacticalStats.clutchesWon}\`\n`;
      }
    }

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_Gerado pelo KRING Valorant Analyzer_`;

    const ok = await copyToClipboard(text);
    if (ok) {
      if (onToast) onToast('Relatório copiado para o Discord!');
    } else {
      if (onToast) onToast('Erro ao copiar relatório.');
    }
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DADOS DE PERFORMANCE</div>
          <h1>Estatísticas</h1>
          <p>
            Encontre mapas fortes, agentes consistentes, aproveitamento de
            rounds por lado e combinações para otimizar sua preparação.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={copyDiscordOverview}
          disabled={!filtered.length}
          title="Copiar relatório completo com indicadores para o Discord"
        >
          <Copy size={15} /> Copiar p/ Discord
        </button>
      </div>

      <div className="stats-filter-panel">
        <div className="stats-filter-intro">
          <ListFilter size={18} />
          <div>
            <strong>Filtros de Análise</strong>
            <span>
              Selecione período, mapa ou agente para recalcular todos os
              indicadores.
            </span>
          </div>
        </div>

        <div className="stats-filters">
          <div className="field">
            <span className="field-label">Período</span>
            <div className="filter-chip-row" style={{ marginTop: 4 }}>
              {[
                { id: 'all', label: 'Todo o histórico' },
                { id: '7d', label: 'Últimos 7 dias' },
                { id: '30d', label: 'Últimos 30 dias' },
                { id: '90d', label: 'Últimos 90 dias' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`filter-chip ${period === p.id ? 'active' : ''}`}
                  onClick={() => setPeriod(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Mapa">
            <select
              value={selectedMap}
              onChange={(e) => setSelectedMap(e.target.value)}
            >
              <option>Todos</option>
              {mapNames.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>

          <Field label="Agente">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option>Todos</option>
              {agentNames.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>

          <Field label="Tipo">
            <select
              aria-label="Tipo"
              value={selectedMatchType}
              onChange={(e) => setSelectedMatchType(e.target.value)}
            >
              <option>Todos</option>
              {MATCH_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>

          <Field label="Adversário">
            <select
              aria-label="Adversário"
              value={selectedOpponent}
              onChange={(e) => setSelectedOpponent(e.target.value)}
            >
              <option>Todos</option>
              {opponentNames.map((opp) => (
                <option key={opp}>{opp}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="stats-cards-row">
        <MetricCard
          icon={Video}
          label="Partidas no filtro"
          value={currentStats.matches}
          detail={`${currentStats.wins}V · ${currentStats.losses}D · ${currentStats.draws}E`}
          accent="blue"
        />
        <MetricCard
          icon={Trophy}
          label="Winrate no filtro"
          value={percent(currentStats.winrate)}
          detail={`${currentStats.decisions} partidas com decisão`}
          accent="green"
        />
        <MetricCard
          icon={Swords}
          label="Abates e K/D"
          value={
            currentStats.kdMatches ? `${currentStats.avgKD.toFixed(2)}x` : '—'
          }
          detail={`Média ${currentStats.avgKills.toFixed(1)} kills/jogo · ${currentStats.kills} total`}
          accent="purple"
        />
        <MetricCard
          icon={Activity}
          label="Saldo de Rounds"
          value={
            roundBalanceStats.matchesWithRounds > 0
              ? `${roundBalanceStats.diff > 0 ? '+' : ''}${roundBalanceStats.diff}`
              : '—'
          }
          detail={
            roundBalanceStats.matchesWithRounds > 0
              ? `${roundBalanceStats.won} ganhos × ${roundBalanceStats.lost} perdidos`
              : 'Sem placar detalhado'
          }
          accent="orange"
        />
      </div>

      {(sideStats.atkTotal > 0 ||
        sideStats.defTotal > 0 ||
        sideStats.pistolPlayed > 0 ||
        openingDuelStats.total > 0) && (
        <div className="stats-tactical-grid">
          <div className="panel tactical-stat-box">
            <div className="panel-heading">
              <div>
                <h2>Aproveitamento por Lado & Pistols</h2>
                <p>
                  Taxa de vitória em cada metade do jogo e nos rounds de
                  pistola.
                </p>
              </div>
            </div>
            <div className="side-balance-bars">
              <div className="side-balance-row">
                <div className="side-balance-header">
                  <span>
                    <strong>Lado Atacante:</strong> {sideStats.atkWon}/
                    {sideStats.atkTotal} rounds
                  </span>
                  <strong
                    className={
                      sideStats.atkWR != null && sideStats.atkWR >= 50
                        ? 'win-text'
                        : 'loss-text'
                    }
                  >
                    {sideStats.atkWR != null
                      ? percent(sideStats.atkWR)
                      : 'Sem dados'}
                  </strong>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${sideStats.atkWR || 0}%`,
                      background: 'linear-gradient(90deg, #f97316, #fb923c)',
                    }}
                  />
                </div>
              </div>

              <div className="side-balance-row">
                <div className="side-balance-header">
                  <span>
                    <strong>Lado Defensor:</strong> {sideStats.defWon}/
                    {sideStats.defTotal} rounds
                  </span>
                  <strong
                    className={
                      sideStats.defWR != null && sideStats.defWR >= 50
                        ? 'win-text'
                        : 'loss-text'
                    }
                  >
                    {sideStats.defWR != null
                      ? percent(sideStats.defWR)
                      : 'Sem dados'}
                  </strong>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${sideStats.defWR || 0}%`,
                      background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                    }}
                  />
                </div>
              </div>

              <div className="side-balance-row">
                <div className="side-balance-header">
                  <span>
                    <strong>Rounds Pistol:</strong> {sideStats.pistolWon}/
                    {sideStats.pistolPlayed} ganhos
                  </span>
                  <strong
                    className={
                      sideStats.pistolWR != null && sideStats.pistolWR >= 50
                        ? 'win-text'
                        : 'loss-text'
                    }
                  >
                    {sideStats.pistolWR != null
                      ? percent(sideStats.pistolWR)
                      : 'Sem dados'}
                  </strong>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${sideStats.pistolWR || 0}%`,
                      background: 'linear-gradient(90deg, #10b981, #34d399)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="panel tactical-stat-box">
            <div className="panel-heading">
              <div>
                <h2>Duelos de Abertura (First Blood)</h2>
                <p>
                  Equilíbrio entre primeiros abates e primeiras mortes nos
                  rounds.
                </p>
              </div>
            </div>
            {openingDuelStats.total > 0 ? (
              <div className="opening-duels-body">
                <div className="opening-duels-kpi">
                  <div className="opening-duel-stat win">
                    <span>First Kills (FK)</span>
                    <strong>+{openingDuelStats.fk}</strong>
                  </div>
                  <div className="opening-duel-stat diff">
                    <span>Saldo de Abertura</span>
                    <strong
                      className={
                        openingDuelStats.diff >= 0 ? 'win-text' : 'loss-text'
                      }
                    >
                      {openingDuelStats.diff > 0 ? '+' : ''}
                      {openingDuelStats.diff}
                    </strong>
                  </div>
                  <div className="opening-duel-stat loss">
                    <span>First Deaths (FD)</span>
                    <strong>-{openingDuelStats.fd}</strong>
                  </div>
                </div>
                <div className="opening-rate-bar">
                  <div
                    className="side-balance-header"
                    style={{ marginBottom: 4 }}
                  >
                    <span>Taxa de Vitória no Primeiro Duelo</span>
                    <strong
                      className={
                        openingDuelStats.fkRate >= 50 ? 'win-text' : 'loss-text'
                      }
                    >
                      {percent(openingDuelStats.fkRate)}
                    </strong>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${openingDuelStats.fkRate || 0}%`,
                        background: 'linear-gradient(90deg, #10b981, #34d399)',
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel-empty" style={{ padding: '24px 0' }}>
                <Swords size={24} />
                <span>
                  Registre eventos de First Kill ou faça a review com OCR para
                  calcular a taxa de abertura.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {tacticalStats.matchesWithTactics > 0 && (
        <div className="tactical-agg-section">
          <div className="panel tactical-agg-summary-panel">
            <div className="panel-heading">
              <div>
                <h2>Métricas Táticas Agregadas</h2>
                <p>
                  Consolidado automático de {tacticalStats.matchesWithTactics}{' '}
                  partida(s) analisada(s) no filtro atual.
                </p>
              </div>
              <span className="small-counter">
                {tacticalStats.clutchesWon} clutch(es)
              </span>
            </div>

            <div className="tactical-agg-grid">
              <div className="tactical-agg-card">
                <span className="tactical-agg-label">Conversão 5v4 (FB)</span>
                <strong
                  className={
                    tacticalStats.fbConversionRate != null &&
                    tacticalStats.fbConversionRate >= 50
                      ? 'win-text'
                      : 'loss-text'
                  }
                >
                  {tacticalStats.fbConversionRate != null
                    ? percent(tacticalStats.fbConversionRate)
                    : '—'}
                </strong>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${tacticalStats.fbConversionRate || 0}%`,
                      background: 'linear-gradient(90deg, #10b981, #34d399)',
                    }}
                  />
                </div>
                <small>
                  {tacticalStats.fbWon}/{tacticalStats.fbTotal} rounds vencidos
                </small>
              </div>

              <div className="tactical-agg-card">
                <span className="tactical-agg-label">Recuperação 4v5</span>
                <strong
                  className={
                    tacticalStats.recoveryRate != null &&
                    tacticalStats.recoveryRate >= 30
                      ? 'win-text'
                      : ''
                  }
                >
                  {tacticalStats.recoveryRate != null
                    ? percent(tacticalStats.recoveryRate)
                    : '—'}
                </strong>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${tacticalStats.recoveryRate || 0}%`,
                      background: 'linear-gradient(90deg, #f97316, #fb923c)',
                    }}
                  />
                </div>
                <small>
                  {tacticalStats.recoveryWon}/{tacticalStats.recoveryTotal}{' '}
                  rounds virados
                </small>
              </div>

              <div className="tactical-agg-card">
                <span className="tactical-agg-label">
                  Eficiência de Trades
                </span>
                <strong
                  className={
                    tacticalStats.tradeEfficiencyRate != null &&
                    tacticalStats.tradeEfficiencyRate >= 25
                      ? 'win-text'
                      : ''
                  }
                >
                  {tacticalStats.tradeEfficiencyRate != null
                    ? percent(tacticalStats.tradeEfficiencyRate)
                    : '—'}
                </strong>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${tacticalStats.tradeEfficiencyRate || 0}%`,
                      background: 'linear-gradient(90deg, #eab308, #facc15)',
                    }}
                  />
                </div>
                <small>
                  {tacticalStats.tradedDeaths}/{tacticalStats.totalDeaths}{' '}
                  mortes vingadas
                </small>
              </div>

              <div className="tactical-agg-card">
                <span className="tactical-agg-label">
                  KAST Médio & Clutches
                </span>
                <strong style={{ color: '#60a5fa' }}>
                  {tacticalStats.teamAvgKast != null
                    ? percent(tacticalStats.teamAvgKast)
                    : '—'}
                </strong>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${tacticalStats.teamAvgKast || 0}%`,
                      background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                    }}
                  />
                </div>
                <small>
                  {tacticalStats.clutchesWon > 0
                    ? Object.entries(tacticalStats.clutchesByLabel)
                        .map(([lbl, cnt]) => `${cnt}× ${lbl}`)
                        .join(' · ')
                    : 'Nenhum clutch registrado'}
                </small>
              </div>
            </div>
          </div>

          {(tacticalStats.players.length > 0 ||
            tacticalStats.byMap.length > 0) && (
            <div className="tactical-agg-tables">
              {tacticalStats.players.length > 0 && (
                <div className="panel cross-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Desempenho Tático por Jogador</h2>
                      <p>
                        Médias consolidadas dos aliados nas scrims analisadas.
                      </p>
                    </div>
                    <span className="small-counter">
                      {tacticalStats.players.length} jogadores
                    </span>
                  </div>
                  <div className="recent-table-wrap">
                    <table className="data-table stats-table">
                      <thead>
                        <tr>
                          <th>JOGADOR</th>
                          <th>JOGOS</th>
                          <th>KAST%</th>
                          <th>TRADES (K/D)</th>
                          <th>CLUTCHES</th>
                          <th>K/D</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tacticalStats.players.map((p) => (
                          <tr key={p.name}>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.matches}</td>
                            <td>
                              <strong
                                className={
                                  p.avgKast != null && p.avgKast >= 70
                                    ? 'win-text'
                                    : ''
                                }
                              >
                                {p.avgKast != null ? percent(p.avgKast) : '—'}
                              </strong>
                            </td>
                            <td>
                              {p.tradeKills} / {p.tradedDeaths}
                            </td>
                            <td>{p.clutchesWon}</td>
                            <td>
                              {p.kills > 0 || p.deaths > 0
                                ? `${p.kdRatio.toFixed(2)}x`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tacticalStats.byMap.length > 0 && (
                <div className="panel cross-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Desempenho Tático por Mapa</h2>
                      <p>Conversão de vantagens, trades e KAST por mapa.</p>
                    </div>
                    <span className="small-counter">
                      {tacticalStats.byMap.length} mapas
                    </span>
                  </div>
                  <div className="recent-table-wrap">
                    <table className="data-table stats-table">
                      <thead>
                        <tr>
                          <th>MAPA</th>
                          <th>JOGOS</th>
                          <th>5V4</th>
                          <th>4V5</th>
                          <th>TRADE%</th>
                          <th>KAST%</th>
                          <th>CLUTCHES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tacticalStats.byMap.map((m) => (
                          <tr key={m.map}>
                            <td>
                              <strong>{m.map}</strong>
                            </td>
                            <td>{m.matches}</td>
                            <td
                              className={
                                m.fbConversionRate != null &&
                                m.fbConversionRate >= 50
                                  ? 'win-text'
                                  : ''
                              }
                            >
                              {m.fbConversionRate != null
                                ? percent(m.fbConversionRate)
                                : '—'}
                            </td>
                            <td>
                              {m.recoveryRate != null
                                ? percent(m.recoveryRate)
                                : '—'}
                            </td>
                            <td>
                              {m.tradeEfficiencyRate != null
                                ? percent(m.tradeEfficiencyRate)
                                : '—'}
                            </td>
                            <td>
                              {m.avgKast != null ? percent(m.avgKast) : '—'}
                            </td>
                            <td>{m.clutchesWon}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="stats-analysis-grid">
        <StatPanel
          title="Desempenho por mapa"
          subtitle="Winrate e volume de partidas"
          rows={byMapInFilter}
          empty="Não há partidas para os filtros selecionados."
        />
        <StatPanel
          title="Desempenho por agente"
          subtitle="Winrate e volume de partidas"
          rows={byAgentInFilter}
          empty="Não há partidas para os filtros selecionados."
        />
      </div>

      <div className="panel cross-panel">
        <div className="panel-heading">
          <div>
            <h2>Mapa + Agente</h2>
            <p>Compare suas combinações. Clique nas colunas para ordenar.</p>
          </div>
          <span className="small-counter">{cross.length} combinações</span>
        </div>
        {sortedCross.length ? (
          <div className="recent-table-wrap">
            <table className="data-table stats-table">
              <thead>
                <tr>
                  <th
                    className="sortable-th"
                    onClick={() => toggleCrossSort('name')}
                  >
                    MAPA · AGENTE{' '}
                    {crossSort.key === 'name' &&
                      (crossSort.dir === 'desc' ? '▼' : '▲')}
                  </th>
                  <th
                    className="sortable-th"
                    onClick={() => toggleCrossSort('matches')}
                  >
                    PARTIDAS{' '}
                    {crossSort.key === 'matches' &&
                      (crossSort.dir === 'desc' ? '▼' : '▲')}
                  </th>
                  <th
                    className="sortable-th"
                    onClick={() => toggleCrossSort('wins')}
                  >
                    VITÓRIAS{' '}
                    {crossSort.key === 'wins' &&
                      (crossSort.dir === 'desc' ? '▼' : '▲')}
                  </th>
                  <th
                    className="sortable-th"
                    onClick={() => toggleCrossSort('losses')}
                  >
                    DERROTAS{' '}
                    {crossSort.key === 'losses' &&
                      (crossSort.dir === 'desc' ? '▼' : '▲')}
                  </th>
                  <th
                    className="sortable-th"
                    onClick={() => toggleCrossSort('draws')}
                  >
                    EMPATES{' '}
                    {crossSort.key === 'draws' &&
                      (crossSort.dir === 'desc' ? '▼' : '▲')}
                  </th>
                  <th
                    className="sortable-th"
                    onClick={() => toggleCrossSort('winrate')}
                  >
                    WINRATE{' '}
                    {crossSort.key === 'winrate' &&
                      (crossSort.dir === 'desc' ? '▼' : '▲')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedCross.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.matches}</td>
                    <td className="win-text">{row.wins}</td>
                    <td className="loss-text">{row.losses}</td>
                    <td>{row.draws}</td>
                    <td>
                      <div className="table-rate">
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${row.winrate}%` }}
                          />
                        </div>
                        <strong
                          className={
                            row.decisions && row.winrate >= 50 ? 'good' : ''
                          }
                        >
                          {percent(row.winrate)}
                        </strong>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-empty">
            <BarChart3 size={20} />
            <span>Adicione VODs para comparar mapa e agente.</span>
          </div>
        )}
      </div>

      <GameplanStatsPanel vods={filtered} gameplans={gameplans} />

      <div className="dashboard-bottom-note">
        <CircleHelp size={15} />
        <span>
          Empates não entram no denominador do winrate. Para uma leitura
          confiável, compare também o número de partidas de cada combinação.
        </span>
      </div>
    </section>
  );
}

export function GameplanStatsPanel({ vods, gameplans }) {
  const [map, setMap] = useState('Todos');
  const [side, setSide] = useState('Todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortKey, setSortKey] = useState('winrate');
  const [sortDir, setSortDir] = useState('desc');

  const mapOptions = uniqueSorted(gameplans.map((plan) => plan.map));

  const rows = useMemo(() => {
    return gameplans
      .filter(
        (plan) =>
          (map === 'Todos' || plan.map === map) &&
          (side === 'Todos' || plan.side === side)
      )
      .map((plan) => {
        const matches = vods.filter(
          (vod) =>
            vod.gameplanId === plan.id &&
            (!from || (vod.date || '') >= from) &&
            (!to || (vod.date || '') <= to)
        );
        const wins = matches.filter((vod) => vod.result === 'Vitória').length;
        const losses = matches.filter((vod) => vod.result === 'Derrota').length;
        const draws = matches.filter((vod) => vod.result === 'Empate').length;
        const decisions = wins + losses;
        const scored = matches.filter(
          (vod) =>
            Number.isFinite(Number(vod.roundsWon)) &&
            Number.isFinite(Number(vod.roundsLost)) &&
            vod.roundsWon != null &&
            vod.roundsLost != null
        );
        const roundsWon = scored.reduce(
          (total, vod) => total + Number(vod.roundsWon),
          0
        );
        const roundsLost = scored.reduce(
          (total, vod) => total + Number(vod.roundsLost),
          0
        );
        return {
          ...plan,
          matches: matches.length,
          wins,
          losses,
          draws,
          decisions,
          winrate: decisions ? (wins / decisions) * 100 : 0,
          roundsWon,
          roundsLost,
          roundBalance: scored.length ? roundsWon - roundsLost : null,
        };
      });
  }, [gameplans, vods, map, side, from, to]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      let comp = 0;
      if (sortKey === 'name') comp = a.name.localeCompare(b.name);
      else if (sortKey === 'matches') comp = a.matches - b.matches;
      else if (sortKey === 'wins') comp = a.wins - b.wins;
      else if (sortKey === 'winrate') comp = a.winrate - b.winrate;
      else if (sortKey === 'roundBalance')
        comp = (a.roundBalance ?? -999) - (b.roundBalance ?? -999);
      return sortDir === 'desc' ? -comp : comp;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    setSortKey(key);
    setSortDir((prev) => (sortKey === key && prev === 'desc' ? 'asc' : 'desc'));
  };

  const ranked = rows
    .filter((row) => row.decisions > 0)
    .sort((a, b) => b.winrate - a.winrate || b.decisions - a.decisions);

  return (
    <div className="panel cross-panel gameplan-report">
      <div className="panel-heading">
        <div>
          <h2>Desempenho por Gameplan</h2>
          <p>
            Compare vitórias, winrate e saldo de rounds dos planos executados.
            Clique nas colunas para ordenar.
          </p>
        </div>
        <span className="small-counter">{rows.length} planos</span>
      </div>

      <div className="gameplan-report-filters">
        <Field label="Mapa">
          <select value={map} onChange={(e) => setMap(e.target.value)}>
            <option>Todos</option>
            {mapOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Lado">
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            <option>Todos</option>
            <option>Ataque</option>
            <option>Defesa</option>
            <option>Ambos</option>
          </select>
        </Field>
        <Field label="De">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Até">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>

      {ranked.length > 0 && (
        <div className="gameplan-rankings">
          <div>
            <span>Maior winrate</span>
            <strong>{ranked[0].name}</strong>
            <small>
              {percent(ranked[0].winrate)} · {ranked[0].decisions} partidas
              decididas
            </small>
          </div>
          <div>
            <span>Menor winrate</span>
            <strong>{ranked[ranked.length - 1].name}</strong>
            <small>
              {percent(ranked[ranked.length - 1].winrate)} ·{' '}
              {ranked[ranked.length - 1].decisions} partidas decididas
            </small>
          </div>
        </div>
      )}

      {sortedRows.length ? (
        <div className="recent-table-wrap">
          <table className="data-table stats-table">
            <thead>
              <tr>
                <th className="sortable-th" onClick={() => toggleSort('name')}>
                  GAMEPLAN{' '}
                  {sortKey === 'name' && (sortDir === 'desc' ? '▼' : '▲')}
                </th>
                <th>MAPA · LADO</th>
                <th
                  className="sortable-th"
                  onClick={() => toggleSort('matches')}
                >
                  PARTIDAS{' '}
                  {sortKey === 'matches' && (sortDir === 'desc' ? '▼' : '▲')}
                </th>
                <th>V · D · E</th>
                <th
                  className="sortable-th"
                  onClick={() => toggleSort('winrate')}
                >
                  WINRATE{' '}
                  {sortKey === 'winrate' && (sortDir === 'desc' ? '▼' : '▲')}
                </th>
                <th>ROUNDS</th>
                <th
                  className="sortable-th"
                  onClick={() => toggleSort('roundBalance')}
                >
                  SALDO{' '}
                  {sortKey === 'roundBalance' &&
                    (sortDir === 'desc' ? '▼' : '▲')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>
                    {row.map} · {row.side}
                  </td>
                  <td>{row.matches}</td>
                  <td>
                    <span className="win-text">{row.wins}</span> ·{' '}
                    <span className="loss-text">{row.losses}</span> ·{' '}
                    {row.draws}
                  </td>
                  <td>
                    <div className="table-rate">
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${row.winrate}%` }}
                        />
                      </div>
                      <strong>
                        {row.decisions ? percent(row.winrate) : '—'}
                      </strong>
                    </div>
                  </td>
                  <td>
                    {row.roundBalance == null
                      ? '—'
                      : `${row.roundsWon} × ${row.roundsLost}`}
                  </td>
                  <td
                    className={
                      row.roundBalance > 0
                        ? 'win-text'
                        : row.roundBalance < 0
                          ? 'loss-text'
                          : ''
                    }
                  >
                    {row.roundBalance == null
                      ? '—'
                      : `${row.roundBalance > 0 ? '+' : ''}${row.roundBalance}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-empty">
          <Swords size={20} />
          <span>Nenhum Gameplan registrado para os filtros selecionados.</span>
        </div>
      )}
    </div>
  );
}

export function StatPanel({ title, subtitle, rows, empty }) {
  return (
    <div className="panel stat-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {rows.length ? (
        <div className="stat-bars">
          {rows.map((row) => (
            <div className="stat-bar-row" key={row.name}>
              <div className="stat-name-row">
                <strong>{row.name}</strong>
                <span>
                  {row.wins}V · {row.losses}D
                  {row.draws ? ` · ${row.draws}E` : ''}
                </span>
              </div>
              <div className="stat-bar-bottom">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${row.winrate}%` }}
                  />
                </div>
                <strong
                  className={row.decisions && row.winrate >= 50 ? 'good' : ''}
                >
                  {percent(row.winrate)}
                </strong>
              </div>
              <span className="stat-games">
                {row.matches} {row.matches === 1 ? 'partida' : 'partidas'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          <BarChart3 size={22} />
          <span>{empty}</span>
        </div>
      )}
    </div>
  );
}

