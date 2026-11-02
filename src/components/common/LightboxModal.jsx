import { X } from 'lucide-react';
import { useKeyPress } from '../../hooks/useKeyPress.js';

/**
 * Modal comum de exibição de imagens em tela cheia (Lineups e Táticos).
 * Mantém a estrutura de layout e classes CSS existentes, com backdrop
 * fechável por clique externo e atalho de tecla Escape via useKeyPress.
 *
 * @param {Object} props
 * @param {() => void} props.onClose - Callback disparado para fechar o modal.
 * @param {string} props.imageSrc - URL/Base64 da imagem ampliada.
 * @param {string} [props.imageAlt='Imagem ampliada'] - Texto alternativo da imagem.
 * @param {React.ReactNode} props.headerTitle - Área de kicker e título do header.
 * @param {React.ReactNode} [props.headerBadge] - Badge de lado ou status no header.
 * @param {React.ReactNode} [props.sidebar] - Conteúdo da barra lateral de instruções/ações.
 * @param {React.ReactNode} [props.children] - Conteúdo alternativo para a sidebar.
 */
export function LightboxModal({
  onClose,
  imageSrc,
  imageAlt = 'Imagem ampliada',
  headerTitle,
  headerBadge,
  sidebar,
  children,
}) {
  useKeyPress('Escape', onClose);

  return (
    <div
      className="modal-backdrop lineup-lightbox-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lineup-lightbox-card" role="dialog" aria-modal="true">
        <div className="lineup-lightbox-header">
          <div className="lineup-lightbox-title-area">{headerTitle}</div>
          <div className="lineup-lightbox-header-actions">
            {headerBadge}
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar modal de imagem"
              title="Fechar (Esc)"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="lineup-lightbox-body">
          <div className="lineup-lightbox-media">
            <img src={imageSrc} alt={imageAlt} />
          </div>
          <div className="lineup-lightbox-sidebar">{sidebar || children}</div>
        </div>
      </div>
    </div>
  );
}
