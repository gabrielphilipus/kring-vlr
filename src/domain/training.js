/**
 * Alterna o status concluído (done) de um item de treino de forma imutável.
 *
 * @param {Array} training - Lista de itens de treino.
 * @param {string} id - ID do item a alternar.
 * @returns {Array} Nova lista de treinos.
 */
export function toggleTrainingItem(training, id) {
  if (!Array.isArray(training)) return [];
  return training.map((row) =>
    row.id === id ? { ...row, done: !row.done } : row
  );
}

/**
 * Marca ou desmarca todos os itens de uma semana específica em lote de forma imutável.
 *
 * @param {Array} training - Lista de itens de treino.
 * @param {Array<{ id: string }>} weekItems - Itens pertencentes à semana.
 * @param {boolean} markDone - true para marcar todos, false para desmarcar.
 * @returns {Array} Nova lista de treinos.
 */
export function toggleTrainingWeekItems(training, weekItems, markDone) {
  if (!Array.isArray(training)) return [];
  if (!Array.isArray(weekItems) || !weekItems.length) return training;

  const targetIds = new Set(weekItems.map((item) => item.id));

  return training.map((row) =>
    targetIds.has(row.id) ? { ...row, done: markDone } : row
  );
}
