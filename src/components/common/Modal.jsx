import { X } from 'lucide-react';
import { useKeyPress } from '../../hooks/useKeyPress.js';

export function Modal({
  title,
  subtitle,
  onClose,
  closeOnBackdrop = false,
  closeOnEscape = true,
  children,
}) {
  useKeyPress(
    'Escape',
    () => {
      const tagName = document.activeElement?.tagName || '';
      if (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        document.activeElement?.isContentEditable
      ) {
        return;
      }
      onClose();
    },
    closeOnEscape
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
