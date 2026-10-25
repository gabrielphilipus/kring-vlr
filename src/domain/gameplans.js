/**
 * Desvincula um gameplan excluído de todas as partidas (VODs) associadas,
 * definindo gameplanId como null de forma imutável.
 *
 * @param {Array} vods - Lista de partidas.
 * @param {string} gameplanId - ID do gameplan removido.
 * @returns {Array} Nova lista de partidas com gameplanId desvinculado.
 */
export function unlinkGameplanFromVods(vods, gameplanId) {
  if (!Array.isArray(vods)) return [];
  if (!gameplanId) return vods;

  return vods.map((vod) =>
    vod.gameplanId === gameplanId ? { ...vod, gameplanId: null } : vod
  );
}
