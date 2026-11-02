/**
 * Copia um texto para a área de transferência com fallback para navegadores/contextos
 * onde navigator.clipboard não está disponível ou é rejeitado por permissões.
 *
 * @param {string} text - O texto a ser copiado.
 * @returns {Promise<boolean>} true se copiado com sucesso, false caso contrário.
 */
export async function copyToClipboard(text) {
  if (typeof text !== 'string') return false;

  // 1. Tentar API moderna assíncrona do Clipboard
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falha de permissão ou contexto; segue para o fallback abaixo
  }

  // 2. Fallback síncrono via textarea invisível + document.execCommand('copy')
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(success);
  } catch {
    return false;
  }
}
