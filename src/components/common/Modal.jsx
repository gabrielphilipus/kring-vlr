import { X } from 'lucide-react';
import { useKeyPress } from '../../hooks/useKeyPress.js';

export function Modal({ title, subtitle, onClose, children }) {
  useKeyPress('Escape', onClose);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
