import { Plus } from 'lucide-react';

export function EmptyState({ icon: Icon, title, text, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={26} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="button button-primary" onClick={onAction}>
        <Plus size={16} /> {actionLabel}
      </button>
    </div>
  );
}
