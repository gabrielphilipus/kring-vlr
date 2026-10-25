/**
 * Formata um número em percentual com até 1 casa decimal (ex.: 50%, 66.7%).
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function percent(n) {
  const num = Number(n);
  if (Number.isNaN(num) || n == null) return '0%';
  return `${Math.round(num * 10) / 10}%`;
}

/**
 * Converte data no formato ISO (YYYY-MM-DD) para pt-BR (DD/MM/AAAA).
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatDate(value) {
  if (!value || typeof value !== 'string') return '—';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('pt-BR');
}

/**
 * Converte string de tempo ("MM:SS" ou "HH:MM:SS") em segundos totais.
 *
 * @param {string|null|undefined} str
 * @returns {number}
 */
export function parseTimeToSeconds(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Converte segundos em formato MM:SS.
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
export function formatSeconds(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Retorna a data local de hoje no formato YYYY-MM-DD.
 *
 * @returns {string}
 */
export function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
