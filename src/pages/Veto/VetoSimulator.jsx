import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  Check,
  CircleHelp,
  Coins,
  Copy,
  Map as MapIcon,
  RotateCcw,
  ShieldCheck,
  Swords,
} from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard.js';

export function makeVetoSteps(format, grandFinal, upperTeam) {
  if (format === 'bo1') {
    return [
      { kind: 'ban', team: 'A' },
      { kind: 'ban', team: 'B' },
      { kind: 'ban', team: 'A' },
      { kind: 'ban', team: 'B' },
      { kind: 'ban', team: 'A' },
      { kind: 'ban', team: 'B' },
      { kind: 'side', team: 'A', slot: 1, decider: true },
    ];
  }
  const steps =
    format === 'bo5' && grandFinal
      ? [
          { kind: 'ban', team: upperTeam },
          { kind: 'ban', team: upperTeam },
        ]
      : [
          { kind: 'ban', team: 'A' },
          { kind: 'ban', team: 'B' },
        ];
  steps.push(
    { kind: 'pick', team: 'A', slot: 1 },
    { kind: 'side', team: 'B', slot: 1 },
    { kind: 'pick', team: 'B', slot: 2 },
    { kind: 'side', team: 'A', slot: 2 }
  );
  if (format === 'bo3') {
    steps.push(
      { kind: 'ban', team: 'A' },
      { kind: 'ban', team: 'B' },
      { kind: 'side', team: 'A', slot: 3, decider: true }
    );
  } else {
    steps.push(
      { kind: 'pick', team: 'A', slot: 3 },
      { kind: 'side', team: 'B', slot: 3 },
      { kind: 'pick', team: 'B', slot: 4 },
      { kind: 'side', team: 'A', slot: 4 },
      { kind: 'side', team: 'B', slot: 5, decider: true }
    );
  }
  return steps;
}

export function VetoSimulator({ maps, mapsStats = [], onToast }) {
  const mapNames = maps.map((item) => item.name);
  const [format, setFormat] = useState('bo3');
  const [grandFinal, setGrandFinal] = useState(false);
  const [upperTeam, setUpperTeam] = useState('A');
  const [selectedPool, setSelectedPool] = useState(null);
  const pool = useMemo(() => {
    const base = selectedPool ?? mapNames;
    const kept = base.filter((name) => mapNames.includes(name)).slice(0, 7);
    return kept.length >= 7
      ? kept
      : [
          ...kept,
          ...mapNames
            .filter((name) => !kept.includes(name))
            .slice(0, 7 - kept.length),
        ];
  }, [selectedPool, mapNames]);
  const mapArtwork = Object.fromEntries(
    maps
      .filter((item) => item.previewUrl)
      .map((item) => [item.name, item.previewUrl])
  );
  const [myTeam, setMyTeam] = useState('A');
  const [teamNames, setTeamNames] = useState({ A: 'Time A', B: 'Time B' });
  const [history, setHistory] = useState([]);
  const [started, setStarted] = useState(false);
  const [coinResult, setCoinResult] = useState(null);
  const [isFlipping, setIsFlipping] = useState(false);

  const statsByMap = useMemo(() => {
    const map = new Map();
    (mapsStats || []).forEach((st) => {
      if (st.name) map.set(st.name, st);
    });
    return map;
  }, [mapsStats]);

  const steps = useMemo(
    () => makeVetoSteps(format, grandFinal, upperTeam),
    [format, grandFinal, upperTeam]
  );
  const currentStep = steps[history.length];
  const remainingMaps = pool.filter(
    (map) =>
      !history.some(
        (item) =>
          (item.kind === 'ban' || item.kind === 'pick') && item.map === map
      )
  );
  const pickedMaps = history.filter((item) => item.kind === 'pick');
  const activeMap =
    currentStep?.kind === 'side'
      ? currentStep.decider
        ? remainingMaps[0]
        : pickedMaps.find((item) => item.slot === currentStep.slot)?.map
      : '';
  const complete = started && history.length === steps.length;

  const flipCoin = () => {
    setIsFlipping(true);
    setTimeout(() => {
      const winner = Math.random() < 0.5 ? 'A' : 'B';
      const winnerName =
        winner === 'A' ? teamNames.A || 'Time A' : teamNames.B || 'Time B';
      setCoinResult({ winner, name: winnerName });
      setIsFlipping(false);
    }, 350);
  };

  const applyCoinWinnerAsTeamA = () => {
    if (coinResult?.winner === 'B') {
      const newA = teamNames.B;
      const newB = teamNames.A;
      setTeamNames({ A: newA, B: newB });
      setCoinResult({ winner: 'A', name: newA });
      if (onToast) onToast(`${newA} agora é o Time A!`);
    }
  };

  const copyVetoToDiscord = async () => {
    const formatLabel =
      format === 'bo1'
        ? 'MD1 / BO1'
        : format === 'bo3'
          ? 'MD3 / BO3'
          : 'MD5 / BO5';
    let text = `**RESUMO DO MAP VETO — ${formatLabel}**\n`;
    text += `**${teamNames.A}** vs **${teamNames.B}**\n\n`;
    text += `**Histórico de Escolhas:**\n`;

    history.forEach((step, idx) => {
      const num = idx + 1;
      const team = teamNames[step.team] || `Time ${step.team}`;
      if (step.kind === 'ban') {
        text += `• ${num}. **${team}** baniu **${step.map}**\n`;
      } else if (step.kind === 'pick') {
        text += `• ${num}. **${team}** escolheu **${step.map}** (Mapa ${step.slot})\n`;
      } else if (step.kind === 'side') {
        text += `• ${num}. **${team}** escolheu começar no lado **${step.side}** no mapa **${step.map}**\n`;
      }
    });

    text += `\n**Ordem Oficial da Série:**\n`;
    const totalMaps = format === 'bo1' ? 1 : format === 'bo3' ? 3 : 5;
    for (let i = 0; i < totalMaps; i++) {
      const mapItem = pickedMaps.find((item) => item.slot === i + 1);
      const finalMap =
        i === (format === 'bo1' ? 0 : format === 'bo3' ? 2 : 4)
          ? remainingMaps.length === 1
            ? remainingMaps[0]
            : ''
          : '';
      const map = mapItem?.map || finalMap;
      const sideItem = history.find(
        (item) => item.kind === 'side' && item.slot === i + 1
      );
      const sideText = sideItem
        ? ` (${teamNames[sideItem.team]} começa de ${sideItem.side})`
        : '';
      const isDecider = format === 'bo1' || i === totalMaps - 1;
      const label =
        totalMaps === 1
          ? 'Mapa Único'
          : isDecider
            ? 'Decider'
            : `Mapa ${i + 1}`;
      text += `**${label}**: **${map || 'A definir'}**${sideText}\n`;
    }

    text += `\n*Gerado pelo KRING Valorant Analyzer*`;

    const ok = await copyToClipboard(text);
    if (ok) {
      if (onToast) onToast('Resumo copiado para a área de transferência!');
    } else {
      if (onToast) onToast('Não foi possível copiar o resumo.');
    }
  };

  const changePool = (map) =>
    setSelectedPool((previous) => {
      const current = previous ?? pool;
      return current.includes(map)
        ? current.filter((item) => item !== map)
        : current.length < 7
          ? [...current, map]
          : current;
    });
  const start = () => {
    setHistory([]);
    setStarted(true);
  };
  const reset = () => {
    setHistory([]);
    setStarted(false);
    setCoinResult(null);
    setSelectedPool(null);
  };
  const choose = (value) => {
    if (!currentStep) return;
    setHistory((previous) => [
      ...previous,
      {
        ...currentStep,
        ...(currentStep.kind === 'side'
          ? { side: value, map: activeMap }
          : { map: value }),
      },
    ]);
  };
  const undo = () => setHistory((previous) => previous.slice(0, -1));
  const updateTeam = (team, value) =>
    setTeamNames((previous) => ({ ...previous, [team]: value }));
  const stepTitle = (step) =>
    step?.kind === 'ban'
      ? 'Banir um mapa'
      : step?.kind === 'pick'
        ? `Escolher mapa ${step.slot}`
        : step?.decider
          ? `Escolher lado no mapa decisivo${activeMap ? ` (${activeMap})` : ''}`
          : `Escolher lado do mapa ${step?.slot}${activeMap ? ` (${activeMap})` : ''}`;

  return (
    <section className="veto-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SIMULAÇÃO DE SÉRIE</div>
          <h1>Map veto</h1>
          <p>
            Simule a ordem oficial de bans, picks e escolha de lado em uma série
            do VCT.
          </p>
        </div>
        {started && (
          <button className="button button-quiet" onClick={reset}>
            <RotateCcw size={15} /> Reiniciar
          </button>
        )}
      </div>
      {!started ? (
        <>
          <div className="veto-setup-grid">
            <div className="panel veto-setup-panel">
              <div className="panel-heading">
                <div>
                  <h2>Configurar matchup</h2>
                  <p>Defina o formato e qual equipe você representa.</p>
                </div>
                <Swords size={18} className="muted-icon" />
              </div>
              <div className="veto-format-choice">
                <button
                  className={format === 'bo1' ? 'selected' : ''}
                  onClick={() => setFormat('bo1')}
                >
                  <strong>BO1</strong>
                  <span>Melhor de 1 · 1 mapa</span>
                </button>
                <button
                  className={format === 'bo3' ? 'selected' : ''}
                  onClick={() => setFormat('bo3')}
                >
                  <strong>BO3</strong>
                  <span>Melhor de 3 · 3 mapas</span>
                </button>
                <button
                  className={format === 'bo5' ? 'selected' : ''}
                  onClick={() => setFormat('bo5')}
                >
                  <strong>BO5</strong>
                  <span>Melhor de 5 · 5 mapas</span>
                </button>
              </div>
              {format === 'bo5' && (
                <div className="veto-final-config">
                  <label className="veto-final-toggle">
                    <input
                      type="checkbox"
                      checked={grandFinal}
                      onChange={(event) => setGrandFinal(event.target.checked)}
                    />
                    <span>
                      <strong>Grande final de eliminação dupla</strong>
                      <small>
                        O time da chave superior bane os dois primeiros mapas.
                      </small>
                    </span>
                  </label>
                  {grandFinal && (
                    <div className="veto-upper-team">
                      <span className="field-label">
                        Time da chave superior
                      </span>
                      <div className="veto-side-choice">
                        <button
                          className={upperTeam === 'A' ? 'selected' : ''}
                          onClick={() => setUpperTeam('A')}
                        >
                          Time A
                        </button>
                        <button
                          className={upperTeam === 'B' ? 'selected' : ''}
                          onClick={() => setUpperTeam('B')}
                        >
                          Time B
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="veto-team-fields">
                <label className="field">
                  <span className="field-label">Nome do Time A</span>
                  <input
                    value={teamNames.A}
                    onChange={(event) => updateTeam('A', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Nome do Time B</span>
                  <input
                    value={teamNames.B}
                    onChange={(event) => updateTeam('B', event.target.value)}
                  />
                </label>
              </div>
              <div className="veto-coin-toss-row">
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={flipCoin}
                  disabled={isFlipping}
                >
                  <Coins size={14} />{' '}
                  {isFlipping
                    ? 'Sorteando moeda...'
                    : 'Sorteio de moeda (Cara ou Coroa)'}
                </button>
                {coinResult && (
                  <span className="coin-result-tag">
                    🪙 <strong>{coinResult.name}</strong> venceu a moeda!
                    {coinResult.winner === 'B' && (
                      <button
                        type="button"
                        className="button button-quiet button-micro"
                        style={{
                          marginLeft: 6,
                          padding: '2px 7px',
                          fontSize: 10,
                          height: 22,
                        }}
                        onClick={applyCoinWinnerAsTeamA}
                        title="Colocar o vencedor como Time A (para começar o veto)"
                      >
                        Definir como Time A
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="field" style={{ marginTop: 14 }}>
                <span className="field-label">Você representa</span>
                <div className="veto-side-choice">
                  <button
                    className={myTeam === 'A' ? 'selected' : ''}
                    onClick={() => setMyTeam('A')}
                  >
                    Sou Time A ({teamNames.A})
                  </button>
                  <button
                    className={myTeam === 'B' ? 'selected' : ''}
                    onClick={() => setMyTeam('B')}
                  >
                    Sou Time B ({teamNames.B})
                  </button>
                </div>
                <span className="helper-text">
                  No formato VCT, o Time A inicia o processo de veto.
                </span>
              </div>
            </div>
            <div className="panel veto-pool-panel">
              <div className="panel-heading">
                <div>
                  <h2>Pool de mapas</h2>
                  <p>Selecione exatamente 7 mapas para esta série.</p>
                </div>
                <span className="small-counter">{pool.length} / 7</span>
              </div>
              <div className="veto-pool-grid">
                {mapNames.map((map) => (
                  <button
                    key={map}
                    className={`veto-pool-chip ${pool.includes(map) ? 'active' : ''}`}
                    onClick={() => changePool(map)}
                    disabled={!pool.includes(map) && pool.length >= 7}
                    aria-pressed={pool.includes(map)}
                  >
                    <span className="veto-pool-check">
                      {pool.includes(map) && <Check size={12} />}
                    </span>
                    {map}
                  </button>
                ))}
              </div>
              <p className="veto-pool-note">
                <CircleHelp size={14} /> O pool pode variar entre torneios.
                Ajuste os mapas conforme o evento que quer simular. As imagens
                carregam pela internet; sem conexão, os cards usam fundos
                coloridos.
              </p>
            </div>
          </div>
          <div className="veto-setup-footer">
            <span>
              <ShieldCheck size={15} /> Formato VCT 2026 · escolha todas as
              ações dos dois times
            </span>
            <button
              className="button button-primary"
              disabled={pool.length !== 7}
              onClick={start}
            >
              Começar simulação <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <div className="veto-simulation-layout">
          <div className="veto-main-column">
            <div className="panel veto-board">
              <div className="veto-board-top">
                <div>
                  <span className="eyebrow">
                    {format.toUpperCase()} · {teamNames.A} VS {teamNames.B}
                  </span>
                  <h2>
                    {complete ? 'Veto concluído' : 'Sequência do map veto'}
                  </h2>
                </div>
                <div className="veto-progress">
                  <span>
                    {history.length} / {steps.length}
                  </span>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(history.length / steps.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              {currentStep && (
                <div
                  className="veto-turn-card"
                  key={`${history.length}-${currentStep.kind}`}
                >
                  <div className="veto-turn-number">
                    ETAPA {history.length + 1}
                  </div>
                  <div className="veto-turn-heading">
                    <div>
                      <span className="veto-turn-kicker">
                        {currentStep.kind === 'ban'
                          ? 'BANIMENTO'
                          : currentStep.kind === 'pick'
                            ? 'MAP PICK'
                            : 'LADO'}
                      </span>
                      <h3>{stepTitle(currentStep)}</h3>
                    </div>
                    <div className={`veto-team-badge team-${currentStep.team}`}>
                      <span>
                        {currentStep.team === myTeam
                          ? 'SUA EQUIPE'
                          : 'OUTRA EQUIPE'}
                      </span>
                      <strong>{teamNames[currentStep.team]}</strong>
                    </div>
                  </div>
                  {currentStep.kind === 'side' ? (
                    <div className="veto-choice-grid sides">
                      <button onClick={() => choose('Ataque')}>
                        <Swords size={18} />
                        <strong>Ataque</strong>
                        <span>Começar no lado atacante</span>
                      </button>
                      <button onClick={() => choose('Defesa')}>
                        <ShieldCheck size={18} />
                        <strong>Defesa</strong>
                        <span>Começar no lado defensor</span>
                      </button>
                    </div>
                  ) : (
                    <div className="veto-choice-grid maps">
                      {remainingMaps.map((map, index) => {
                        const stat = statsByMap.get(map);
                        const hasDecisions = stat && stat.decisions > 0;
                        return (
                          <button
                            key={map}
                            className={`veto-map-choice map-tone-${index % 5} ${mapArtwork[map] ? 'has-map-art' : ''}`}
                            style={
                              mapArtwork[map]
                                ? {
                                    backgroundImage: `linear-gradient(180deg, rgba(8, 14, 24, .25) 0%, rgba(8, 14, 24, .52) 38%, rgba(8, 14, 24, .96) 100%), url("${mapArtwork[map]}")`,
                                  }
                                : undefined
                            }
                            onClick={() => choose(map)}
                          >
                            <div className="veto-map-badges-row">
                              {hasDecisions ? (
                                stat.winrate >= 60 ? (
                                  <span
                                    className="veto-map-badge favor"
                                    title={`${stat.wins}V - ${stat.losses}D em scrims/partidas`}
                                  >
                                    ⭐ {Math.round(stat.winrate)}% WR
                                  </span>
                                ) : stat.winrate <= 40 ? (
                                  <span
                                    className="veto-map-badge ban-tip"
                                    title={`${stat.wins}V - ${stat.losses}D em scrims/partidas`}
                                  >
                                    Ban ({Math.round(stat.winrate)}%)
                                  </span>
                                ) : (
                                  <span
                                    className="veto-map-badge neutral"
                                    title={`${stat.wins}V - ${stat.losses}D em scrims/partidas`}
                                  >
                                    {Math.round(stat.winrate)}% WR
                                  </span>
                                )
                              ) : (
                                <span className="veto-map-badge neutral">
                                  Sem dados
                                </span>
                              )}
                            </div>
                            <span className="veto-map-index">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <strong>{map}</strong>
                            <span className="veto-choice-verb">
                              {currentStep.kind === 'ban' ? (
                                <>
                                  <Ban size={13} /> Banir mapa
                                </>
                              ) : (
                                <>
                                  <ArrowRight size={13} /> Escolher mapa
                                </>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {complete && (
                <div className="veto-complete-banner">
                  <Check size={18} />
                  <div>
                    <strong>Map veto finalizado</strong>
                    <span>
                      Confira a ordem de mapas e lados na coluna lateral.
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="button button-primary button-small"
                      onClick={copyVetoToDiscord}
                    >
                      <Copy size={14} /> Copiar p/ Discord
                    </button>
                    <button
                      className="button button-secondary button-small"
                      onClick={reset}
                    >
                      <RotateCcw size={14} /> Nova simulação
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="panel veto-history-panel">
              <div className="panel-heading">
                <div>
                  <h2>Histórico de decisões</h2>
                  <p>Cada ação aparece na ordem em que foi escolhida.</p>
                </div>
                <button
                  className="icon-button"
                  disabled={!history.length}
                  title="Desfazer última ação"
                  onClick={undo}
                >
                  <RotateCcw size={15} />
                </button>
              </div>
              {history.length ? (
                <div className="veto-history-list">
                  {history.map((item, index) => (
                    <div
                      className="veto-history-item"
                      key={`${index}-${item.kind}-${item.map}`}
                    >
                      <span className={`history-step-icon ${item.kind}`}>
                        {item.kind === 'ban' ? (
                          <Ban size={14} />
                        ) : item.kind === 'pick' ? (
                          <MapIcon size={14} />
                        ) : (
                          <Swords size={14} />
                        )}
                      </span>
                      <span className="history-order">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="history-team">
                        <strong>{teamNames[item.team]}</strong>
                        <small>
                          {item.kind === 'ban'
                            ? 'BANIU'
                            : item.kind === 'pick'
                              ? `PICKOU MAPA ${item.slot}`
                              : `ESCOLHEU LADO · ${item.map}`}
                        </small>
                      </span>
                      <strong className="history-choice">
                        {item.kind === 'side'
                          ? `${item.side} · ${item.map}`
                          : item.map}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="veto-history-empty">
                  <MapIcon size={21} />
                  <span>Suas decisões vão aparecer aqui.</span>
                </div>
              )}
            </div>
          </div>
          <aside className="panel veto-series-panel">
            <div className="panel-heading">
              <div>
                <h2>Ordem da série</h2>
                <p>Mapas definidos até agora</p>
              </div>
            </div>
            <div className="veto-series-list">
              {Array.from(
                { length: format === 'bo1' ? 1 : format === 'bo3' ? 3 : 5 },
                (_, index) => {
                  const mapItem = pickedMaps.find(
                    (item) => item.slot === index + 1
                  );
                  const finalMap =
                    index === (format === 'bo1' ? 0 : format === 'bo3' ? 2 : 4)
                      ? remainingMaps.length === 1
                        ? remainingMaps[0]
                        : ''
                      : '';
                  const map = mapItem?.map || finalMap;
                  const sideItem = history.find(
                    (item) => item.kind === 'side' && item.slot === index + 1
                  );
                  const selectorTeam = sideItem?.team;
                  const startingSide = sideItem?.side;
                  const isDecider =
                    format === 'bo1' || index === (format === 'bo3' ? 2 : 4);
                  return (
                    <div
                      className={`veto-series-map ${map ? 'revealed' : ''}`}
                      key={index}
                    >
                      <span className="series-map-index">
                        {format === 'bo1'
                          ? 'MAPA DECISIVO (MD1)'
                          : isDecider
                            ? `MAPA ${index + 1} · DECIDER`
                            : `MAPA ${index + 1}`}
                      </span>
                      <strong>{map || 'A definir'}</strong>
                      {map && (
                        <span className="series-map-side">
                          {startingSide
                            ? `${teamNames[selectorTeam]} começa ${startingSide.toLowerCase()}`
                            : 'Lado ainda não escolhido'}
                        </span>
                      )}
                    </div>
                  );
                }
              )}
            </div>
            <div className="veto-legend">
              <span>
                <i className="legend-ban" /> Banido
              </span>
              <span>
                <i className="legend-pick" /> Pick
              </span>
              <span>
                <i className="legend-decider" /> Decider
              </span>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

