/**
 * Módulo de Apresentação e Integração com Discord
 * Gera relatórios formatados em Markdown para publicação em canais de scrim.
 */

export function formatDiscordReport(vod = {}) {
  const analysis = vod.analysisData || {};
  const stats = analysis.players_stats || {};
  const allKills = analysis.all_kills || [];
  const tactical = analysis.tactical_summary || vod.tactical_summary || null;

  const scoreFriendly = vod.roundsWon ?? analysis.final_score?.friendly ?? '?';
  const scoreEnemy = vod.roundsLost ?? analysis.final_score?.enemy ?? '?';
  const mapName = vod.map || 'Valorant';
  const resultLabel =
    vod.result ||
    (scoreFriendly > scoreEnemy
      ? 'Vitória'
      : scoreFriendly < scoreEnemy
        ? 'Derrota'
        : 'Empate');
  const resultEmoji =
    resultLabel === 'Vitória' ? '🏆' : resultLabel === 'Derrota' ? '❌' : '🤝';

  const sortedPlayers = Object.entries(stats).sort(
    (a, b) => (b[1].kills || 0) - (a[1].kills || 0)
  );
  const friendlyPlayers = sortedPlayers.filter(
    ([_, s]) => s.team === 'friendly'
  );
  const enemyPlayers = sortedPlayers.filter(([_, s]) => s.team === 'enemy');

  const topFragger = friendlyPlayers[0];
  const totalHs = allKills.filter(
    (k) => k.headshot && k.killer_team === 'friendly'
  ).length;
  const totalFk = allKills.filter(
    (k) => k.first_kill && k.killer_team === 'friendly'
  ).length;

  let text = `${resultEmoji} **RELATÓRIO DE SCRIM — KRING VLR**\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📍 **Mapa:** \`${mapName}\` | ⚔️ **Placar:** **${resultLabel}** (\`${scoreFriendly} × ${scoreEnemy}\`)\n`;
  if (vod.title) text += `🎯 **Treino:** *${vod.title}*\n`;
  text += `\n`;

  if (topFragger) {
    text += `🔥 **MVP Aliado:** **${topFragger[0]}** (${topFragger[1].agent || '—'}) — **${topFragger[1].kills}K** / **${topFragger[1].deaths}D** (KD: \`${topFragger[1].kd_ratio}x\`)\n`;
  }
  if (totalFk > 0 || totalHs > 0) {
    text += `⚡ **First Kills Aliados:** \`${totalFk}\` | 🎯 **Headshots:** \`${totalHs} HS\`\n`;
  }
  text += `\n`;

  const hasPlayerTactical = friendlyPlayers.some(
    ([_, s]) => s.kast_pct !== undefined || tactical?.player_tactical_stats?.[_]
  );

  if (friendlyPlayers.length > 0) {
    text += `👥 **Estatísticas do Time (Aliados):**\n\`\`\`\n`;
    if (hasPlayerTactical) {
      text += `JOGADOR          AGENTE       K / D     KAST%   TRADES   CLUTCH  HS%\n`;
      text += `--------------------------------------------------------------------\n`;
      friendlyPlayers.forEach(([name, s]) => {
        const pTact = tactical?.player_tactical_stats?.[name] || {};
        const kast = s.kast_pct ?? pTact.kast_pct ?? '—';
        const kastStr = typeof kast === 'number' ? `${kast}%`.padEnd(7, ' ') : `${kast}`.padEnd(7, ' ');
        const tK = s.trade_kills ?? pTact.trade_kills ?? 0;
        const tD = s.traded_deaths ?? pTact.traded_deaths ?? 0;
        const tradesStr = `${tK}/${tD}`.padEnd(8, ' ');
        const cl = s.clutches_won ?? pTact.clutches_won ?? 0;
        const clStr = `${cl}`.padEnd(7, ' ');
        const pName = name.padEnd(16, ' ').slice(0, 16);
        const pAgent = (s.agent || '—').padEnd(12, ' ').slice(0, 12);
        const pKd = `${s.kills}/${s.deaths}`.padEnd(9, ' ');
        const pHs = `${s.headshot_rate}%`;
        text += `${pName} ${pAgent} ${pKd} ${kastStr} ${tradesStr} ${clStr} ${pHs}\n`;
      });
    } else {
      text += `JOGADOR          AGENTE       K / D     K/D      HS%\n`;
      text += `----------------------------------------------------\n`;
      friendlyPlayers.forEach(([name, s]) => {
        const pName = name.padEnd(16, ' ').slice(0, 16);
        const pAgent = (s.agent || '—').padEnd(12, ' ').slice(0, 12);
        const pKd = `${s.kills}/${s.deaths}`.padEnd(9, ' ');
        const pRatio = `${s.kd_ratio}x`.padEnd(8, ' ');
        const pHs = `${s.headshot_rate}%`;
        text += `${pName} ${pAgent} ${pKd} ${pRatio} ${pHs}\n`;
      });
    }
    text += `\`\`\`\n`;
  }

  if (tactical) {
    const fbFriendly = tactical.first_blood_conversion?.friendly;
    const recFriendly = tactical.man_disadvantage_recovery?.friendly;
    const tradeEff = tactical.team_trade_efficiency?.friendly;
    const clutches = tactical.clutches || [];

    text += `📊 **Desempenho Tático da Equipe:**\n`;
    if (fbFriendly) {
      text += `• **Conversão 5v4 (First Blood):** \`${fbFriendly.rate}%\` (${fbFriendly.fb_rounds_won}/${fbFriendly.fb_rounds_total} rounds convertidos)\n`;
    }
    if (recFriendly) {
      text += `• **Recuperação 4v5 (Desvantagem):** \`${recFriendly.rate}%\` (${recFriendly.recovery_rounds_won}/${recFriendly.recovery_rounds_total} viradas)\n`;
    }
    if (tradeEff) {
      text += `• **Eficiência de Trades:** \`${tradeEff.rate}%\` (${tradeEff.traded_deaths}/${tradeEff.total_deaths} mortes vingadas)\n`;
    }

    if (clutches.length > 0) {
      const friendlyClutches = clutches.filter((c) => c.team === 'friendly');
      if (friendlyClutches.length > 0) {
        text += `🔥 **Clutches Vencidos:** ${friendlyClutches.map((c) => `\`${c.label} por ${c.player} (R${String(c.round).padStart(2, '0')})\``).join(', ')}\n`;
      }
    }
    text += `\n`;
  }

  if (enemyPlayers.length > 0) {
    text += `💀 **Top Adversários:**\n\`\`\`\n`;
    enemyPlayers.slice(0, 3).forEach(([name, s]) => {
      text += `• ${name} (${s.agent || '—'}): ${s.kills}K / ${s.deaths}D (${s.kd_ratio}x)\n`;
    });
    text += `\`\`\`\n`;
  }

  text += `*Gerado pelo painel Kring VLR*`;
  return text;
}
