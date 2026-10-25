import { useEffect, useRef } from 'react';

/**
 * Escuta eventos de teclado globais no window para uma tecla específica.
 * Armazena o callback em useRef para garantir que a função mais recente
 * seja executada sem precisar reinstalar o event listener a cada render.
 *
 * @param {string} targetKey - Nome da tecla (ex.: 'Escape').
 * @param {(event: KeyboardEvent) => void} handler - Callback executado ao pressionar a tecla.
 * @param {boolean} [active=true] - Se o listener deve estar ativo.
 */
export function useKeyPress(targetKey, handler, active = true) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active || !targetKey) return;

    const onKeyDown = (event) => {
      if (event.key === targetKey) {
        handlerRef.current?.(event);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [targetKey, active]);
}
