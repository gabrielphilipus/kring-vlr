/**
 * Converte valor numérico flexível para number ou null.
 * Regra estrita idêntica à migração v4 (parseNullableNumber):
 * - null, undefined, string vazia ("") ou apenas espaços (" ") => null
 * - string não numérica ("abc") => null
 * - número finito => número preservado (inclusive decimais e 0)
 * - string numérica válida ("30", "1.5") => número convertido
 *
 * @param {any} val
 * @returns {number|null}
 */
export function toNumberOrNull(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Converte valor numérico flexível para number ou null com limite inferior em 0.
 *
 * @param {any} val
 * @returns {number|null}
 */
export function toNonNegativeNumberOrNull(val) {
  const num = toNumberOrNull(val);
  return num === null ? null : Math.max(0, num);
}
