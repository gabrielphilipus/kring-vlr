import { useMemo, useState } from 'react';
import {
  Crosshair,
  Map as MapIcon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { AGENT_ROLES } from '../../constants/game.js';

export function CatalogManager({
  maps,
  agents,
  vods = [],
  lineups = [],
  tactics = [],
  gameplans = [],
  onAddMap,
  onAddAgent,
  onEditMap,
  onEditAgent,
  onDeleteMap,
  onDeleteAgent,
  onToggleMap,
  onToggleAgent,
  onRestoreDefaults,
}) {
  const [tab, setTab] = useState('maps');
  const [search, setSearch] = useState('');
  const [mapStatusFilter, setMapStatusFilter] = useState('Todos');
  const [agentRoleFilter, setAgentRoleFilter] = useState('Todas');
  const [agentStatusFilter, setAgentStatusFilter] = useState('Todos');

  // Competitive Pool Stats
  const activeCompetitiveMaps = useMemo(
    () => maps.filter((m) => m.competitiveActive),
    [maps]
  );
  const activeCompetitiveCount = activeCompetitiveMaps.length;

  // Usage Map for Maps
  const mapUsage = useMemo(() => {
    const map = new Map();
    maps.forEach((m) => {
      const v = vods.filter(
        (vod) => vod.mapId === m.id || vod.map === m.name
      ).length;
      const l = lineups.filter(
        (lineup) => lineup.mapId === m.id || lineup.map === m.name
      ).length;
      const t = tactics.filter(
        (tactic) => tactic.mapId === m.id || tactic.map === m.name
      ).length;
      const g = gameplans.filter(
        (plan) => plan.mapId === m.id || plan.map === m.name
      ).length;
      map.set(m.id, { v, l, t, g, total: v + l + t + g });
    });
    return map;
  }, [maps, vods, lineups, tactics, gameplans]);

  // Usage Map for Agents
  const agentUsage = useMemo(() => {
    const map = new Map();
    agents.forEach((a) => {
      const v = vods.filter(
        (vod) => vod.agentId === a.id || vod.agent === a.name
      ).length;
      const l = lineups.filter(
        (lineup) => lineup.agentId === a.id || lineup.agent === a.name
      ).length;
      const g = gameplans.filter(
        (plan) =>
          (plan.agentIds || []).includes(a.id) ||
          (plan.agents || []).includes(a.name)
      ).length;
      map.set(a.id, { v, l, g, total: v + l + g });
    });
    return map;
  }, [agents, vods, lineups, gameplans]);

  // Role Counts for Filter Chips
  const roleCounts = useMemo(() => {
    const counts = { Todas: agents.length };
    AGENT_ROLES.forEach((r) => {
      counts[r] = 0;
    });
    agents.forEach((a) => {
      if (counts[a.role] !== undefined) counts[a.role] += 1;
    });
    return counts;
  }, [agents]);

  // Filtered Maps
  const filteredMaps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return maps
      .filter((map) => {
        if (q && !map.name.toLowerCase().includes(q)) return false;
        if (mapStatusFilter === 'No competitivo' && !map.competitiveActive)
          return false;
        if (mapStatusFilter === 'Inativos' && map.competitiveActive)
          return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [maps, search, mapStatusFilter]);

  // Filtered Agents
  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents
      .filter((agent) => {
        if (q && !agent.name.toLowerCase().includes(q)) return false;
        if (agentRoleFilter !== 'Todas' && agent.role !== agentRoleFilter)
          return false;
        if (agentStatusFilter === 'Ativos' && !agent.active) return false;
        if (agentStatusFilter === 'Inativos' && agent.active) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, search, agentRoleFilter, agentStatusFilter]);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setSearch('');
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CATÁLOGO DO JOGO</div>
          <h1>Mapas e agentes</h1>
          <p>
            Gerencie o pool competitivo e agentes disponíveis nos seletores,
            simulador de veto e táticos. Cadastros inativos continuam associados
            ao histórico.
          </p>
        </div>
      </div>

      <div className="catalog-header-row">
        <div className="catalog-tabs">
          <button
            className={tab === 'maps' ? 'active' : ''}
            onClick={() => handleTabChange('maps')}
          >
            <MapIcon size={16} /> Mapas <span>{maps.length}</span>
          </button>
          <button
            className={tab === 'agents' ? 'active' : ''}
            onClick={() => handleTabChange('agents')}
          >
            <Crosshair size={16} /> Agentes <span>{agents.length}</span>
          </button>
        </div>

        <div className="catalog-global-actions">
          {onRestoreDefaults && (
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={onRestoreDefaults}
              title="Adiciona mapas e agentes oficiais ausentes sem remover itens personalizados"
            >
              <RotateCcw size={14} /> Restaurar catálogo padrão
            </button>
          )}
          {tab === 'maps' ? (
            <button
              className="button button-primary button-small"
              onClick={onAddMap}
            >
              <Plus size={15} /> Adicionar mapa
            </button>
          ) : (
            <button
              className="button button-primary button-small"
              onClick={onAddAgent}
            >
              <Plus size={15} /> Adicionar agente
            </button>
          )}
        </div>
      </div>

      {tab === 'maps' ? (
        <>
          <div
            className={`vct-pool-banner ${activeCompetitiveCount === 7 ? 'optimal' : activeCompetitiveCount < 7 ? 'warning' : 'info'}`}
          >
            <div className="vct-pool-info">
              <div className="vct-pool-title">
                <Trophy size={16} />
                <strong>
                  Pool Competitivo: {activeCompetitiveCount} de 7 mapas ativos
                </strong>
                <span
                  className={`vct-pool-pill ${activeCompetitiveCount === 7 ? 'optimal' : activeCompetitiveCount < 7 ? 'warning' : 'info'}`}
                >
                  {activeCompetitiveCount === 7
                    ? '✓ Padrão VCT Oficial'
                    : activeCompetitiveCount < 7
                      ? `Faltam ${7 - activeCompetitiveCount} no pool`
                      : `${activeCompetitiveCount - 7} acima do VCT`}
                </span>
              </div>
              <p>
                {activeCompetitiveCount === 7
                  ? 'Configuração ideal: a rotação de 7 mapas atende exatamente ao regulamento oficial do VCT para MD1, MD3 e MD5.'
                  : activeCompetitiveCount < 7
                    ? 'Atenção: o formato oficial de torneios VCT requer 7 mapas ativos para o processo de vetos (bans alternados).'
                    : 'Mais de 7 mapas estão ativos. O simulador de veto e seletores incluirão todos os mapas com status ativo.'}
              </p>
            </div>
          </div>

          <div className="catalog-toolbar">
            <div className="search-box catalog-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar mapa..."
              />
              {search && (
                <button
                  type="button"
                  className="icon-button button-micro"
                  onClick={() => setSearch('')}
                  title="Limpar busca"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="catalog-filter-group">
              <span className="filter-label">Status:</span>
              <div className="filter-chip-row">
                {['Todos', 'No competitivo', 'Inativos'].map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`filter-chip ${mapStatusFilter === status ? 'active' : ''}`}
                    onClick={() => setMapStatusFilter(status)}
                  >
                    {status}
                    <span className="chip-count">
                      {status === 'Todos'
                        ? maps.length
                        : status === 'No competitivo'
                          ? activeCompetitiveCount
                          : maps.length - activeCompetitiveCount}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredMaps.length === 0 ? (
            <div className="empty-state">
              <MapIcon size={36} />
              <h3>Nenhum mapa encontrado</h3>
              <p>Tente ajustar a busca ou o filtro de status.</p>
              {(search || mapStatusFilter !== 'Todos') && (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => {
                    setSearch('');
                    setMapStatusFilter('Todos');
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="catalog-grid">
              {filteredMaps.map((map) => {
                const u = mapUsage.get(map.id) || {
                  v: 0,
                  l: 0,
                  t: 0,
                  g: 0,
                  total: 0,
                };
                return (
                  <article
                    className={`panel catalog-card ${map.competitiveActive ? '' : 'is-inactive'}`}
                    key={map.id}
                  >
                    <div className="catalog-media map-media">
                      {map.previewUrl ? (
                        <img
                          src={map.previewUrl}
                          alt={`Preview de ${map.name}`}
                        />
                      ) : (
                        <MapIcon size={26} />
                      )}
                    </div>
                    <div className="catalog-card-body">
                      <div className="catalog-title-row">
                        <strong>{map.name}</strong>
                        <span
                          className={`catalog-status ${map.competitiveActive ? 'active' : ''}`}
                        >
                          {map.competitiveActive ? 'No competitivo' : 'Inativo'}
                        </span>
                      </div>

                      <div
                        className="catalog-usage-info"
                        title={`${u.v} VODs, ${u.l} Lineups, ${u.t} Táticos, ${u.g} Gameplans`}
                      >
                        {u.total > 0 ? (
                          <span>
                            <strong>{u.total}</strong> em uso ({u.v}V · {u.l}L ·{' '}
                            {u.t}T · {u.g}G)
                          </span>
                        ) : (
                          <span className="text-muted">
                            Sem registros vinculados
                          </span>
                        )}
                      </div>

                      <div className="catalog-actions">
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          onClick={() => onToggleMap(map)}
                        >
                          {map.competitiveActive ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="Editar mapa"
                          onClick={() => onEditMap(map)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          title={
                            u.total > 0
                              ? `Em uso em ${u.total} registro(s). Desative para remover dos novos seletores.`
                              : 'Excluir mapa'
                          }
                          onClick={() => onDeleteMap(map.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="catalog-toolbar agents-toolbar">
            <div className="search-box catalog-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar agente por nome..."
              />
              {search && (
                <button
                  type="button"
                  className="icon-button button-micro"
                  onClick={() => setSearch('')}
                  title="Limpar busca"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="catalog-filter-group">
              <span className="filter-label">Função:</span>
              <div className="filter-chip-row">
                {['Todas', ...AGENT_ROLES].map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={`filter-chip ${agentRoleFilter === role ? 'active' : ''} ${role !== 'Todas' ? `role-${role.toLowerCase()}` : ''}`}
                    onClick={() => setAgentRoleFilter(role)}
                  >
                    {role}
                    <span className="chip-count">{roleCounts[role] || 0}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="catalog-filter-group">
              <span className="filter-label">Status:</span>
              <div className="filter-chip-row">
                {['Todos', 'Ativos', 'Inativos'].map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`filter-chip ${agentStatusFilter === status ? 'active' : ''}`}
                    onClick={() => setAgentStatusFilter(status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredAgents.length === 0 ? (
            <div className="empty-state">
              <Crosshair size={36} />
              <h3>Nenhum agente encontrado</h3>
              <p>Tente ajustar a busca por nome ou a classe selecionada.</p>
              {(search ||
                agentRoleFilter !== 'Todas' ||
                agentStatusFilter !== 'Todos') && (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => {
                    setSearch('');
                    setAgentRoleFilter('Todas');
                    setAgentStatusFilter('Todos');
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="catalog-grid agents-catalog-grid">
              {filteredAgents.map((agent) => {
                const u = agentUsage.get(agent.id) || {
                  v: 0,
                  l: 0,
                  g: 0,
                  total: 0,
                };
                const roleClass = agent.role
                  ? `role-tag-${agent.role.toLowerCase()}`
                  : '';
                return (
                  <article
                    className={`panel catalog-card agent-catalog-card ${agent.active ? '' : 'is-inactive'}`}
                    key={agent.id}
                  >
                    <div className="catalog-agent-top">
                      <div className="catalog-agent-icon">
                        {agent.iconUrl ? (
                          <img src={agent.iconUrl} alt="" />
                        ) : (
                          <Crosshair size={22} />
                        )}
                      </div>
                      <span className={`agent-role-pill ${roleClass}`}>
                        {agent.role}
                      </span>
                    </div>

                    <div className="catalog-card-body">
                      <div className="catalog-title-row">
                        <strong>{agent.name}</strong>
                        <span
                          className={`catalog-status ${agent.active ? 'active' : ''}`}
                        >
                          {agent.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>

                      <div
                        className="catalog-usage-info"
                        title={`${u.v} VODs, ${u.l} Lineups, ${u.g} Gameplans`}
                      >
                        {u.total > 0 ? (
                          <span>
                            <strong>{u.total}</strong> em uso ({u.v}V · {u.l}L ·{' '}
                            {u.g}G)
                          </span>
                        ) : (
                          <span className="text-muted">
                            Sem registros vinculados
                          </span>
                        )}
                      </div>

                      <div className="catalog-actions">
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          onClick={() => onToggleAgent(agent)}
                        >
                          {agent.active ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="Editar agente"
                          onClick={() => onEditAgent(agent)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          title={
                            u.total > 0
                              ? `Em uso em ${u.total} registro(s). Desative para remover dos novos seletores.`
                              : 'Excluir agente'
                          }
                          onClick={() => onDeleteAgent(agent.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
