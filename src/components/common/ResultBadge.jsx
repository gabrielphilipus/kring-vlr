export function ResultBadge({ result }) {
  const type =
    result === 'Vitória' ? 'win' : result === 'Derrota' ? 'loss' : 'draw';
  return (
    <span className={`result-badge ${type}`}>
      <span />
      {result || '—'}
    </span>
  );
}
