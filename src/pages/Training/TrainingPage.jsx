import { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Copy,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState.jsx';
import { TRAINING_CATEGORIES } from '../../constants/training.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import { formatDate, today } from '../../utils/formatters.js';
import { slugifyCategory } from '../../utils/string.js';

export function TrainingPage({
  training,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onToggleAllWeek,
  onToast,
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [statusFilter, setStatusFilter] = useState('Todos');

  const weekKey = (date) => {
    const d = new Date(`${date || today()}T12:00:00`);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  };

  const currentWeekMonday = useMemo(() => weekKey(today()), []);

  // Overall KPIs
  const totalCount = training.length;
  const completedCount = training.filter((t) => t.done).length;
  const totalMinutes = training.reduce(
    (sum, t) => sum + (Number(t.minutes) || 0),
    0
  );
  const completedMinutes = training
    .filter((t) => t.done)
    .reduce((sum, t) => sum + (Number(t.minutes) || 0), 0);
  const overallPercent = totalCount
    ? Math.round((completedCount / totalCount) * 100)
    : 0;

  // Current week KPIs
  const currentWeekItems = useMemo(
    () => training.filter((t) => weekKey(t.week) === currentWeekMonday),
    [training, currentWeekMonday]
  );
  const currentWeekDone = currentWeekItems.filter((t) => t.done).length;
  const currentWeekMin = currentWeekItems.reduce(
    (sum, t) => sum + (Number(t.minutes) || 0),
    0
  );
  const currentWeekPercent = currentWeekItems.length
    ? Math.round((currentWeekDone / currentWeekItems.length) * 100)
    : 0;

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = { Todas: training.length };
    TRAINING_CATEGORIES.forEach((c) => {
      counts[c] = 0;
    });
    training.forEach((t) => {
      const c = t.category || 'Mecânica';
      if (counts[c] !== undefined) counts[c] += 1;
    });
    return counts;
  }, [training]);

  // Filtered Items
  const filteredTraining = useMemo(() => {
    const q = search.trim().toLowerCase();
    return training.filter((item) => {
      if (
        q &&
        ![item.title, item.category, item.notes].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(q)
        )
      ) {
        return false;
      }
      if (
        categoryFilter !== 'Todas' &&
        (item.category || 'Mecânica') !== categoryFilter
      ) {
        return false;
      }
      if (statusFilter === 'Pendentes' && item.done) return false;
      if (statusFilter === 'Concluídos' && !item.done) return false;
      return true;
    });
  }, [training, search, categoryFilter, statusFilter]);

  // Group by week
  const grouped = useMemo(() => {
    const map = new Map();
    filteredTraining.forEach((item) => {
      const key = weekKey(item.week);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }, [filteredTraining]);

  const copyWeekToDiscord = async (week, items) => {
    const doneCount = items.filter((i) => i.done).length;
    const totalMin = items.reduce(
      (acc, i) => acc + (Number(i.minutes) || 0),
      0
    );
    const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

    const lines = [
      `🎯 **KRING VLR — Rotina de Treino (Semana de ${formatDate(week)})**`,
      `Progresso: ${doneCount}/${items.length} concluídos (${pct}%) • ${totalMin} min totais`,
      '',
      ...items.map((item) => {
        const box = item.done ? '[x]' : '[ ]';
        const cat = item.category ? `[${item.category}] ` : '';
        const min = item.minutes ? ` (${item.minutes} min)` : '';
        const notes = item.notes ? ` — _${item.notes}_` : '';
        return `${box} ${cat}${item.title}${min}${notes}`;
      }),
      '',
      `_Gerado pelo KRING Valorant Analyzer_`,
    ];

    const ok = await copyToClipboard(lines.join('\n'));
    if (ok) {
      if (onToast) onToast('Rotina semanal copiada para o Discord!');
    } else {
      if (onToast) onToast('Falha ao copiar rotina.');
    }
  };

  const hasActiveFilters = Boolean(
    search || categoryFilter !== 'Todas' || statusFilter !== 'Todos'
  );

  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ROTINA DE EVOLUÇÃO</div>
          <h1>Treino individual</h1>
          <p>
            Monte seu plano semanal, acompanhe o tempo dedicado a mira,
            movimentação e VODs, e compartilhe sua rotina.
          </p>
        </div>
        <button className="button button-primary" onClick={onAdd}>
          <Plus size={17} /> Adicionar treino
        </button>
      </div>

      {training.length > 0 && (
        <div className="training-kpi-grid">
          <div className="training-kpi-card">
            <div className="kpi-icon-wrap blue">
              <Clock size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Tempo Total Dedicado</span>
              <strong>
                {totalMinutes} min{' '}
                <small>({(totalMinutes / 60).toFixed(1)}h)</small>
              </strong>
              <span>{completedMinutes} min em treinos concluídos</span>
            </div>
          </div>

          <div className="training-kpi-card">
            <div className="kpi-icon-wrap green">
              <Check size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Conclusão Geral</span>
              <strong>
                {overallPercent}%{' '}
                <small>
                  ({completedCount}/{totalCount})
                </small>
              </strong>
              <div className="kpi-progress-bar">
                <div
                  className="kpi-progress-fill"
                  style={{ width: `${overallPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="training-kpi-card">
            <div className="kpi-icon-wrap purple">
              <Activity size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Metas Desta Semana</span>
              <strong>
                {currentWeekItems.length
                  ? `${currentWeekDone}/${currentWeekItems.length}`
                  : '0 metas'}{' '}
                <small>({currentWeekPercent}%)</small>
              </strong>
              <span>
                {currentWeekMin
                  ? `${currentWeekMin} min planejados`
                  : 'Nenhum treino nesta semana'}
              </span>
            </div>
          </div>
        </div>
      )}

      {training.length > 0 && (
        <div className="training-toolbar">
          <div className="search-box training-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar exercício ou anotação..."
            />
            {search && (
              <button
                type="button"
                className="icon-button button-micro"
                onClick={() => setSearch('')}
                title="Limpar busca"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="training-filter-group">
            <span className="filter-label">Categoria:</span>
            <div className="filter-chip-row">
              {['Todas', ...TRAINING_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`filter-chip ${categoryFilter === cat ? 'active' : ''} ${cat !== 'Todas' ? `cat-chip-${slugifyCategory(cat)}` : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                  <span className="chip-count">{categoryCounts[cat] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="training-filter-group">
            <span className="filter-label">Status:</span>
            <div className="filter-chip-row">
              {['Todos', 'Pendentes', 'Concluídos'].map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`filter-chip ${statusFilter === status ? 'active' : ''}`}
                  onClick={() => setStatusFilter(status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {grouped.size ? (
        [...grouped.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([week, items]) => {
            const doneInWeek = items.filter((item) => item.done).length;
            const weekTotalMin = items.reduce(
              (acc, i) => acc + (Number(i.minutes) || 0),
              0
            );
            const weekPct = items.length
              ? Math.round((doneInWeek / items.length) * 100)
              : 0;
            const isAllDone = items.length > 0 && doneInWeek === items.length;
            const isCurrentWeek = week === currentWeekMonday;

            return (
              <div
                className={`panel training-week ${isCurrentWeek ? 'is-current-week' : ''}`}
                key={week}
              >
                <div className="training-week-header">
                  <div className="training-week-title-area">
                    <div className="training-week-headline">
                      <h2>Semana de {formatDate(week)}</h2>
                      {isCurrentWeek && (
                        <span className="current-week-badge">Semana Atual</span>
                      )}
                    </div>
                    <div className="training-week-meta">
                      <span>
                        <strong>{doneInWeek}</strong> de{' '}
                        <strong>{items.length}</strong> concluídos
                      </span>
                      <span>•</span>
                      <span>
                        <Clock size={12} /> {weekTotalMin} min de treino
                      </span>
                      <span>•</span>
                      <span
                        className={`week-pct-pill ${weekPct === 100 ? 'done' : ''}`}
                      >
                        {weekPct}%
                      </span>
                    </div>
                    <div className="training-progress-track">
                      <div
                        className={`training-progress-fill ${weekPct === 100 ? 'complete' : ''}`}
                        style={{ width: `${weekPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="training-week-actions">
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      onClick={() => copyWeekToDiscord(week, items)}
                      title="Copiar lista de treinos da semana formatada para o Discord"
                    >
                      <Copy size={13} /> Discord
                    </button>
                    {onToggleAllWeek && (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => onToggleAllWeek(items, !isAllDone)}
                        title={
                          isAllDone
                            ? 'Marcar todos os treinos como pendentes'
                            : 'Marcar todos os treinos da semana como concluídos'
                        }
                      >
                        <Check size={13} />{' '}
                        {isAllDone ? 'Desmarcar semana' : 'Concluir semana'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="training-list">
                  {items.map((item) => {
                    const catSlug = slugifyCategory(item.category);
                    return (
                      <div
                        className={`training-item ${item.done ? 'completed' : ''}`}
                        key={item.id}
                      >
                        <button
                          type="button"
                          className="training-check"
                          aria-label={
                            item.done
                              ? 'Marcar como pendente'
                              : 'Marcar como concluído'
                          }
                          onClick={() => onToggle(item)}
                          title={
                            item.done
                              ? 'Clique para marcar como pendente'
                              : 'Clique para marcar como concluído'
                          }
                        >
                          {item.done && <Check size={14} />}
                        </button>
                        <div className="training-copy">
                          <div className="training-title-row">
                            <strong>{item.title}</strong>
                            <span
                              className={`training-cat-badge cat-${catSlug}`}
                            >
                              {item.category || 'Mecânica'}
                            </span>
                            {item.minutes && (
                              <span className="training-min-badge">
                                <Clock size={11} /> {item.minutes} min
                              </span>
                            )}
                          </div>
                          {item.notes && (
                            <p className="training-notes">{item.notes}</p>
                          )}
                        </div>
                        <div className="training-item-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title="Editar treino"
                            onClick={() => onEdit(item)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Excluir treino"
                            onClick={() => onDelete(item.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
      ) : training.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Planeje sua semana de treinos"
          text="Adicione exercícios de mira, rotinas de mecânica, movimentação ou VOD reviews para evoluir de forma consistente."
          actionLabel="Adicionar primeiro treino"
          onAction={onAdd}
        />
      ) : (
        <div className="empty-state">
          <Activity size={36} />
          <h3>Nenhum treino encontrado</h3>
          <p>
            Tente ajustar o termo de busca ou filtros de categoria e status.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => {
                setSearch('');
                setCategoryFilter('Todas');
                setStatusFilter('Todos');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </section>
  );
}
