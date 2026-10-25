/**
 * Verifica se um mapa ou agente está em uso por alguma partida, lineup, tático ou gameplan.
 *
 * @param {Object} data - Estado global dos dados.
 * @param {{ type: 'map' | 'agent', id: string, name: string }} target
 * @returns {boolean}
 */
export function isCatalogItemInUse(data, { type, id, name }) {
  if (!data) return false;
  const isMap = type === 'map';

  if (isMap) {
    return ['vods', 'lineups', 'tactics', 'gameplans'].some((key) =>
      (data[key] || []).some(
        (item) => item.mapId === id || (!item.mapId && item.map === name)
      )
    );
  }

  return ['vods', 'lineups', 'gameplans'].some((key) =>
    (data[key] || []).some(
      (item) =>
        item.agentId === id ||
        (!item.agentId && item.agent === name) ||
        item.agentIds?.includes(id) ||
        item.agents?.includes(name)
    )
  );
}

/**
 * Propaga a renomeação de um mapa ou agente em cascata para vods, lineups, táticos e gameplans.
 * Função pura: não muta os dados recebidos e devolve uma nova estrutura.
 *
 * @param {Object} data - Objeto de estado completo.
 * @param {{ isAgent: boolean, oldName: string, record: { id: string, name: string } }} param1
 * @returns {Object} Novo objeto de estado com referências atualizadas.
 */
export function cascadeRenameCatalogItem(data, { isAgent, oldName, record }) {
  if (!data || !oldName || !record || oldName === record.name) {
    return data;
  }

  const field = isAgent ? 'agent' : 'map';
  const idField = isAgent ? 'agentId' : 'mapId';
  const collections = ['vods', 'lineups', 'tactics', 'gameplans'];

  const next = { ...data };

  for (const key of collections) {
    if (!Array.isArray(data[key])) continue;

    next[key] = data[key].map((item) => {
      const isTarget =
        item[idField] === record.id ||
        (!item[idField] && item[field] === oldName);

      const hasArrayTarget =
        isAgent && Array.isArray(item.agents) && item.agents.includes(oldName);

      if (!isTarget && !hasArrayTarget) {
        return item;
      }

      return {
        ...item,
        ...(isTarget ? { [field]: record.name, [idField]: record.id } : {}),
        ...(hasArrayTarget
          ? {
              agents: item.agents.map((name) =>
                name === oldName ? record.name : name
              ),
            }
          : {}),
      };
    });
  }

  return next;
}

/**
 * Alterna a flag competitiveActive de um mapa de forma imutável.
 *
 * @param {Array} maps
 * @param {string} id
 * @returns {Array}
 */
export function toggleMapActive(maps, id) {
  if (!Array.isArray(maps)) return [];
  return maps.map((item) =>
    item.id === id
      ? { ...item, competitiveActive: !item.competitiveActive }
      : item
  );
}

/**
 * Alterna a flag active de um agente de forma imutável.
 *
 * @param {Array} agents
 * @param {string} id
 * @returns {Array}
 */
export function toggleAgentActive(agents, id) {
  if (!Array.isArray(agents)) return [];
  return agents.map((item) =>
    item.id === id ? { ...item, active: !item.active } : item
  );
}
