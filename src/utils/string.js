/**
 * Calcula a distância de Levenshtein entre duas strings para comparação aproximada de nicks.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const strA = typeof a === 'string' ? a : '';
  const strB = typeof b === 'string' ? b : '';

  if (strA === strB) return 0;
  if (!strA) return strB.length;
  if (!strB) return strA.length;

  const matrix = [];
  for (let i = 0; i <= strB.length; i++) matrix[i] = [i];
  for (let j = 0; j <= strA.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= strB.length; i++) {
    for (let j = 1; j <= strA.length; j++) {
      if (strB.charAt(i - 1) === strA.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[strB.length][strA.length];
}

/**
 * Converte nomes de categoria de treino em identificadores de classe CSS seguros (slug).
 * Exemplo: "Mira / Mecânica" -> "mira-mecanica"
 *
 * @param {string|null|undefined} category
 * @param {string} [defaultCategory='Mecânica']
 * @returns {string}
 */
export function slugifyCategory(category, defaultCategory = 'Mecânica') {
  const raw = (category || defaultCategory || '').trim().toLowerCase();
  return raw.replace(/[\s/]+/g, '-');
}

/**
 * Normaliza links de VODs e referências adicionando protocolo https quando omitido.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?(youtube\.com|youtu\.be|twitch\.tv)\//i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}

/**
 * Gera um identificador único simples para novos registros locais.
 *
 * @returns {string}
 */
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Remove o caractere invisível BOM UTF-8 (\uFEFF) do início da string se presente.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function stripUtf8Bom(value) {
  if (typeof value !== 'string') return '';
  if (value.charCodeAt(0) === 0xfeff) {
    return value.slice(1);
  }
  return value;
}

/**
 * Normaliza apelidos para comparação insensível a caixa, acentos e espaços.
 * Exemplo: "Team Player1" -> "teamplayer1"
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function cleanNick(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

