export function MetricCard({ icon: Icon, label, value, detail, accent }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${accent}`}>
        <Icon size={18} />
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
      <div className={`metric-accent-line ${accent}`} />
    </div>
  );
}
