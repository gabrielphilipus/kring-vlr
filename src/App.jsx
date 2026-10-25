import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, BarChart3, BookOpen,
  Check, ChevronDown, CircleHelp, ClipboardPaste, Crosshair, ExternalLink, FileVideo2,
  Filter, FolderOpen, Gamepad2, LayoutDashboard, ListFilter, Map as MapIcon,
  Pencil, Plus, Search, ShieldCheck, Swords, Target, Trash2, Trophy,
  Upload, Video, X, Zap, RotateCcw, ArrowRight, Ban, Play, Clock, Sparkles,
} from 'lucide-react';


const AGENT_ROLES = ['Duelista', 'Iniciador', 'Controlador', 'Sentinela'];
const RESULTS = ['Vitória', 'Derrota', 'Empate'];
const ROUND_RESULTS = ['Pistol', 'Antieco', 'Bônus', 'Antieco 2', 'Primeiro armado'];
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'veto', label: 'Simulador de veto', icon: MapIcon },
  { id: 'vods', label: 'Biblioteca de VODs', icon: Video },
  { id: 'lineups', label: 'Lineups', icon: Target },
  { id: 'gameplans', label: 'Gameplans', icon: Swords },
  { id: 'catalogs', label: 'Mapas e agentes', icon: Crosshair },
  { id: 'tactics', label: 'Táticos', icon: BookOpen },
  { id: 'training', label: 'Treino individual', icon: Activity },
  { id: 'stats', label: 'Estatísticas', icon: BarChart3 },
];
const today = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const percent = (n) => `${Math.round((n || 0) * 10) / 10}%`;

function calcStats(rows) {
  const wins = rows.filter((r) => r.result === 'Vitória').length;
  const losses = rows.filter((r) => r.result === 'Derrota').length;
  const draws = rows.filter((r) => r.result === 'Empate').length;
  const decisions = wins + losses;
  const kills = rows.reduce((sum, r) => sum + (Number(r.kills) || 0), 0);
  const deaths = rows.reduce((sum, r) => sum + (Number(r.deaths) || 0), 0);
  const assists = rows.reduce((sum, r) => sum + (Number(r.assists) || 0), 0);
  const kdRows = rows.filter((r) => Number(r.deaths) > 0);
  const avgKD = kdRows.length
    ? kdRows.reduce((sum, r) => sum + (Number(r.kills) || 0) / Number(r.deaths), 0) / kdRows.length
    : 0;
  return {
    wins, losses, draws, matches: rows.length, decisions, kills, deaths, assists, avgKD, kdMatches: kdRows.length,
    winrate: decisions ? (wins / decisions) * 100 : 0,
    avgKills: rows.length ? kills / rows.length : 0,
  };
}

function groupStats(rows, getKey) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Array.from(groups.entries())
    .map(([name, list]) => ({ name, ...calcStats(list) }))
    .sort((a, b) => b.matches - a.matches || b.winrate - a.winrate);
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pt-BR');
}

function normalizeUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^(www\.)?(youtube\.com|youtu\.be|twitch\.tv)\//i.test(raw)) return `https://${raw}`;
  return raw;
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selecione um arquivo de imagem.'));
      return;
    }
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxSize = 1200;
      const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(sourceUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.76));
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('Não foi possível abrir essa imagem.'));
    };
    image.src = sourceUrl;
  });
}

function App() {
  const [data, setData] = useState({ vods: [], lineups: [], tactics: [], training: [], gameplans: [], maps: [], agents: [] });
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('dashboard');
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ map: 'Todos', agent: 'Todos', result: 'Todos' });
  const [toast, setToast] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [vodAnalysis, setVodAnalysis] = useState({ busy: false, progress: 0, message: '' });
  const imageInputRef = useRef(null);
  const vodFileInputRef = useRef(null);
  const importInputRef = useRef(null);
  const defaultsImportRef = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let loaded;
        if (window.kringAPI?.loadData) {
          loaded = await window.kringAPI.loadData();
        } else {
          const raw = localStorage.getItem('kring-vlr-data');
          loaded = raw ? JSON.parse(raw) : { vods: [], lineups: [], tactics: [], training: [], gameplans: [], maps: [], agents: [] };
        }
        let seed = { maps: [], agents: [] };
        if (!Array.isArray(loaded?.maps) || !Array.isArray(loaded?.agents)) {
          try { const response = await fetch('./catalogs.json'); if (response.ok) seed = await response.json(); } catch {}
        }
        if (!active) return;
        setData({
          vods: Array.isArray(loaded?.vods) ? loaded.vods : [],
          lineups: Array.isArray(loaded?.lineups) ? loaded.lineups : [],
          tactics: Array.isArray(loaded?.tactics) ? loaded.tactics.map((item) => ({ ...item, category: item.category === 'Roubo de ultimate' ? 'Rounds de ultimate' : item.category })) : [],
          training: Array.isArray(loaded?.training) ? loaded.training : [],
          gameplans: Array.isArray(loaded?.gameplans) ? loaded.gameplans : [],
          maps: Array.isArray(loaded?.maps) ? loaded.maps : (Array.isArray(seed.maps) ? seed.maps : []),
          agents: Array.isArray(loaded?.agents) ? loaded.agents : (Array.isArray(seed.agents) ? seed.agents : []),
        });
      } catch (error) {
        console.error(error);
        if (active) setToast('Não foi possível carregar os dados salvos.');
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        if (window.kringAPI?.saveData) await window.kringAPI.saveData(data);
        else localStorage.setItem('kring-vlr-data', JSON.stringify(data));
      } catch (error) {
        console.error(error);
        setToast('Falha ao salvar. Faça uma cópia de segurança dos seus dados.');
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data, ready]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const overall = useMemo(() => calcStats(data.vods), [data.vods]);
  const mapsStats = useMemo(() => groupStats(data.vods, (v) => v.map), [data.vods]);
  const agentsStats = useMemo(() => groupStats(data.vods, (v) => v.agent), [data.vods]);
  const mapAgentStats = useMemo(() => groupStats(data.vods, (v) => v.map && v.agent ? `${v.map} · ${v.agent}` : ''), [data.vods]);
  const activeMaps = useMemo(() => data.maps.filter((item) => item.competitiveActive).slice().sort((a, b) => a.name.localeCompare(b.name)), [data.maps]);
  const activeAgents = useMemo(() => data.agents.filter((item) => item.active).slice().sort((a, b) => a.name.localeCompare(b.name)), [data.agents]);
  const tacticsMaps = useMemo(() => uniqueSorted([...data.maps.map((item) => item.name), ...data.tactics.map((item) => item.map)]), [data.maps, data.tactics]);
  const lineupsMaps = useMemo(() => uniqueSorted([...data.maps.map((item) => item.name), ...data.lineups.map((item) => item.map)]), [data.maps, data.lineups]);
  const gameplanMaps = useMemo(() => uniqueSorted([...data.maps.map((item) => item.name), ...data.gameplans.map((item) => item.map)]), [data.maps, data.gameplans]);
  const pageTitle = NAV_ITEMS.find((item) => item.id === view)?.label || 'Visão geral';

  const openCreate = (kind, map = '') => {
    setEditingId(null);
    setForm(kind === 'vod'
      ? { title: '', link: '', map: '', mapId: '', agent: '', agentId: '', kills: '', deaths: '', assists: '', result: 'Vitória', date: today(), notes: '', gamePlan: '', gameplanId: '', roundsWon: '', roundsLost: '', roundResults: { Ataque: {}, Defesa: {} } }
      : kind === 'lineup' ? { title: '', map, mapId: data.maps.find((item) => item.name === map)?.id || '', agent: '', agentId: '', ability: '', side: 'Ataque', instructions: '', link: '', imageData: '' }
      : kind === 'tactic' ? { title: '', map, category: 'Default', side: 'Ataque', description: '', imageData: '', link: '' }
      : kind === 'gameplan' ? { name: '', map, mapId: data.maps.find((item) => item.name === map)?.id || '', side: 'Ambos', agentIds: [], agentsText: '', description: '' }
      : kind === 'catalogAgent' ? { name: '', role: AGENT_ROLES[0], iconUrl: '', active: true }
      : kind === 'catalogMap' ? { name: '', previewUrl: '', competitiveActive: true }
      : { title: '', week: today().slice(0, 10), category: 'Mecânica', minutes: '', notes: '', done: false });
    setModal(kind);
  };

  const openEdit = (kind, entry) => {
    setEditingId(entry.id);
    setForm({ ...entry, agentIds: entry.agentIds || (entry.agents || []).map((name) => data.agents.find((agent) => agent.name === name)?.id).filter(Boolean), agentsText: Array.isArray(entry.agents) ? entry.agents.join(', ') : '', kills: entry.kills == null ? '' : String(entry.kills), deaths: entry.deaths == null ? '' : String(entry.deaths), assists: entry.assists == null ? '' : String(entry.assists), roundsWon: entry.roundsWon == null ? '' : String(entry.roundsWon), roundsLost: entry.roundsLost == null ? '' : String(entry.roundsLost) });
    setModal(kind);
  };

  const closeModal = () => {
    setModal(null);
    setEditingId(null);
    setImageBusy(false);
  };

  const updateForm = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const [reviewVod, setReviewVod] = useState(null);
  const [scrimProgress, setScrimProgress] = useState({ busy: false, percent: 0, message: '', score: '0-0', round: 1, liveKills: [] });

  useEffect(() => {
    if (!window.kringAPI?.onVodProgress) return;
    const unsubProgress = window.kringAPI.onVodProgress((data) => {
      setScrimProgress((prev) => ({
        ...prev,
        percent: data.percent ?? prev.percent,
        message: `Analisando ${data.current_time || ''} · ${data.total_kills_found || 0} abates`,
        score: data.score || prev.score,
        round: data.current_round || prev.round,
      }));
    });
    const unsubKill = window.kringAPI.onVodKillEvent((event) => {
      setScrimProgress((prev) => ({
        ...prev,
        liveKills: [event, ...prev.liveKills.slice(0, 24)],
      }));
    });
    return () => {
      if (unsubProgress) unsubProgress();
      if (unsubKill) unsubKill();
    };
  }, []);

  const pickVideoFile = async () => {
    if (window.kringAPI?.selectVideoFile) {
      const selected = await window.kringAPI.selectVideoFile();
      if (selected) {
        const fileName = selected.split(/[\/\\]/).pop();
        setForm((prev) => ({
          ...prev,
          localVideoPath: selected,
          localVideoName: fileName,
          title: prev.title || fileName.replace(/\.[^/.]+$/, ""),
        }));
      }
    } else {
      vodFileInputRef.current?.click();
    }
  };

  const startNativeAnalysis = async () => {
    const videoPath = form.localVideoPath;
    if (!videoPath) {
      setToast('Escolha um arquivo de vídeo da partida.');
      return;
    }
    setScrimProgress({ busy: true, percent: 0, message: 'Identificando jogadores e agentes da partida…', score: '0-0', round: 1, liveKills: [] });
    try {
      const res = await window.kringAPI.startVodAnalysis(videoPath, {
        userNick: form.playerName || '',
        userAgent: form.agent || '',
      });
      if (res?.ok && res.data) {
        const match = res.data;
        const friendlyScore = match.final_score?.friendly ?? 0;
        const enemyScore = match.final_score?.enemy ?? 0;
        const resultLabel = friendlyScore > enemyScore ? 'Vitória' : friendlyScore < enemyScore ? 'Derrota' : 'Empate';

        const openingDuels = [];
        (match.rounds || []).forEach((r) => {
          const firstK = (r.kills || []).find((k) => k.first_kill);
          if (firstK) {
            openingDuels.push({
              round: String(r.round_number),
              time: firstK.time,
              event: firstK.event_label,
              player: firstK.killer_team === 'friendly' ? firstK.killer : firstK.victim,
            });
          }
        });

        let playerKills = form.kills;
        let playerDeaths = form.deaths;
        if (form.playerName) {
          const pKey = Object.keys(match.players_stats || {}).find((name) => name.toLowerCase().includes(form.playerName.toLowerCase()));
          if (pKey && match.players_stats[pKey]) {
            playerKills = match.players_stats[pKey].kills;
            playerDeaths = match.players_stats[pKey].deaths;
          }
        }

        setForm((prev) => ({
          ...prev,
          roundsWon: friendlyScore,
          roundsLost: enemyScore,
          result: resultLabel,
          openingDuels: openingDuels.length ? openingDuels : prev.openingDuels,
          kills: playerKills !== undefined ? playerKills : prev.kills,
          deaths: playerDeaths !== undefined ? playerDeaths : prev.deaths,
          analysisData: match,
          localVideoPath: videoPath,
        }));

        setToast(`Análise concluída com sucesso! ${match.all_kills?.length || 0} abates e ${match.rounds?.length || 0} rounds identificados.`);
      } else {
        setToast(res?.error || 'A análise não pôde ser concluída.');
      }
    } catch (err) {
      setToast(err.message || 'Erro ao executar o analisador de vídeo.');
    } finally {
      setScrimProgress((prev) => ({ ...prev, busy: false }));
    }
  };

  const cancelAnalysis = async () => {
    if (window.kringAPI?.cancelVodAnalysis) {
      await window.kringAPI.cancelVodAnalysis();
      setScrimProgress((prev) => ({ ...prev, busy: false, message: 'Análise cancelada.' }));
    }
  };

  const saveForm = (event) => {
    event.preventDefault();
    if (modal === 'vod') {
      if (!form.title?.trim() || !form.map?.trim() || !form.agent?.trim()) {
        setToast('Preencha o título, o mapa e o agente.');
        return;
      }
      const record = {
        ...form,
        id: editingId || uid(),
        title: form.title.trim(), map: form.map.trim(), agent: form.agent.trim(),
        mapId: data.maps.find((item) => item.name === form.map)?.id || form.mapId || null,
        agentId: data.agents.find((item) => item.name === form.agent)?.id || form.agentId || null,
        link: normalizeUrl(form.link), kills: Math.max(0, Number(form.kills) || 0),
        deaths: Math.max(0, Number(form.deaths) || 0), assists: Math.max(0, Number(form.assists) || 0),
        gameplanId: data.gameplans.some((plan) => plan.id === form.gameplanId) ? form.gameplanId : null,
        roundsWon: form.roundsWon === '' ? null : Math.max(0, Number(form.roundsWon) || 0),
        roundsLost: form.roundsLost === '' ? null : Math.max(0, Number(form.roundsLost) || 0),
        result: RESULTS.includes(form.result) ? form.result : 'Vitória', date: form.date || today(),
        roundResults: { Ataque: { ...(form.roundResults?.Ataque || {}) }, Defesa: { ...(form.roundResults?.Defesa || {}) } },
        openingDuels: Array.isArray(form.openingDuels) ? form.openingDuels.filter((item) => item && (item.round || item.time || item.player)).map((item) => ({ round: String(item.round || '').trim(), time: String(item.time || '').trim(), event: item.event === 'First Death' ? 'First Death' : 'First Kill', player: String(item.player || '').trim() })) : [],
        notes: (form.notes || '').trim(),
      };
      setData((previous) => ({ ...previous, vods: editingId ? previous.vods.map((v) => v.id === editingId ? record : v) : [record, ...previous.vods] }));
      setToast(editingId ? 'VOD atualizado.' : 'VOD adicionado à biblioteca.');
    } else {
      if (modal === 'catalogAgent' || modal === 'catalogMap') {
        const isAgent = modal === 'catalogAgent';
        const collection = isAgent ? 'agents' : 'maps';
        const oldEntry = editingId ? data[collection].find((item) => item.id === editingId) : null;
        if (!form.name?.trim()) { setToast('Informe o nome.'); return; }
        const duplicate = data[collection].some((item) => item.id !== editingId && item.name.toLowerCase() === form.name.trim().toLowerCase());
        if (duplicate) { setToast('Já existe um cadastro com esse nome.'); return; }
        const mediaField = isAgent ? 'iconUrl' : 'previewUrl';
        const mediaUrl = (form[mediaField] || '').trim();
        if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) { setToast('Use um endereço de imagem que comece com https://.'); return; }
        const record = { ...form, id: editingId || uid(), name: form.name.trim(), [mediaField]: mediaUrl };
        setData((previous) => {
          const next = { ...previous, [collection]: editingId ? previous[collection].map((item) => item.id === editingId ? record : item) : [record, ...previous[collection]] };
          if (oldEntry && oldEntry.name !== record.name) {
            const field = isAgent ? 'agent' : 'map';
            const idField = isAgent ? 'agentId' : 'mapId';
            for (const key of ['vods', 'lineups', 'tactics', 'gameplans']) next[key] = previous[key].map((item) => ({ ...item, ...(item[idField] === editingId || (!item[idField] && item[field] === oldEntry.name) ? { [field]: record.name, [idField]: editingId } : {}), ...(isAgent && Array.isArray(item.agents) ? { agents: item.agents.map((name) => name === oldEntry.name ? record.name : name) } : {}) }));
          }
          return next;
        });
        setToast(editingId ? `${isAgent ? 'Agente' : 'Mapa'} atualizado.` : `${isAgent ? 'Agente' : 'Mapa'} cadastrado.`);
        closeModal();
        return;
      }
      if (modal === 'gameplan') {
        if (!form.name?.trim() || !form.map?.trim()) { setToast('Preencha o nome e o mapa do Gameplan.'); return; }
        const record = {
          id: editingId || uid(), name: form.name.trim(), map: form.map.trim(), mapId: data.maps.find((item) => item.name === form.map)?.id || form.mapId || null,
          side: ['Ataque', 'Defesa', 'Ambos'].includes(form.side) ? form.side : 'Ambos',
          agentIds: form.agentIds || [],
          agents: (form.agentIds || []).map((id) => data.agents.find((agent) => agent.id === id)?.name).filter(Boolean).concat((form.agentsText || '').split(',').map((agent) => agent.trim()).filter((name) => !data.agents.some((catalogAgent) => catalogAgent.name.toLowerCase() === name.toLowerCase()))),
          description: (form.description || '').trim(),
          createdAt: editingId ? (data.gameplans.find((plan) => plan.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setData((previous) => ({ ...previous, gameplans: editingId ? previous.gameplans.map((plan) => plan.id === editingId ? record : plan) : [record, ...previous.gameplans] }));
        setToast(editingId ? 'Gameplan atualizado.' : 'Gameplan criado.');
        closeModal();
        return;
      }
      if (modal === 'tactic' || modal === 'training') {
        if (!form.title?.trim()) { setToast('Preencha o nome.'); return; }
        if (modal === 'tactic' && !form.map?.trim()) { setToast('Escolha o mapa do tático.'); return; }
        const kindKey = modal === 'tactic' ? 'tactics' : 'training';
        const record = { ...form, id: editingId || uid(), title: form.title.trim(), ...(modal === 'tactic' ? { map: form.map.trim(), mapId: data.maps.find((item) => item.name === form.map)?.id || null, link: normalizeUrl(form.link), description: (form.description || '').trim() } : {}) };
        setData((previous) => ({ ...previous, [kindKey]: editingId ? previous[kindKey].map((item) => item.id === editingId ? record : item) : [record, ...previous[kindKey]] }));
        setToast(editingId ? 'Registro atualizado.' : 'Registro adicionado.');
        closeModal();
        return;
      }
      if (!form.title?.trim() || !form.map?.trim() || !form.agent?.trim()) {
        setToast('Preencha o nome, o mapa e o agente da lineup.');
        return;
      }
      const record = {
        ...form,
        id: editingId || uid(), title: form.title.trim(), map: form.map.trim(), agent: form.agent.trim(),
        mapId: data.maps.find((item) => item.name === form.map)?.id || null, agentId: data.agents.find((item) => item.name === form.agent)?.id || null,
        ability: (form.ability || '').trim(), side: form.side || 'Ataque',
        instructions: (form.instructions || '').trim(), link: normalizeUrl(form.link),
      };
      setData((previous) => ({ ...previous, lineups: editingId ? previous.lineups.map((l) => l.id === editingId ? record : l) : [record, ...previous.lineups] }));
      setToast(editingId ? 'Lineup atualizada.' : 'Lineup adicionada à biblioteca.');
    }
    closeModal();
  };

  const removeEntry = (kind, id) => {
    if (kind === 'catalogMap' || kind === 'catalogAgent') {
      const isMap = kind === 'catalogMap';
      const entry = data[isMap ? 'maps' : 'agents'].find((item) => item.id === id);
      if (!entry) return;
      const referenced = isMap
        ? ['vods', 'lineups', 'tactics', 'gameplans'].some((key) => data[key].some((item) => item.mapId === id || (!item.mapId && item.map === entry.name)))
        : ['vods', 'lineups', 'gameplans'].some((key) => data[key].some((item) => item.agentId === id || (!item.agentId && item.agent === entry.name) || item.agentIds?.includes(id) || item.agents?.includes(entry.name)));
      if (referenced) { setToast('Este cadastro já está em uso. Desative-o para removê-lo dos novos seletores.'); return; }
      if (!window.confirm(`Excluir ${isMap ? 'o mapa' : 'o agente'} ${entry.name}?`)) return;
      setData((previous) => ({ ...previous, [isMap ? 'maps' : 'agents']: previous[isMap ? 'maps' : 'agents'].filter((item) => item.id !== id) }));
      setToast(`${isMap ? 'Mapa' : 'Agente'} excluído.`);
      return;
    }
    const label = kind === 'vod' ? 'este VOD' : kind === 'lineup' ? 'esta lineup' : 'este registro';
    if (!window.confirm(`Tem certeza de que deseja excluir ${label}?`)) return;
    if (kind === 'gameplan') {
      setData((previous) => ({ ...previous, gameplans: previous.gameplans.filter((plan) => plan.id !== id), vods: previous.vods.map((vod) => vod.gameplanId === id ? { ...vod, gameplanId: null } : vod) }));
      setToast('Gameplan removido; as partidas foram mantidas.');
      return;
    }
    const key = ({ vod: 'vods', lineup: 'lineups', tactic: 'tactics', training: 'training' })[kind];
    setData((previous) => ({ ...previous, [key]: previous[key].filter((entry) => entry.id !== id) }));
    setToast(({ vod: 'VOD removido.', lineup: 'Lineup removida.', tactic: 'Tático removido.', training: 'Treino removido.' })[kind]);
  };

  const openExternal = async (url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl || !/^https:\/\//i.test(safeUrl)) {
      setToast('Adicione um link válido começando com https://.');
      return;
    }
    if (window.kringAPI?.openExternal) await window.kringAPI.openExternal(safeUrl);
    else window.open(safeUrl, '_blank', 'noopener,noreferrer');
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ ...data, backupCreatedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kring-vlr-backup-${today()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast('Cópia de segurança exportada.');
  };

  const exportDefaults = () => {
    const defaults = data.tactics.filter((item) => item.category === 'Default').map(({ id, title, map, mapId, side, description, link, imageData }) => ({ id, title, map, mapId, category: 'Default', side, description, link, imageData }));
    if (!defaults.length) { setToast('Não há táticos Default para exportar.'); return; }
    const blob = new Blob([JSON.stringify({ type: 'kring-vlr-defaults', formatVersion: 1, exportedAt: new Date().toISOString(), tactics: defaults }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kring-vlr-defaults-${today()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(`${defaults.length} Default(s) exportado(s).`);
  };

  const importDefaults = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.type !== 'kring-vlr-defaults' || parsed.formatVersion !== 1 || !Array.isArray(parsed.tactics) || !parsed.tactics.length || parsed.tactics.some((item) => item.category !== 'Default' || !item.title?.trim() || !item.map?.trim())) throw new Error('Formato inválido');
      if (!window.confirm(`Importar ${parsed.tactics.length} Default(s) vai substituir somente os táticos da categoria Default atuais. Todas as outras categorias e dados permanecerão intactos. Deseja continuar?`)) return;
      const imported = parsed.tactics.map((item) => ({
        id: uid(), title: item.title.trim(), map: item.map.trim(),
        mapId: data.maps.find((map) => map.name === item.map)?.id || null,
        category: 'Default', side: ['Ataque', 'Defesa', 'Ambos'].includes(item.side) ? item.side : 'Ataque',
        description: String(item.description || ''), link: /^https:\/\//i.test(item.link || '') ? item.link : '',
        imageData: typeof item.imageData === 'string' && /^(data:image\/|https:\/\/)/i.test(item.imageData) ? item.imageData : '',
      }));
      setData((previous) => ({ ...previous, tactics: [...previous.tactics.filter((item) => item.category !== 'Default'), ...imported] }));
      setToast(`${imported.length} Default(s) importado(s). As outras categorias foram preservadas.`);
    } catch {
      setToast('Arquivo inválido. Selecione uma exportação de Defaults do Kring VLR.');
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.vods) || !Array.isArray(parsed.lineups)) throw new Error('Formato inesperado');
      if (!window.confirm('Importar esta cópia vai substituir os VODs e lineups atuais. Deseja continuar?')) return;
      setData((previous) => ({ ...previous, vods: parsed.vods, lineups: parsed.lineups, tactics: Array.isArray(parsed.tactics) ? parsed.tactics.map((item) => ({ ...item, category: item.category === 'Roubo de ultimate' ? 'Rounds de ultimate' : item.category })) : [], training: Array.isArray(parsed.training) ? parsed.training : [], gameplans: Array.isArray(parsed.gameplans) ? parsed.gameplans : [], maps: Array.isArray(parsed.maps) ? parsed.maps : previous.maps, agents: Array.isArray(parsed.agents) ? parsed.agents : previous.agents }));
      setToast('Cópia de segurança importada.');
    } catch {
      setToast('Esse arquivo não parece ser uma cópia válida do Kring VLR.');
    }
  };

  const attachLineupImage = async (file, successMessage = modal === 'tactic' ? 'Print anexado ao tático.' : 'Imagem anexada à lineup.') => {
    if (!file) return;
    setImageBusy(true);
    try {
      const imageData = await compressImage(file);
      updateForm('imageData', imageData);
      setToast(successMessage);
    } catch (error) {
      setToast(error.message || 'Não foi possível anexar a imagem.');
    } finally {
      setImageBusy(false);
    }
  };

  const onImageSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await attachLineupImage(file);
  };

  const onImagePaste = async (event) => {
    const imageItem = Array.from(event.clipboardData?.items || [])
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) return; // Mantém o comportamento normal ao colar texto nos campos.

    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    if (imageBusy) {
      setToast('Aguarde o processamento da imagem atual.');
      return;
    }
    await attachLineupImage(file, modal === 'tactic' ? 'Screenshot colado no tático.' : 'Screenshot colado na lineup.');
  };

  const filteredVods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.vods.filter((vod) => {
      const matchesSearch = !q || [vod.title, vod.map, vod.agent, vod.notes, vod.result].some((value) => String(value || '').toLowerCase().includes(q));
      return matchesSearch
        && (filters.map === 'Todos' || vod.map === filters.map)
        && (filters.agent === 'Todos' || vod.agent === filters.agent)
        && (filters.result === 'Todos' || vod.result === filters.result);
    });
  }, [data.vods, search, filters]);

  const filteredLineups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.lineups.filter((lineup) => !q || [lineup.title, lineup.map, lineup.agent, lineup.ability, lineup.side, lineup.instructions].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [data.lineups, search]);

  const setFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Crosshair size={22} strokeWidth={2.2} /></div>
          <div><div className="brand-name">KRING <span>VLR</span></div><div className="brand-subtitle">PLAYER WORKSPACE</div></div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => { setView(item.id); setSearch(''); }}>
              <Icon size={18} /><span>{item.label}</span>{item.id === 'vods' && data.vods.length > 0 && <span className="nav-count">{data.vods.length}</span>}
            </button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card"><div className="local-icon"><ShieldCheck size={17} /></div><div><strong>Seus dados, no seu PC</strong><span>Salvamento local automático</span></div></div>
          <div className="sidebar-footer"><span className="status-dot" /> Kring VLR <span className="version">v1.0.5</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <button className="button button-quiet button-small" onClick={exportBackup} title="Exportar uma cópia de segurança"><ArrowDownToLine size={15} /> Backup</button>
            <button className="button button-quiet button-small" onClick={() => importInputRef.current?.click()} title="Importar uma cópia de segurança"><ArrowUpFromLine size={15} /> Importar</button>
            {view !== 'veto' && view !== 'stats' && view !== 'tactics' && <button className="button button-primary button-small" onClick={() => openCreate(view === 'lineups' ? 'lineup' : view === 'training' ? 'training' : view === 'gameplans' ? 'gameplan' : view === 'catalogs' ? 'catalogMap' : 'vod')}><Plus size={16} /> {view === 'lineups' ? 'Nova lineup' : view === 'training' ? 'Adicionar treino' : view === 'gameplans' ? 'Novo Gameplan' : view === 'catalogs' ? 'Adicionar mapa' : 'Adicionar VOD'}</button>}
          </div>
        </header>

        <div className="page-content">
          {view === 'dashboard' && <Dashboard
            data={data} overall={overall} mapsStats={mapsStats} agentsStats={agentsStats}
            onAddVod={() => openCreate('vod')} onGo={setView} onOpenVOD={openExternal}
            onAddLineup={() => openCreate('lineup')}
            onReview={(vod) => setReviewVod(vod)}
          />}
          {view === 'veto' && <VetoSimulator maps={activeMaps} />}
          {view === 'vods' && <section>
            <div className="page-heading"><div><div className="eyebrow">ANÁLISE DE PARTIDAS</div><h1>Biblioteca de VODs</h1><p>Organize suas partidas, registre resultados e encontre padrões de desempenho.</p></div><button className="button button-primary" onClick={() => openCreate('vod')}><Plus size={17} /> Adicionar VOD</button></div>
            <div className="toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título, mapa ou agente..." /></div>
              <div className="filter-field"><Filter size={15} /><select value={filters.map} onChange={(e) => setFilter('map', e.target.value)}><option>Todos</option>{uniqueSorted(data.vods.map((v) => v.map)).map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></div>
              <div className="filter-field"><select aria-label="Filtrar por agente" value={filters.agent} onChange={(e) => setFilter('agent', e.target.value)}><option>Todos</option>{uniqueSorted(data.vods.map((v) => v.agent)).map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></div>
              <div className="filter-field"><select aria-label="Filtrar por resultado" value={filters.result} onChange={(e) => setFilter('result', e.target.value)}><option>Todos</option>{RESULTS.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></div>
            </div>
            {filteredVods.length === 0 ? <EmptyState icon={FileVideo2} title={data.vods.length ? 'Nenhum VOD encontrado' : 'Sua biblioteca começa aqui'} text={data.vods.length ? 'Tente mudar os filtros ou a busca.' : 'Adicione o link de uma partida do YouTube, registre mapa, agente, abates e resultado.'} actionLabel="Adicionar primeiro VOD" onAction={() => openCreate('vod')} /> :
              <div className="vod-list">{filteredVods.map((vod) => <VodCard key={vod.id} vod={vod} gameplan={data.gameplans.find((plan) => plan.id === vod.gameplanId)} onEdit={() => openEdit('vod', vod)} onDelete={() => removeEntry('vod', vod.id)} onOpen={() => openExternal(vod.link)} onReview={() => setReviewVod(vod)} />)}</div>}
          </section>}
          {view === 'lineups' && <LineupsPage lineups={filteredLineups} allLineups={data.lineups} maps={lineupsMaps} search={search} onSearch={setSearch} onAdd={(map) => openCreate('lineup', map)} onEdit={(item) => openEdit('lineup', item)} onDelete={(id) => removeEntry('lineup', id)} onOpen={openExternal} />}
          {view === 'tactics' && <TacticsPage tactics={data.tactics} maps={tacticsMaps} onAdd={(map) => openCreate('tactic', map)} onEdit={(item) => openEdit('tactic', item)} onDelete={(id) => removeEntry('tactic', id)} onOpen={openExternal} onExportDefaults={exportDefaults} onImportDefaults={importDefaults} />}
          {view === 'gameplans' && <GameplansPage gameplans={data.gameplans} maps={gameplanMaps} onAdd={(map) => openCreate('gameplan', map)} onEdit={(item) => openEdit('gameplan', item)} onDelete={(id) => removeEntry('gameplan', id)} />}
          {view === 'catalogs' && <CatalogManager maps={data.maps} agents={data.agents} onAddMap={() => openCreate('catalogMap')} onAddAgent={() => openCreate('catalogAgent')} onEditMap={(item) => openEdit('catalogMap', item)} onEditAgent={(item) => openEdit('catalogAgent', item)} onDeleteMap={(id) => removeEntry('catalogMap', id)} onDeleteAgent={(id) => removeEntry('catalogAgent', id)} onToggleMap={(item) => setData((previous) => ({ ...previous, maps: previous.maps.map((row) => row.id === item.id ? { ...row, competitiveActive: !row.competitiveActive } : row) }))} onToggleAgent={(item) => setData((previous) => ({ ...previous, agents: previous.agents.map((row) => row.id === item.id ? { ...row, active: !row.active } : row) }))} />}
          {view === 'training' && <TrainingPage training={data.training} onAdd={() => openCreate('training')} onEdit={(item) => openEdit('training', item)} onDelete={(id) => removeEntry('training', id)} onToggle={(item) => setData((prev) => ({ ...prev, training: prev.training.map((row) => row.id === item.id ? { ...row, done: !row.done } : row) }))} />}
          {view === 'stats' && <StatsPage vods={data.vods} gameplans={data.gameplans} mapsStats={mapsStats} agentsStats={agentsStats} mapAgentStats={mapAgentStats} />}
        </div>

        <footer className="main-footer"><span>KRING VLR <span className="footer-dot">•</span> Ferramenta pessoal de análise</span><span><ShieldCheck size={13} /> Salvamento automático local</span></footer>
      </main>

      {modal && <Modal title={modal === 'vod' ? (editingId ? 'Editar partida' : 'Adicionar partida') : modal === 'lineup' ? (editingId ? 'Editar lineup' : 'Nova lineup') : modal === 'tactic' ? (editingId ? 'Editar tático' : 'Novo tático') : modal === 'gameplan' ? (editingId ? 'Editar Gameplan' : 'Novo Gameplan') : modal === 'catalogMap' ? (editingId ? 'Editar mapa' : 'Adicionar mapa') : modal === 'catalogAgent' ? (editingId ? 'Editar agente' : 'Adicionar agente') : (editingId ? 'Editar treino' : 'Adicionar treino')} subtitle={modal === 'vod' ? 'Registre a partida, o plano utilizado e o placar.' : modal === 'training' ? 'Organize seus objetivos para a semana.' : modal === 'catalogMap' || modal === 'catalogAgent' ? 'Atualize o catálogo usado pelos seletores do app.' : 'Adicione os detalhes para consultar durante a preparação.'} onClose={closeModal}>
        <form onSubmit={saveForm} onPaste={['lineup', 'tactic'].includes(modal) ? onImagePaste : undefined} className="form-stack">
          {modal === 'vod' ? <>
            <Field label="Título da partida *"><input autoFocus required value={form.title || ''} onChange={(e) => updateForm('title', e.target.value)} placeholder="Ex.: VCB — Remo vs Elevate — Jogo 2" /></Field>
            <Field label="Link da VOD"><div className="input-with-icon"><Video size={16} /><input value={form.link || ''} onChange={(e) => updateForm('link', e.target.value)} placeholder="https://youtube.com/..." /></div></Field>
            <div className="scrim-analyzer-box">
              <div className="scrim-analyzer-header">
                <div className="scrim-analyzer-title">
                  <Sparkles size={20} />
                  <div>
                    <strong>Análise de Scrim (Visão Computacional & IA)</strong>
                    <span>Extrai placar, rounds, quem matou quem, headshots e first kills diretamente do vídeo local.</span>
                  </div>
                </div>
              </div>

              <div className="scrim-file-row">
                <button type="button" className="button button-secondary button-small" onClick={pickVideoFile}>
                  <FolderOpen size={15} /> {form.localVideoName || 'Escolher gravação do treino (.mp4, .mkv)'}
                </button>
                <input ref={vodFileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mkv" hidden onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    updateForm('localVideoName', file.name);
                    updateForm('localVideoPath', file.path || file.name);
                    if (!form.title) updateForm('title', file.name.replace(/\.[^/.]+$/, ""));
                  }
                }} />
                <div className="scrim-file-path" title={form.localVideoPath}>
                  {form.localVideoPath || 'Nenhum arquivo de vídeo selecionado'}
                </div>
                {!scrimProgress.busy ? (
                  <button
                    type="button"
                    className="button button-primary button-small"
                    disabled={!form.localVideoPath}
                    onClick={startNativeAnalysis}
                  >
                    <Crosshair size={14} /> Iniciar Análise do Treino
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button-danger-quiet button-small"
                    onClick={cancelAnalysis}
                  >
                    <X size={14} /> Cancelar
                  </button>
                )}
              </div>

              <Field label="Seu nick na partida (para identificar seus abates e mortes no time)">
                <input
                  value={form.playerName || ''}
                  onChange={(e) => updateForm('playerName', e.target.value)}
                  placeholder="Ex.: MIBR kringv1"
                />
              </Field>

              {scrimProgress.busy && (
                <>
                  <div className="scrim-live-hud">
                    <div className="scrim-hud-score">
                      PLACAR: {scrimProgress.score}
                    </div>
                    <div className="scrim-hud-meta">
                      <span><strong>Round {scrimProgress.round}</strong></span>
                      <span>{scrimProgress.message}</span>
                      <span><strong>{scrimProgress.percent}%</strong></span>
                    </div>
                  </div>
                  <div className="progress-track" style={{ height: '6px', margin: '6px 0 10px' }}>
                    <div className="progress-fill" style={{ width: `${scrimProgress.percent}%`, transition: 'width 0.3s ease' }} />
                  </div>
                  {scrimProgress.liveKills.length > 0 && (
                    <div className="scrim-live-stream">
                      <span style={{ fontSize: '10px', color: '#889', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Abates detectados em tempo real:</span>
                      {scrimProgress.liveKills.slice(0, 6).map((ev, i) => (
                        <div key={i} className="scrim-kill-item">
                          <span className="scrim-kill-time">{ev.time}</span>
                          <div className="kill-player-unit">
                            <span className={`badge-team-${ev.killer_team}`}>{ev.killer}</span>
                            {ev.killer_agent && <span className="agent-tag">{ev.killer_agent}</span>}
                          </div>
                          <span style={{ color: '#667' }}>➔</span>
                          <div className="kill-player-unit">
                            <span className={`badge-team-${ev.victim_team}`}>{ev.victim}</span>
                            {ev.victim_agent && <span className="agent-tag">{ev.victim_agent}</span>}
                          </div>
                          {ev.headshot && <span className="kill-tag-hs"><Crosshair size={9} /> HS</span>}
                          {ev.first_kill && <span className="kill-tag-fk"><Zap size={9} /> 1st</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="form-row"><Field label="Mapa *"><select required value={form.map || ''} onChange={(e) => updateForm('map', e.target.value)}><option value="">Selecione um mapa</option>{form.map && !activeMaps.some((item) => item.name === form.map) && <option value={form.map}>{form.map} (inativo)</option>}{activeMaps.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field><Field label="Agente jogado *"><select required value={form.agent || ''} onChange={(e) => updateForm('agent', e.target.value)}><option value="">Selecione um agente</option>{form.agent && !activeAgents.some((item) => item.name === form.agent) && <option value={form.agent}>{form.agent} (inativo)</option>}{activeAgents.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field></div>
            <Field label="Gameplan utilizado"><select value={form.gameplanId || ''} onChange={(e) => { const plan = data.gameplans.find((item) => item.id === e.target.value); setForm((previous) => ({ ...previous, gameplanId: e.target.value, ...(plan ? { map: plan.map } : {}) })); }}><option value="">Nenhum Gameplan</option>{data.gameplans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.map} · {plan.side}</option>)}</select>{!data.gameplans.length && <span className="helper-text">Cadastre um Gameplan na aba correspondente para vinculá-lo aqui.</span>}</Field>
            <div className="form-row"><Field label="Abates"><input type="number" min="0" max="100" value={form.kills ?? ''} onChange={(e) => updateForm('kills', e.target.value)} placeholder="Ex.: 21" /></Field><Field label="Mortes"><input type="number" min="0" max="100" value={form.deaths ?? ''} onChange={(e) => updateForm('deaths', e.target.value)} placeholder="Ex.: 16" /></Field></div>
            <div className="form-row"><Field label="Assistências"><input type="number" min="0" max="100" value={form.assists ?? ''} onChange={(e) => updateForm('assists', e.target.value)} placeholder="Ex.: 7" /></Field><Field label="Data da partida"><input type="date" value={form.date || today()} onChange={(e) => updateForm('date', e.target.value)} /></Field></div>
            <Field label="Resultado *"><div className="result-choice">{RESULTS.map((result) => <button type="button" key={result} onClick={() => updateForm('result', result)} className={`result-option ${form.result === result ? `selected ${result.toLowerCase()}` : ''}`}><span className="result-radio">{form.result === result && <Check size={11} />}</span>{result}</button>)}</div></Field>
            <div className="form-row"><Field label="Rounds ganhos"><input type="number" min="0" max="30" value={form.roundsWon ?? ''} onChange={(e) => updateForm('roundsWon', e.target.value)} placeholder="Ex.: 13" /></Field><Field label="Rounds perdidos"><input type="number" min="0" max="30" value={form.roundsLost ?? ''} onChange={(e) => updateForm('roundsLost', e.target.value)} placeholder="Ex.: 8" /></Field></div>
            <Field label="Rounds por lado"><div className="round-results-grid">{['Ataque', 'Defesa'].map((side) => <section className="round-side" key={side}><h3>{side}</h3>{ROUND_RESULTS.map((round) => <label className="round-result-row" key={round}><span>{round}</span><select aria-label={`${side}: ${round}`} value={form.roundResults?.[side]?.[round] || ''} onChange={(e) => setForm((previous) => ({ ...previous, roundResults: { ...previous.roundResults, [side]: { ...previous.roundResults?.[side], [round]: e.target.value } } }))}><option value="">Não registrado</option><option value="Ganhamos">Ganhamos</option><option value="Perdemos">Perdemos</option></select></label>)}</section>)}</div></Field>
            <Field label="First Kills e First Deaths"><div className="opening-duels-list">{(form.openingDuels || []).map((item, index) => <div className="opening-duel-row" key={index}><input aria-label="Round" type="number" min="1" max="30" placeholder="Round" value={item.round || ''} onChange={(e) => setForm((p) => ({ ...p, openingDuels: p.openingDuels.map((row, i) => i === index ? { ...row, round: e.target.value } : row) }))} /><select aria-label="Tipo de evento" value={item.event || 'First Kill'} onChange={(e) => setForm((p) => ({ ...p, openingDuels: p.openingDuels.map((row, i) => i === index ? { ...row, event: e.target.value } : row) }))}><option>First Kill</option><option>First Death</option></select><input aria-label="Timestamp da VOD" placeholder="MM:SS" value={item.time || ''} onChange={(e) => setForm((p) => ({ ...p, openingDuels: p.openingDuels.map((row, i) => i === index ? { ...row, time: e.target.value } : row) }))} /><input aria-label="Jogador" placeholder="Jogador" value={item.player || ''} onChange={(e) => setForm((p) => ({ ...p, openingDuels: p.openingDuels.map((row, i) => i === index ? { ...row, player: e.target.value } : row) }))} /><button type="button" className="icon-button danger" title="Remover evento" onClick={() => setForm((p) => ({ ...p, openingDuels: p.openingDuels.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>)}<button type="button" className="button button-secondary button-small" onClick={() => setForm((p) => ({ ...p, openingDuels: [...(p.openingDuels || []), { round: '', time: '', event: 'First Kill', player: '' }] }))}><Plus size={14} /> Registrar evento</button><span className="helper-text">Anote o primeiro abate ou a primeira morte de cada round enquanto revê a VOD.</span></div></Field>
            <Field label="Notas da análise"><textarea rows="3" value={form.notes || ''} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Pontos fortes, erros recorrentes, decisões de IGL, rounds para rever..." /></Field>
            <Field label="Plano de jogo"><textarea rows="3" value={form.gamePlan || ''} onChange={(e) => updateForm('gamePlan', e.target.value)} placeholder="Estratégia combinada para a partida: defaults, execuções, condições e ajustes..." /></Field>
          </> : modal === 'lineup' ? <>
            <Field label="Nome da lineup *"><input autoFocus required value={form.title || ''} onChange={(e) => updateForm('title', e.target.value)} placeholder="Ex.: Smoke + molly para retake A" /></Field>
            <div className="form-row"><Field label="Mapa *"><select required value={form.map || ''} onChange={(e) => updateForm('map', e.target.value)}><option value="">Selecione um mapa</option>{form.map && !activeMaps.some((item) => item.name === form.map) && <option value={form.map}>{form.map} (inativo)</option>}{activeMaps.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field><Field label="Agente *"><select required value={form.agent || ''} onChange={(e) => updateForm('agent', e.target.value)}><option value="">Selecione um agente</option>{form.agent && !activeAgents.some((item) => item.name === form.agent) && <option value={form.agent}>{form.agent} (inativo)</option>}{activeAgents.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field></div>
            <div className="form-row"><Field label="Habilidade"><input value={form.ability || ''} onChange={(e) => updateForm('ability', e.target.value)} placeholder="Ex.: Viper wall / Omen smoke" /></Field><Field label="Lado"><select value={form.side || 'Ataque'} onChange={(e) => updateForm('side', e.target.value)}><option>Ataque</option><option>Defesa</option><option>Ambos</option></select></Field></div>
            <Field label="Como executar"><textarea rows="4" value={form.instructions || ''} onChange={(e) => updateForm('instructions', e.target.value)} placeholder="Posição inicial, referência no cenário, timing, comunicação e objetivo..." /></Field>
            <Field label="Link de referência"><div className="input-with-icon"><ExternalLink size={16} /><input value={form.link || ''} onChange={(e) => updateForm('link', e.target.value)} placeholder="YouTube, guia ou vídeo de referência" /></div></Field>
            <Field label="Imagem / screenshot (opcional)">
              <div className="image-upload-row">
                <button type="button" className="button button-secondary" onClick={() => imageInputRef.current?.click()} disabled={imageBusy}><Upload size={15} /> {imageBusy ? 'Processando...' : form.imageData ? 'Trocar imagem' : 'Escolher imagem'}</button>
                <span className="helper-text">Escolha um arquivo ou cole um print diretamente.</span>
                <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImageSelected} />
              </div>
              <button type="button" className={`image-paste-zone ${form.imageData ? 'has-image' : ''}`} disabled={imageBusy} onClick={(event) => { event.preventDefault(); event.currentTarget.focus(); }} title="Clique nesta área e pressione Ctrl + V para colar um screenshot da área de transferência.">
                <ClipboardPaste size={19} />
                <span><strong>{imageBusy ? 'Processando screenshot...' : 'Colar screenshot com Ctrl + V'}</strong><small>Copie o print (por exemplo, com Win + Shift + S), clique aqui e pressione Ctrl + V.</small></span>
              </button>
              {form.imageData && <div className="image-preview-wrap"><img className="form-image-preview" src={form.imageData} alt="Prévia da lineup" /><button type="button" className="icon-button danger" title="Remover imagem" onClick={() => updateForm('imageData', '')}><Trash2 size={15} /></button></div>}
            </Field>
          </> : modal === 'tactic' ? <>
            <Field label="Nome da tática *"><input autoFocus required value={form.title || ''} onChange={(e) => updateForm('title', e.target.value)} placeholder="Ex.: Default 1-3-1 com pressão no meio" /></Field>
            <div className="form-row"><Field label="Mapa *"><select required value={form.map || ''} onChange={(e) => updateForm('map', e.target.value)}><option value="">Selecione um mapa</option>{form.map && !activeMaps.some((item) => item.name === form.map) && <option value={form.map}>{form.map} (inativo)</option>}{activeMaps.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field><Field label="Categoria"><select value={form.category || 'Default'} onChange={(e) => updateForm('category', e.target.value)}>{['Default', 'Execução', 'Pistol', 'Antieco', 'Rounds de ultimate'].map((c) => <option key={c}>{c}</option>)}</select></Field></div>
            <Field label="Lado"><select value={form.side || 'Ataque'} onChange={(e) => updateForm('side', e.target.value)}><option>Ataque</option><option>Defesa</option><option>Ambos</option></select></Field>
            <Field label="Como funciona"><textarea rows="5" value={form.description || ''} onChange={(e) => updateForm('description', e.target.value)} placeholder="Posicionamento, sequência, utilitários e condição de execução..." /></Field>
            <Field label="Link do YouTube ou referência"><div className="input-with-icon"><ExternalLink size={16} /><input value={form.link || ''} onChange={(e) => updateForm('link', e.target.value)} placeholder="https://youtube.com/..." /></div></Field>
            <Field label="Print do tático"><div className="image-upload-row"><button type="button" className="button button-secondary" onClick={() => imageInputRef.current?.click()} disabled={imageBusy}><Upload size={15} /> {imageBusy ? 'Processando...' : form.imageData ? 'Trocar print' : 'Escolher imagem'}</button><span className="helper-text">Selecione uma imagem baixada ou cole um print.</span><input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImageSelected} /></div><button type="button" className={`image-paste-zone ${form.imageData ? 'has-image' : ''}`} disabled={imageBusy} onClick={(event) => { event.preventDefault(); event.currentTarget.focus(); }} title="Clique aqui e pressione Ctrl + V para colar um print."><ClipboardPaste size={19} /><span><strong>{imageBusy ? 'Processando print...' : 'Colar print com Ctrl + V'}</strong><small>Copie um print, clique nesta área e pressione Ctrl + V.</small></span></button>{form.imageData && <div className="image-preview-wrap"><img className="form-image-preview" src={form.imageData} alt="Prévia do print do tático" /><button type="button" className="icon-button danger" title="Remover print" onClick={() => updateForm('imageData', '')}><Trash2 size={15} /></button></div>}</Field>
          </> : modal === 'gameplan' ? <>
            <Field label="Nome do Gameplan *"><input autoFocus required value={form.name || ''} onChange={(e) => updateForm('name', e.target.value)} placeholder="Ex.: Agressivo B Master" /></Field>
            <div className="form-row"><Field label="Mapa *"><select required value={form.map || ''} onChange={(e) => updateForm('map', e.target.value)}><option value="">Selecione um mapa</option>{form.map && !activeMaps.some((item) => item.name === form.map) && <option value={form.map}>{form.map} (inativo)</option>}{activeMaps.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field><Field label="Lado"><select value={form.side || 'Ambos'} onChange={(e) => updateForm('side', e.target.value)}><option>Ataque</option><option>Defesa</option><option>Ambos</option></select></Field></div>
            <div className="field"><span className="field-label">Composição recomendada</span><div className="agent-check-grid">{data.agents.map((agent) => <label className={`agent-check ${agent.active ? '' : 'inactive'}`} key={agent.id}><input type="checkbox" disabled={!agent.active && !(form.agentIds || []).includes(agent.id)} checked={(form.agentIds || []).includes(agent.id)} onChange={(event) => updateForm('agentIds', event.target.checked ? [...(form.agentIds || []), agent.id] : (form.agentIds || []).filter((id) => id !== agent.id))} /><span>{agent.name}</span><small>{agent.role}</small></label>)}</div><span className="helper-text">Selecione os agentes recomendados. Agentes inativos já vinculados podem ser removidos da composição.</span></div>
            <Field label="Descrição / notas"><textarea rows="5" value={form.description || ''} onChange={(e) => updateForm('description', e.target.value)} placeholder="Plano de execução, posições, utilitários e condições..." /></Field>
          </> : modal === 'catalogAgent' ? <>
            <Field label="Nome do agente *"><input autoFocus required value={form.name || ''} onChange={(e) => updateForm('name', e.target.value)} placeholder="Ex.: Novo agente" /></Field>
            <Field label="Classe"><select value={form.role || AGENT_ROLES[0]} onChange={(e) => updateForm('role', e.target.value)}>{AGENT_ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field>
            <Field label="URL do ícone (opcional)"><input type="url" value={form.iconUrl || ''} onChange={(e) => updateForm('iconUrl', e.target.value)} placeholder="https://..." /></Field>
            <label className="catalog-toggle-field"><input type="checkbox" checked={form.active !== false} onChange={(e) => updateForm('active', e.target.checked)} /><span>Ativo nos novos registros</span></label>
          </> : modal === 'catalogMap' ? <>
            <Field label="Nome do mapa *"><input autoFocus required value={form.name || ''} onChange={(e) => updateForm('name', e.target.value)} placeholder="Ex.: Novo mapa" /></Field>
            <Field label="URL da imagem de preview (opcional)"><input type="url" value={form.previewUrl || ''} onChange={(e) => updateForm('previewUrl', e.target.value)} placeholder="https://..." /></Field>
            <label className="catalog-toggle-field"><input type="checkbox" checked={form.competitiveActive !== false} onChange={(e) => updateForm('competitiveActive', e.target.checked)} /><span>Disponível no pool competitivo</span></label>
          </> : <>
            <Field label="O que vai treinar? *"><input autoFocus required value={form.title || ''} onChange={(e) => updateForm('title', e.target.value)} placeholder="Ex.: Counter strafe e primeira bala" /></Field>
            <div className="form-row"><Field label="Semana de início"><input type="date" value={form.week || today()} onChange={(e) => updateForm('week', e.target.value)} /></Field><Field label="Categoria"><select value={form.category || 'Mecânica'} onChange={(e) => updateForm('category', e.target.value)}>{['Mecânica', 'Mira', 'Movimentação', 'Utilitários', 'VOD review', 'Mental'].map((c) => <option key={c}>{c}</option>)}</select></Field></div>
            <Field label="Tempo planejado (minutos)"><input type="number" min="0" value={form.minutes || ''} onChange={(e) => updateForm('minutes', e.target.value)} placeholder="Ex.: 30" /></Field>
            <Field label="Observações"><textarea rows="3" value={form.notes || ''} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Exercício, mapa de treino ou meta da semana" /></Field>
          </>}
          <div className="modal-footer"><button type="button" className="button button-quiet" onClick={closeModal}>Cancelar</button><button type="submit" className="button button-primary"><Check size={16} /> {editingId ? 'Salvar alterações' : modal === 'vod' ? 'Adicionar VOD' : modal === 'lineup' ? 'Salvar lineup' : modal === 'gameplan' ? 'Criar Gameplan' : modal === 'catalogAgent' ? 'Adicionar agente' : modal === 'catalogMap' ? 'Adicionar mapa' : 'Salvar'}</button></div>
        </form>
      </Modal>}

      {reviewVod && <InteractiveVodReviewModal vod={reviewVod} onClose={() => setReviewVod(null)} />}

      <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importBackup} />
      {toast && <div className="toast"><Check size={16} /><span>{toast}</span><button aria-label="Fechar aviso" onClick={() => setToast('')}><X size={14} /></button></div>}
      {!ready && <div className="loading-overlay"><div className="loading-mark"><Crosshair size={28} /></div><span>Carregando seu workspace...</span></div>}
    </div>
  );
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function makeVetoSteps(format, grandFinal, upperTeam) {
  const steps = format === 'bo5' && grandFinal
    ? [{ kind: 'ban', team: upperTeam }, { kind: 'ban', team: upperTeam }]
    : [{ kind: 'ban', team: 'A' }, { kind: 'ban', team: 'B' }];
  steps.push(
    { kind: 'pick', team: 'A', slot: 1 }, { kind: 'side', team: 'B', slot: 1 },
    { kind: 'pick', team: 'B', slot: 2 }, { kind: 'side', team: 'A', slot: 2 },
  );
  if (format === 'bo3') {
    steps.push({ kind: 'ban', team: 'A' }, { kind: 'ban', team: 'B' }, { kind: 'side', team: 'A', slot: 3, decider: true });
  } else {
    steps.push(
      { kind: 'pick', team: 'A', slot: 3 }, { kind: 'side', team: 'B', slot: 3 },
      { kind: 'pick', team: 'B', slot: 4 }, { kind: 'side', team: 'A', slot: 4 },
      { kind: 'side', team: 'B', slot: 5, decider: true },
    );
  }
  return steps;
}

function VetoSimulator({ maps }) {
  const mapNames = maps.map((item) => item.name);
  const [format, setFormat] = useState('bo3');
  const [grandFinal, setGrandFinal] = useState(false);
  const [upperTeam, setUpperTeam] = useState('A');
  const [pool, setPool] = useState(() => mapNames.slice(0, 7));
  const mapArtwork = Object.fromEntries(maps.filter((item) => item.previewUrl).map((item) => [item.name, item.previewUrl]));
  const [myTeam, setMyTeam] = useState('A');
  const [teamNames, setTeamNames] = useState({ A: 'Time A', B: 'Time B' });
  const [history, setHistory] = useState([]);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) setPool((previous) => {
      const kept = previous.filter((name) => mapNames.includes(name)).slice(0, 7);
      return kept.length >= 7 ? kept : [...kept, ...mapNames.filter((name) => !kept.includes(name)).slice(0, 7 - kept.length)];
    });
  }, [mapNames.join('|'), started]);
  const steps = useMemo(() => makeVetoSteps(format, grandFinal, upperTeam), [format, grandFinal, upperTeam]);
  const currentStep = steps[history.length];
  const remainingMaps = pool.filter((map) => !history.some((item) => (item.kind === 'ban' || item.kind === 'pick') && item.map === map));
  const pickedMaps = history.filter((item) => item.kind === 'pick');
  const activeMap = currentStep?.kind === 'side'
    ? currentStep.decider ? remainingMaps[0] : pickedMaps.find((item) => item.slot === currentStep.slot)?.map
    : '';
  const complete = started && history.length === steps.length;

  const changePool = (map) => setPool((previous) => previous.includes(map)
    ? previous.filter((item) => item !== map)
    : previous.length < 7 ? [...previous, map] : previous);
  const start = () => { setHistory([]); setStarted(true); };
  const reset = () => { setHistory([]); setStarted(false); };
  const choose = (value) => {
    if (!currentStep) return;
    setHistory((previous) => [...previous, { ...currentStep, ...(currentStep.kind === 'side' ? { side: value, map: activeMap } : { map: value }) }]);
  };
  const undo = () => setHistory((previous) => previous.slice(0, -1));
  const updateTeam = (team, value) => setTeamNames((previous) => ({ ...previous, [team]: value }));
  const stepTitle = (step) => step?.kind === 'ban' ? 'Banir um mapa' : step?.kind === 'pick' ? `Escolher mapa ${step.slot}` : step?.decider ? 'Escolher lado do mapa decisivo' : `Escolher lado do mapa ${step?.slot}`;

  return <section className="veto-page">
    <div className="page-heading"><div><div className="eyebrow">SIMULAÇÃO DE SÉRIE</div><h1>Map veto</h1><p>Simule a ordem oficial de bans, picks e escolha de lado em uma série do VCT.</p></div>{started && <button className="button button-quiet" onClick={reset}><RotateCcw size={15} /> Reiniciar</button>}</div>
    {!started ? <>
      <div className="veto-setup-grid">
        <div className="panel veto-setup-panel"><div className="panel-heading"><div><h2>Configurar matchup</h2><p>Defina o formato e qual equipe você representa.</p></div><Swords size={18} className="muted-icon" /></div>
          <div className="veto-format-choice"><button className={format === 'bo3' ? 'selected' : ''} onClick={() => setFormat('bo3')}><strong>BO3</strong><span>Melhor de 3 · 3 mapas</span></button><button className={format === 'bo5' ? 'selected' : ''} onClick={() => setFormat('bo5')}><strong>BO5</strong><span>Melhor de 5 · 5 mapas</span></button></div>
          {format === 'bo5' && <div className="veto-final-config"><label className="veto-final-toggle"><input type="checkbox" checked={grandFinal} onChange={(event) => setGrandFinal(event.target.checked)} /><span><strong>Grande final de eliminação dupla</strong><small>O time da chave superior bane os dois primeiros mapas.</small></span></label>{grandFinal && <div className="veto-upper-team"><span className="field-label">Time da chave superior</span><div className="veto-side-choice"><button className={upperTeam === 'A' ? 'selected' : ''} onClick={() => setUpperTeam('A')}>Time A</button><button className={upperTeam === 'B' ? 'selected' : ''} onClick={() => setUpperTeam('B')}>Time B</button></div></div>}</div>}
          <div className="veto-team-fields"><label className="field"><span className="field-label">Nome do Time A</span><input value={teamNames.A} onChange={(event) => updateTeam('A', event.target.value)} /></label><label className="field"><span className="field-label">Nome do Time B</span><input value={teamNames.B} onChange={(event) => updateTeam('B', event.target.value)} /></label></div>
          <div className="field"><span className="field-label">Você representa</span><div className="veto-side-choice"><button className={myTeam === 'A' ? 'selected' : ''} onClick={() => setMyTeam('A')}>Sou Time A</button><button className={myTeam === 'B' ? 'selected' : ''} onClick={() => setMyTeam('B')}>Sou Time B</button></div><span className="helper-text">No formato VCT, o Time A inicia o processo de veto.</span></div>
        </div>
        <div className="panel veto-pool-panel"><div className="panel-heading"><div><h2>Pool de mapas</h2><p>Selecione exatamente 7 mapas para esta série.</p></div><span className="small-counter">{pool.length} / 7</span></div>
          <div className="veto-pool-grid">{mapNames.map((map) => <button key={map} className={`veto-pool-chip ${pool.includes(map) ? 'active' : ''}`} onClick={() => changePool(map)} disabled={!pool.includes(map) && pool.length >= 7} aria-pressed={pool.includes(map)}><span className="veto-pool-check">{pool.includes(map) && <Check size={12} />}</span>{map}</button>)}</div>
          <p className="veto-pool-note"><CircleHelp size={14} /> O pool pode variar entre torneios. Ajuste os mapas conforme o evento que quer simular. As imagens carregam pela internet; sem conexão, os cards usam fundos coloridos.</p>
        </div>
      </div>
      <div className="veto-setup-footer"><span><ShieldCheck size={15} /> Formato VCT 2026 · escolha todas as ações dos dois times</span><button className="button button-primary" disabled={pool.length !== 7} onClick={start}>Começar simulação <ArrowRight size={16} /></button></div>
    </> : <div className="veto-simulation-layout">
      <div className="veto-main-column">
        <div className="panel veto-board">
          <div className="veto-board-top"><div><span className="eyebrow">{format.toUpperCase()} · {teamNames.A} VS {teamNames.B}</span><h2>{complete ? 'Veto concluído' : 'Sequência do map veto'}</h2></div><div className="veto-progress"><span>{history.length} / {steps.length}</span><div className="progress-track"><div className="progress-fill" style={{ width: `${(history.length / steps.length) * 100}%` }} /></div></div></div>
          {currentStep && <div className="veto-turn-card" key={`${history.length}-${currentStep.kind}`}><div className="veto-turn-number">ETAPA {history.length + 1}</div><div className="veto-turn-heading"><div><span className="veto-turn-kicker">{currentStep.kind === 'ban' ? 'BANIMENTO' : currentStep.kind === 'pick' ? 'MAP PICK' : 'LADO'}</span><h3>{stepTitle(currentStep)}</h3></div><div className={`veto-team-badge team-${currentStep.team}`}><span>{currentStep.team === myTeam ? 'SUA EQUIPE' : 'OUTRA EQUIPE'}</span><strong>{teamNames[currentStep.team]}</strong></div></div>
            {currentStep.kind === 'side' ? <div className="veto-choice-grid sides"><button onClick={() => choose('Ataque')}><Swords size={18} /><strong>Ataque</strong><span>Começar no lado atacante</span></button><button onClick={() => choose('Defesa')}><ShieldCheck size={18} /><strong>Defesa</strong><span>Começar no lado defensor</span></button></div> : <div className="veto-choice-grid maps">{remainingMaps.map((map, index) => <button key={map} className={`veto-map-choice map-tone-${index % 5} ${mapArtwork[map] ? 'has-map-art' : ''}`} style={mapArtwork[map] ? { backgroundImage: `linear-gradient(180deg, rgba(8, 14, 24, .25) 0%, rgba(8, 14, 24, .52) 38%, rgba(8, 14, 24, .96) 100%), url("${mapArtwork[map]}")` } : undefined} onClick={() => choose(map)}><span className="veto-map-index">{String(index + 1).padStart(2, '0')}</span><strong>{map}</strong><span className="veto-choice-verb">{currentStep.kind === 'ban' ? <><Ban size={13} /> Banir mapa</> : <><ArrowRight size={13} /> Escolher mapa</>}</span></button>)}</div>}
          </div>}
          {complete && <div className="veto-complete-banner"><Check size={18} /><div><strong>Map veto finalizado</strong><span>Confira a ordem de mapas e lados abaixo.</span></div><button className="button button-secondary button-small" onClick={reset}><RotateCcw size={14} /> Nova simulação</button></div>}
        </div>
        <div className="panel veto-history-panel"><div className="panel-heading"><div><h2>Histórico de decisões</h2><p>Cada ação aparece na ordem em que foi escolhida.</p></div><button className="icon-button" disabled={!history.length} title="Desfazer última ação" onClick={undo}><RotateCcw size={15} /></button></div>
          {history.length ? <div className="veto-history-list">{history.map((item, index) => <div className="veto-history-item" key={`${index}-${item.kind}-${item.map}`}><span className={`history-step-icon ${item.kind}`}>{item.kind === 'ban' ? <Ban size={14} /> : item.kind === 'pick' ? <MapIcon size={14} /> : <Swords size={14} />}</span><span className="history-order">{String(index + 1).padStart(2, '0')}</span><span className="history-team"><strong>{teamNames[item.team]}</strong><small>{item.kind === 'ban' ? 'BANIU' : item.kind === 'pick' ? `PICKOU MAPA ${item.slot}` : `ESCOLHEU LADO · ${item.map}`}</small></span><strong className="history-choice">{item.kind === 'side' ? `${item.side} · ${item.map}` : item.map}</strong></div>)}</div> : <div className="veto-history-empty"><MapIcon size={21} /><span>Suas decisões vão aparecer aqui.</span></div>}
        </div>
      </div>
      <aside className="panel veto-series-panel"><div className="panel-heading"><div><h2>Ordem da série</h2><p>Mapas definidos até agora</p></div></div>
        <div className="veto-series-list">{Array.from({ length: format === 'bo3' ? 3 : 5 }, (_, index) => {
          const mapItem = pickedMaps.find((item) => item.slot === index + 1);
          const finalMap = index === (format === 'bo3' ? 2 : 4) ? remainingMaps.length === 1 ? remainingMaps[0] : '' : '';
          const map = mapItem?.map || finalMap;
          const sideItem = history.find((item) => item.kind === 'side' && item.slot === index + 1);
          const selectorTeam = sideItem?.team;
          const startingSide = sideItem?.side;
          return <div className={`veto-series-map ${map ? 'revealed' : ''}`} key={index}><span className="series-map-index">MAPA {index + 1}</span><strong>{map || 'A definir'}</strong>{map && <span className="series-map-side">{startingSide ? `${teamNames[selectorTeam]} começa ${startingSide.toLowerCase()}` : 'Lado ainda não escolhido'}</span>}</div>;
        })}</div>
        <div className="veto-legend"><span><i className="legend-ban" /> Banido</span><span><i className="legend-pick" /> Pick</span><span><i className="legend-decider" /> Decider</span></div>
      </aside>
    </div>}
  </section>;
}

function LineupsPage({ lineups, allLineups, maps, search, onSearch, onAdd, onEdit, onDelete, onOpen }) {
  const [selectedMap, setSelectedMap] = useState('');
  const rows = lineups.filter((item) => !selectedMap || item.map === selectedMap);
  const countForMap = (map) => allLineups.filter((item) => item.map === map).length;
  return <section><div className="page-heading"><div><div className="eyebrow">PLAYBOOK PESSOAL</div><h1>{selectedMap ? `Lineups · ${selectedMap}` : 'Biblioteca de lineups'}</h1><p>{selectedMap ? `Lineups salvas na pasta de ${selectedMap}.` : 'Escolha um mapa para abrir a pasta com seus setups e referências.'}</p></div>{selectedMap && <button className="button button-primary" onClick={() => onAdd(selectedMap)}><Plus size={17} /> Nova lineup</button>}</div>
    <div className="toolbar">{selectedMap && <button className="button button-quiet button-small" onClick={() => setSelectedMap('')}><ArrowRight size={14} className="back-arrow" /> Todos os mapas</button>}<div className="search-field"><Search size={17} /><input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar por nome, mapa, agente ou habilidade..." /></div><div className="toolbar-note"><Target size={15} /> {selectedMap ? rows.length : allLineups.length} {selectedMap ? 'lineups nesta pasta' : 'lineups salvas'}</div></div>
    {selectedMap ? rows.length ? <div className="lineup-grid">{rows.map((lineup) => <LineupCard key={lineup.id} lineup={lineup} onEdit={() => onEdit(lineup)} onDelete={() => onDelete(lineup.id)} onOpen={() => onOpen(lineup.link)} />)}</div> : <EmptyState icon={Target} title="Pasta sem lineups" text="Adicione uma lineup para este mapa ou ajuste a busca." actionLabel="Nova lineup" onAction={() => onAdd(selectedMap)} /> : <div className="tactic-map-grid">{maps.map((map) => <button className="panel tactic-map-folder" key={map} onClick={() => setSelectedMap(map)}><span className="tactic-folder-icon"><FolderOpen size={22} /></span><strong>{map}</strong><span>{countForMap(map)} {countForMap(map) === 1 ? 'lineup' : 'lineups'}</span><ArrowRight size={15} className="folder-arrow" /></button>)}</div>}
  </section>;
}

function CatalogManager({ maps, agents, onAddMap, onAddAgent, onEditMap, onEditAgent, onDeleteMap, onDeleteAgent, onToggleMap, onToggleAgent }) {
  const [tab, setTab] = useState('maps');
  const sortedMaps = maps.slice().sort((a, b) => a.name.localeCompare(b.name));
  const sortedAgents = agents.slice().sort((a, b) => a.name.localeCompare(b.name));
  return <section><div className="page-heading"><div><div className="eyebrow">CATÁLOGO DO JOGO</div><h1>Mapas e agentes</h1><p>Gerencie os dados usados nos seletores, no veto e nos planos. Cadastros inativos continuam associados ao histórico.</p></div></div>
    <div className="catalog-tabs"><button className={tab === 'maps' ? 'active' : ''} onClick={() => setTab('maps')}><MapIcon size={16} /> Mapas <span>{maps.length}</span></button><button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}><Crosshair size={16} /> Agentes <span>{agents.length}</span></button></div>
    {tab === 'maps' ? <><div className="panel-heading catalog-list-heading"><div><h2>Mapas</h2><p>Ative apenas os mapas disponíveis no pool competitivo atual.</p></div><button className="button button-primary button-small" onClick={onAddMap}><Plus size={15} /> Adicionar mapa</button></div><div className="catalog-grid">{sortedMaps.map((map) => <article className={`panel catalog-card ${map.competitiveActive ? '' : 'is-inactive'}`} key={map.id}><div className="catalog-media map-media">{map.previewUrl ? <img src={map.previewUrl} alt={`Preview de ${map.name}`} /> : <MapIcon size={23} />}</div><div className="catalog-card-body"><div className="catalog-title-row"><strong>{map.name}</strong><span className={`catalog-status ${map.competitiveActive ? 'active' : ''}`}>{map.competitiveActive ? 'No competitivo' : 'Inativo'}</span></div><div className="catalog-actions"><button className="button button-quiet button-small" onClick={() => onToggleMap(map)}>{map.competitiveActive ? 'Desativar' : 'Ativar'}</button><button className="icon-button" title="Editar mapa" onClick={() => onEditMap(map)}><Pencil size={14} /></button><button className="icon-button danger" title="Excluir mapa" onClick={() => onDeleteMap(map.id)}><Trash2 size={14} /></button></div></div></article>)}</div></> : <><div className="panel-heading catalog-list-heading"><div><h2>Agentes</h2><p>Classifique por função e controle quais aparecem nos novos registros.</p></div><button className="button button-primary button-small" onClick={onAddAgent}><Plus size={15} /> Adicionar agente</button></div><div className="catalog-grid agents-catalog-grid">{sortedAgents.map((agent) => <article className={`panel catalog-card agent-catalog-card ${agent.active ? '' : 'is-inactive'}`} key={agent.id}><div className="catalog-agent-icon">{agent.iconUrl ? <img src={agent.iconUrl} alt="" /> : <Crosshair size={22} />}</div><div className="catalog-card-body"><div className="catalog-title-row"><strong>{agent.name}</strong><span className={`catalog-status ${agent.active ? 'active' : ''}`}>{agent.active ? 'Ativo' : 'Inativo'}</span></div><span className="agent-role-label">{agent.role}</span><div className="catalog-actions"><button className="button button-quiet button-small" onClick={() => onToggleAgent(agent)}>{agent.active ? 'Desativar' : 'Ativar'}</button><button className="icon-button" title="Editar agente" onClick={() => onEditAgent(agent)}><Pencil size={14} /></button><button className="icon-button danger" title="Excluir agente" onClick={() => onDeleteAgent(agent.id)}><Trash2 size={14} /></button></div></div></article>)}</div></>}
  </section>;
}

function GameplansPage({ gameplans, maps, onAdd, onEdit, onDelete }) {
  const [selectedMap, setSelectedMap] = useState('');
  const rows = gameplans.filter((plan) => plan.map === selectedMap);
  const countForMap = (map) => gameplans.filter((plan) => plan.map === map).length;
  return <section><div className="page-heading"><div><div className="eyebrow">ESTRATÉGIA DE EQUIPE</div><h1>{selectedMap ? `Gameplans · ${selectedMap}` : 'Gameplans'}</h1><p>{selectedMap ? `Planos de jogo salvos na pasta de ${selectedMap}.` : 'Escolha um mapa para abrir a pasta com seus planos de jogo.'}</p></div>{selectedMap && <button className="button button-primary" onClick={() => onAdd(selectedMap)}><Plus size={17} /> Novo Gameplan</button>}</div>
    {selectedMap ? <><div className="toolbar"><button className="button button-quiet button-small" onClick={() => setSelectedMap('')}><ArrowRight size={14} className="back-arrow" /> Todos os mapas</button><span className="toolbar-note">{rows.length} Gameplans nesta pasta</span></div>{rows.length ? <div className="lineup-grid">{rows.map((plan) => <article className="panel gameplan-card" key={plan.id}><div className="gameplan-card-top"><span className="gameplan-icon"><Swords size={20} /></span><span className="agent-pill">{plan.side}</span></div><div className="gameplan-card-body"><div className="lineup-kicker">{plan.map}</div><h3>{plan.name}</h3>{plan.agents?.length > 0 && <div className="gameplan-agents"><Crosshair size={14} /> {plan.agents.join(' · ')}</div>}{plan.description && <p className="lineup-instructions">{plan.description}</p>}<div className="lineup-card-footer"><span className="lineup-saved">Plano reutilizável</span><div className="lineup-actions"><button className="icon-button" title="Editar Gameplan" onClick={() => onEdit(plan)}><Pencil size={15} /></button><button className="icon-button danger" title="Excluir Gameplan" onClick={() => onDelete(plan.id)}><Trash2 size={15} /></button></div></div></div></article>)}</div> : <EmptyState icon={Swords} title="Pasta sem Gameplans" text="Cadastre o primeiro plano de jogo para este mapa." actionLabel="Criar Gameplan" onAction={() => onAdd(selectedMap)} />}</> : <div className="tactic-map-grid">{maps.map((map) => <button className="panel tactic-map-folder" key={map} onClick={() => setSelectedMap(map)}><span className="tactic-folder-icon"><FolderOpen size={22} /></span><strong>{map}</strong><span>{countForMap(map)} {countForMap(map) === 1 ? 'Gameplan' : 'Gameplans'}</span><ArrowRight size={15} className="folder-arrow" /></button>)}</div>}
  </section>;
}

function TacticsPage({ tactics, maps, onAdd, onEdit, onDelete, onOpen, onExportDefaults, onImportDefaults }) {
  const [selectedMap, setSelectedMap] = useState('');
  const [category, setCategory] = useState('Todas');
  const importRef = useRef(null);
  const mapCounts = new Map(tactics.map((item) => [item.map, (tactics.filter((row) => row.map === item.map).length)]));
  const rows = tactics.filter((item) => item.map === selectedMap && (category === 'Todas' || item.category === category));
  return <section><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={onImportDefaults} /><div className="page-heading"><div><div className="eyebrow">PLAYBOOK DE EQUIPE</div><h1>{selectedMap || 'Táticos'}</h1><p>{selectedMap ? `Táticas salvas na pasta de ${selectedMap}.` : 'Escolha um mapa para abrir sua pasta de táticos.'}</p></div><div className="tactics-header-actions"><button className="button button-secondary button-small" onClick={onExportDefaults}><ArrowDownToLine size={14} /> Exportar Defaults</button><button className="button button-secondary button-small" onClick={() => importRef.current?.click()}><ArrowUpFromLine size={14} /> Importar Defaults</button>{selectedMap && <button className="button button-primary" onClick={() => onAdd(selectedMap)}><Plus size={17} /> Novo tático</button>}</div></div>
    {selectedMap ? <><div className="toolbar"><button className="button button-quiet button-small" onClick={() => { setSelectedMap(''); setCategory('Todas'); }}><ArrowRight size={14} className="back-arrow" /> Todos os mapas</button><div className="filter-field"><select value={category} onChange={(e) => setCategory(e.target.value)}><option>Todas</option>{['Default', 'Execução', 'Pistol', 'Antieco', 'Rounds de ultimate'].map((item) => <option key={item}>{item}</option>)}</select></div><span className="toolbar-note">{rows.length} táticas</span></div>
      {rows.length ? <div className="tactic-grid">{rows.map((item) => <article className="panel tactic-card" key={item.id}><div className={`tactic-image ${item.imageData ? 'has-image' : ''}`}>{item.imageData ? <img src={item.imageData} alt={`Print de ${item.title}`} /> : <BookOpen size={25} />}</div><div className="tactic-card-body"><div className="vod-card-title-row"><h3>{item.title}</h3><span className="agent-pill">{item.category}</span></div><div className="vod-meta-row"><span><Swords size={14} /> {item.side || 'Ambos'}</span></div>{item.description && <p className="vod-notes">{item.description}</p>}<div className="vod-card-actions">{item.link && <button className="button button-secondary button-small" onClick={() => onOpen(item.link)}><ExternalLink size={14} /> Referência</button>}<button className="button button-quiet button-small" onClick={() => onEdit(item)}><Pencil size={14} /> Editar</button><button className="button button-danger-quiet button-small" onClick={() => onDelete(item.id)}><Trash2 size={14} /> Excluir</button></div></div></article>)}</div> : <EmptyState icon={BookOpen} title="Pasta sem táticos" text="Adicione o primeiro tático deste mapa. Você pode incluir descrição, print e link de referência." actionLabel="Adicionar tático" onAction={() => onAdd(selectedMap)} />}
    </> : <div className="tactic-map-grid">{maps.map((map) => <button className="panel tactic-map-folder" key={map} onClick={() => setSelectedMap(map)}><span className="tactic-folder-icon"><FolderOpen size={22} /></span><strong>{map}</strong><span>{mapCounts.get(map) || 0} {(mapCounts.get(map) || 0) === 1 ? 'tático' : 'táticos'}</span><ArrowRight size={15} className="folder-arrow" /></button>)}</div>}
  </section>;
}

function TrainingPage({ training, onAdd, onEdit, onDelete, onToggle }) {
  const weekKey = (date) => { const d = new Date(`${date || today()}T12:00:00`); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };
  const grouped = new Map();
  training.forEach((item) => { const key = weekKey(item.week); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(item); });
  return <section><div className="page-heading"><div><div className="eyebrow">ROTINA DE EVOLUÇÃO</div><h1>Treino individual</h1><p>Monte seu plano semanal, acompanhe o que concluiu e ajuste a rotina.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Adicionar treino</button></div>
    {grouped.size ? [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([week, items]) => <div className="panel training-week" key={week}><div className="panel-heading"><div><h2>Semana de {formatDate(week)}</h2><p>{items.filter((item) => item.done).length} de {items.length} treinos concluídos</p></div></div><div className="training-list">{items.map((item) => <div className={`training-item ${item.done ? 'completed' : ''}`} key={item.id}><button className="training-check" aria-label={item.done ? 'Marcar pendente' : 'Marcar concluído'} onClick={() => onToggle(item)}>{item.done && <Check size={14} />}</button><div className="training-copy"><strong>{item.title}</strong><span>{item.category || 'Mecânica'}{item.minutes ? ` · ${item.minutes} min` : ''}{item.notes ? ` · ${item.notes}` : ''}</span></div><button className="icon-button" title="Editar" onClick={() => onEdit(item)}><Pencil size={14} /></button><button className="icon-button danger" title="Excluir" onClick={() => onDelete(item.id)}><Trash2 size={14} /></button></div>)}</div></div>) : <EmptyState icon={Activity} title="Planeje sua semana" text="Adicione os fundamentos que quer trabalhar e acompanhe seu progresso." actionLabel="Adicionar primeiro treino" onAction={onAdd} />}
  </section>;
}

function Dashboard({ data, overall, mapsStats, agentsStats, onAddVod, onAddLineup, onGo, onOpenVOD, onReview }) {
  const recent = data.vods.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 5);
  const bestMap = mapsStats.filter((s) => s.decisions > 0).slice().sort((a, b) => b.winrate - a.winrate || b.decisions - a.decisions)[0];
  return <section>
    <div className="welcome-row"><div><div className="eyebrow">PLAYER DASHBOARD <span className="live-pip" /></div><h1>Seu centro de performance.</h1><p>VODs organizados, lineups prontas e dados para evoluir com intenção.</p></div><div className="welcome-date"><span>WORKSPACE PESSOAL</span><strong>{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div></div>
    <div className="stats-cards">
      <MetricCard icon={FileVideo2} label="VODs registradas" value={overall.matches} detail={`${overall.wins} vitórias · ${overall.losses} derrotas`} accent="blue" />
      <MetricCard icon={Trophy} label="Winrate geral" value={percent(overall.winrate)} detail={`${overall.decisions} partidas com decisão`} accent="green" />
      <MetricCard icon={Swords} label="Abates registrados" value={overall.kills} detail={`Média de ${overall.avgKills.toFixed(1).replace('.', ',')} por VOD`} accent="purple" />
      <MetricCard icon={Target} label="Lineups salvas" value={data.lineups.length} detail="No seu playbook pessoal" accent="orange" />
      <MetricCard icon={Activity} label="Média de K/D por VOD" value={overall.kdMatches ? `${overall.avgKD.toFixed(2).replace('.', ',')}x` : '—'} detail={`${overall.kdMatches} VODs com mortes registradas`} accent="blue" />
    </div>
    <div className="dashboard-grid">
      <div className="panel performance-panel"><div className="panel-heading"><div><h2>Winrate por mapa</h2><p>Visão rápida dos mapas que você registrou</p></div><button className="text-link" onClick={() => onGo('stats')}>Ver análise <ExternalLink size={13} /></button></div>
        {mapsStats.length ? <div className="map-performance-list">{mapsStats.slice(0, 6).map((stat) => <div className="map-performance" key={stat.name}><div className="map-letter">{stat.name.slice(0, 1).toUpperCase()}</div><div className="map-performance-content"><div className="bar-label-row"><strong>{stat.name}</strong><span>{stat.wins}V – {stat.losses}D{stat.draws ? ` – ${stat.draws}E` : ''}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${stat.winrate}%` }} /></div></div><div className={`map-percent ${stat.decisions && stat.winrate >= 50 ? 'good' : ''}`}>{percent(stat.winrate)}</div></div>)}</div> : <div className="panel-empty"><MapIcon size={22} /><span>Adicione VODs para gerar seu gráfico por mapa.</span></div>}
      </div>
      <div className="panel quick-panel"><div className="panel-heading"><div><h2>Acesso rápido</h2><p>Continue seu trabalho de preparação</p></div><Zap size={17} className="muted-icon" /></div>
        <button className="quick-action" onClick={onAddVod}><div className="quick-icon blue-bg"><Plus size={18} /></div><div><strong>Registrar partida</strong><span>Adicionar VOD, mapa, agente e resultado</span></div><span className="quick-arrow">↗</span></button>
        <button className="quick-action" onClick={onAddLineup}><div className="quick-icon purple-bg"><Target size={18} /></div><div><strong>Salvar lineup</strong><span>Adicionar imagem, execução e referência</span></div><span className="quick-arrow">↗</span></button>
        <button className="quick-action" onClick={() => onGo('stats')}><div className="quick-icon green-bg"><BarChart3 size={18} /></div><div><strong>Revisar estatísticas</strong><span>Comparar mapas e agentes</span></div><span className="quick-arrow">↗</span></button>
        {bestMap && <div className="best-map-note"><div className="best-map-icon"><Activity size={17} /></div><div><span>Seu melhor winrate registrado</span><strong>{bestMap.name} <em>{percent(bestMap.winrate)}</em></strong><small>Base: {bestMap.decisions} partidas com decisão</small></div></div>}
      </div>
    </div>
    <div className="panel recent-panel"><div className="panel-heading"><div><h2>Partidas recentes</h2><p>Últimos registros da sua biblioteca</p></div><button className="text-link" onClick={() => onGo('vods')}>Ver biblioteca <ExternalLink size={13} /></button></div>
      {recent.length ? <div className="recent-table-wrap"><table className="data-table"><thead><tr><th>PARTIDA</th><th>MAPA</th><th>AGENTE</th><th>ABATES</th><th>RESULTADO</th><th>DATA</th><th /></tr></thead><tbody>{recent.map((vod) => <tr key={vod.id}><td><div className="match-title-cell"><span className="mini-vod-icon"><Video size={14} /></span><strong>{vod.title}</strong></div></td><td>{vod.map}</td><td><span className="agent-pill">{vod.agent}</span></td><td className="numeric-cell">{Number(vod.kills) || 0}</td><td><ResultBadge result={vod.result} /></td><td className="date-cell">{formatDate(vod.date)}</td><td><button className="icon-button" title={vod.localVideoPath || vod.analysisData ? "Review Interativa do Treino" : "Abrir VOD"} onClick={() => (vod.localVideoPath || vod.analysisData ? onReview(vod) : onOpenVOD(vod.link))} disabled={!vod.link && !vod.localVideoPath && !vod.analysisData}>{vod.localVideoPath || vod.analysisData ? <Play size={14} style={{ color: '#54d6a2' }} /> : <ExternalLink size={15} />}</button></td></tr>)}</tbody></table></div> : <div className="table-empty"><FileVideo2 size={20} /><span>Nenhuma partida registrada ainda.</span><button className="text-link" onClick={onAddVod}>Adicionar primeira VOD <Plus size={13} /></button></div>}
    </div>
    <div className="dashboard-bottom-note"><CircleHelp size={15} /><span>O winrate é calculado como vitórias ÷ (vitórias + derrotas). Empates ficam fora desse cálculo.</span></div>
  </section>;
}

function MetricCard({ icon: Icon, label, value, detail, accent }) {
  return <div className="metric-card"><div className={`metric-icon ${accent}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div><div className={`metric-accent-line ${accent}`} /></div>;
}

function ResultBadge({ result }) {
  const type = result === 'Vitória' ? 'win' : result === 'Derrota' ? 'loss' : 'draw';
  return <span className={`result-badge ${type}`}><span />{result || '—'}</span>;
}

function VodCard({ vod, gameplan, onEdit, onDelete, onOpen, onReview }) {
  const duels = Array.isArray(vod.openingDuels) ? vod.openingDuels : [];
  return <article className="vod-card"><div className="vod-card-symbol"><FileVideo2 size={22} /></div><div className="vod-card-main"><div className="vod-card-title-row"><h3>{vod.title}</h3><ResultBadge result={vod.result} /></div><div className="vod-meta-row"><span><MapIcon size={14} /> {vod.map}</span><span><Crosshair size={14} /> {vod.agent}</span><span><Swords size={14} /> {Number(vod.kills) || 0} abates</span><span>{Number(vod.deaths) || 0} mortes</span><span>{Number(vod.assists) || 0} assistências</span>{vod.roundsWon != null && vod.roundsLost != null && <span><Trophy size={14} /> {vod.roundsWon} × {vod.roundsLost}</span>}<span><BookOpen size={14} /> {formatDate(vod.date)}</span></div>{duels.length > 0 && <div className="opening-duel-summary"><strong>Eventos de abertura · {duels.length}</strong><div>{duels.map((item, i) => <span key={i}><b>{item.event}</b> · R{item.round || '?'}{item.time ? ` · ${item.time}` : ''}{item.player ? ` · ${item.player}` : ''}</span>)}</div></div>}{gameplan && <p className="vod-notes"><strong>Gameplan:</strong> {gameplan.name} · {gameplan.side}</p>}{vod.gamePlan && <p className="vod-notes"><strong>Notas de estratégia:</strong> {vod.gamePlan}</p>}{vod.notes && <p className="vod-notes">{vod.notes}</p>}<div className="vod-card-actions">{(vod.localVideoPath || vod.analysisData) && <button className="button button-primary button-small" onClick={onReview}><Play size={14} /> Review do Treino</button>}{vod.link && <button className="button button-secondary button-small" onClick={onOpen}><ExternalLink size={14} /> Abrir VOD</button>}<button className="button button-quiet button-small" onClick={onEdit}><Pencil size={14} /> Editar</button><button className="button button-danger-quiet button-small" onClick={onDelete}><Trash2 size={14} /> Excluir</button></div></div></article>;
}

function LineupCard({ lineup, onEdit, onDelete, onOpen }) {
  return <article className="lineup-card"><div className={`lineup-image ${lineup.imageData ? 'has-image' : ''}`}>{lineup.imageData ? <img src={lineup.imageData} alt={`Imagem de ${lineup.title}`} /> : <div className="lineup-placeholder"><Target size={28} /><span>{lineup.map}</span></div>}<span className={`side-tag ${lineup.side?.toLowerCase()}`}>{lineup.side || 'Ataque'}</span></div><div className="lineup-card-body"><div className="lineup-kicker">{lineup.map} <span>•</span> {lineup.agent}</div><h3>{lineup.title}</h3>{lineup.ability && <div className="ability-label"><Zap size={13} /> {lineup.ability}</div>}{lineup.instructions && <p className="lineup-instructions">{lineup.instructions}</p>}<div className="lineup-card-footer"><span className="lineup-saved"><Check size={13} /> Salva no playbook</span><div className="lineup-actions">{lineup.link && <button className="icon-button" title="Abrir referência" onClick={onOpen}><ExternalLink size={15} /></button>}<button className="icon-button" title="Editar lineup" onClick={onEdit}><Pencil size={15} /></button><button className="icon-button danger" title="Excluir lineup" onClick={onDelete}><Trash2 size={15} /></button></div></div></div></article>;
}

function StatsPage({ vods, gameplans = [], mapsStats, agentsStats, mapAgentStats }) {
  const [selectedMap, setSelectedMap] = useState('Todos');
  const [selectedAgent, setSelectedAgent] = useState('Todos');
  const mapNames = uniqueSorted(vods.map((v) => v.map));
  const agentNames = uniqueSorted(vods.map((v) => v.agent));
  const filtered = vods.filter((v) => (selectedMap === 'Todos' || v.map === selectedMap) && (selectedAgent === 'Todos' || v.agent === selectedAgent));
  const currentStats = calcStats(filtered);
  const byMapInFilter = groupStats(filtered, (v) => v.map);
  const byAgentInFilter = groupStats(filtered, (v) => v.agent);
  const cross = groupStats(filtered, (v) => v.map && v.agent ? `${v.map} · ${v.agent}` : '');
  return <section>
    <div className="page-heading"><div><div className="eyebrow">DADOS DE PERFORMANCE</div><h1>Estatísticas</h1><p>Encontre mapas fortes, agentes consistentes e combinações que merecem atenção.</p></div></div>
    <div className="stats-filter-panel"><div className="stats-filter-intro"><ListFilter size={18} /><div><strong>Filtrar análise</strong><span>Os indicadores e rankings abaixo respeitam esses filtros.</span></div></div><div className="stats-filters"><Field label="Mapa"><select value={selectedMap} onChange={(e) => setSelectedMap(e.target.value)}><option>Todos</option>{mapNames.map((m) => <option key={m}>{m}</option>)}</select></Field><Field label="Agente"><select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}><option>Todos</option>{agentNames.map((a) => <option key={a}>{a}</option>)}</select></Field></div></div>
    <div className="stats-cards-row"><MetricCard icon={Video} label="Partidas no filtro" value={currentStats.matches} detail={`${currentStats.draws} empates`} accent="blue" /><MetricCard icon={Trophy} label="Winrate no filtro" value={percent(currentStats.winrate)} detail={`${currentStats.wins}V · ${currentStats.losses}D`} accent="green" /><MetricCard icon={Swords} label="Abates no filtro" value={currentStats.kills} detail={`Média ${currentStats.avgKills.toFixed(1).replace('.', ',')} por jogo · ${currentStats.deaths} mortes · ${currentStats.assists} assistências`} accent="purple" /><MetricCard icon={Activity} label="Média de K/D por VOD" value={currentStats.kdMatches ? `${currentStats.avgKD.toFixed(2).replace('.', ',')}x` : '—'} detail={`${currentStats.kdMatches} VODs com mortes registradas`} accent="orange" /></div>
    <div className="stats-analysis-grid"><StatPanel title="Desempenho por mapa" subtitle="Winrate e volume de partidas" rows={byMapInFilter} empty="Não há partidas para os filtros selecionados." /><StatPanel title="Desempenho por agente" subtitle="Winrate e volume de partidas" rows={byAgentInFilter} empty="Não há partidas para os filtros selecionados." /></div>
    <div className="panel cross-panel"><div className="panel-heading"><div><h2>Mapa + agente</h2><p>Compare suas combinações e evite tirar conclusões com poucas partidas.</p></div><span className="small-counter">{cross.length} combinações</span></div>{cross.length ? <div className="recent-table-wrap"><table className="data-table stats-table"><thead><tr><th>MAPA · AGENTE</th><th>PARTIDAS</th><th>VITÓRIAS</th><th>DERROTAS</th><th>EMPATES</th><th>WINRATE</th></tr></thead><tbody>{cross.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.matches}</td><td className="win-text">{row.wins}</td><td className="loss-text">{row.losses}</td><td>{row.draws}</td><td><div className="table-rate"><div className="progress-track"><div className="progress-fill" style={{ width: `${row.winrate}%` }} /></div><strong>{percent(row.winrate)}</strong></div></td></tr>)}</tbody></table></div> : <div className="table-empty"><BarChart3 size={20} /><span>Adicione VODs para comparar mapa e agente.</span></div>}</div>
    <GameplanStatsPanel vods={vods} gameplans={gameplans} />
    <div className="dashboard-bottom-note"><CircleHelp size={15} /><span>Empates não entram no denominador do winrate. Para uma leitura confiável, compare também o número de partidas de cada combinação.</span></div>
  </section>;
}

function GameplanStatsPanel({ vods, gameplans }) {
  const [map, setMap] = useState('Todos');
  const [side, setSide] = useState('Todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const mapOptions = uniqueSorted(gameplans.map((plan) => plan.map));
  const rows = gameplans.filter((plan) => (map === 'Todos' || plan.map === map) && (side === 'Todos' || plan.side === side)).map((plan) => {
    const matches = vods.filter((vod) => vod.gameplanId === plan.id && (!from || vod.date >= from) && (!to || vod.date <= to));
    const wins = matches.filter((vod) => vod.result === 'Vitória').length;
    const losses = matches.filter((vod) => vod.result === 'Derrota').length;
    const decisions = wins + losses;
    const scored = matches.filter((vod) => Number.isFinite(Number(vod.roundsWon)) && Number.isFinite(Number(vod.roundsLost)) && vod.roundsWon != null && vod.roundsLost != null);
    const roundsWon = scored.reduce((total, vod) => total + Number(vod.roundsWon), 0);
    const roundsLost = scored.reduce((total, vod) => total + Number(vod.roundsLost), 0);
    return { ...plan, matches: matches.length, wins, losses, decisions, winrate: decisions ? wins / decisions * 100 : 0, roundsWon, roundsLost, roundBalance: scored.length ? roundsWon - roundsLost : null };
  });
  const ranked = rows.filter((row) => row.decisions > 0).sort((a, b) => b.winrate - a.winrate || b.decisions - a.decisions);
  return <div className="panel cross-panel gameplan-report"><div className="panel-heading"><div><h2>Desempenho por Gameplan</h2><p>Compare vitórias, winrate e saldo de rounds dos planos usados nas partidas.</p></div><span className="small-counter">{rows.length} planos</span></div>
    <div className="gameplan-report-filters"><Field label="Mapa"><select value={map} onChange={(e) => setMap(e.target.value)}><option>Todos</option>{mapOptions.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Lado"><select value={side} onChange={(e) => setSide(e.target.value)}><option>Todos</option><option>Ataque</option><option>Defesa</option><option>Ambos</option></select></Field><Field label="De"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
    {ranked.length > 0 && <div className="gameplan-rankings"><div><span>Maior winrate</span><strong>{ranked[0].name}</strong><small>{percent(ranked[0].winrate)} · {ranked[0].decisions} partidas decididas</small></div><div><span>Menor winrate</span><strong>{ranked[ranked.length - 1].name}</strong><small>{percent(ranked[ranked.length - 1].winrate)} · {ranked[ranked.length - 1].decisions} partidas decididas</small></div></div>}
    {rows.length ? <div className="recent-table-wrap"><table className="data-table stats-table"><thead><tr><th>GAMEPLAN</th><th>MAPA · LADO</th><th>PARTIDAS</th><th>V · D · E</th><th>WINRATE</th><th>ROUNDS</th><th>SALDO</th></tr></thead><tbody>{rows.sort((a, b) => b.winrate - a.winrate || b.matches - a.matches).map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.map} · {row.side}</td><td>{row.matches}</td><td><span className="win-text">{row.wins}</span> · <span className="loss-text">{row.losses}</span> · {row.matches - row.wins - row.losses}</td><td><div className="table-rate"><div className="progress-track"><div className="progress-fill" style={{ width: `${row.winrate}%` }} /></div><strong>{row.decisions ? percent(row.winrate) : '—'}</strong></div></td><td>{row.roundBalance == null ? '—' : `${row.roundsWon} × ${row.roundsLost}`}</td><td className={row.roundBalance > 0 ? 'win-text' : row.roundBalance < 0 ? 'loss-text' : ''}>{row.roundBalance == null ? '—' : `${row.roundBalance > 0 ? '+' : ''}${row.roundBalance}`}</td></tr>)}</tbody></table></div> : <div className="table-empty"><Swords size={20} /><span>Cadastre Gameplans para comparar os resultados.</span></div>}
  </div>;
}

function StatPanel({ title, subtitle, rows, empty }) {
  return <div className="panel stat-panel"><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{rows.length ? <div className="stat-bars">{rows.map((row) => <div className="stat-bar-row" key={row.name}><div className="stat-name-row"><strong>{row.name}</strong><span>{row.wins}V · {row.losses}D{row.draws ? ` · ${row.draws}E` : ''}</span></div><div className="stat-bar-bottom"><div className="progress-track"><div className="progress-fill" style={{ width: `${row.winrate}%` }} /></div><strong className={row.decisions && row.winrate >= 50 ? 'good' : ''}>{percent(row.winrate)}</strong></div><span className="stat-games">{row.matches} {row.matches === 1 ? 'partida' : 'partidas'}</span></div>)}</div> : <div className="panel-empty"><BarChart3 size={22} /><span>{empty}</span></div>}</div>;
}

function EmptyState({ icon: Icon, title, text, actionLabel, onAction }) {
  return <div className="empty-state"><div className="empty-state-icon"><Icon size={26} /></div><h2>{title}</h2><p>{text}</p><button className="button button-primary" onClick={onAction}><Plus size={16} /> {actionLabel}</button></div>;
}

function Field({ label, children }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

function InteractiveVodReviewModal({ vod, onClose }) {
  const videoRef = useRef(null);
  const [selectedRound, setSelectedRound] = useState(0); // 0 = all
  const [activeTab, setActiveTab] = useState('timeline'); // 'timeline' | 'scoreboard'

  const videoUrl = window.kringAPI?.toLocalVideoUrl && vod.localVideoPath
    ? window.kringAPI.toLocalVideoUrl(vod.localVideoPath)
    : '';

  const analysis = vod.analysisData || {};
  const rounds = analysis.rounds || [];
  const allKills = analysis.all_kills || [];
  const playersStats = analysis.players_stats || {};

  const displayedKills = selectedRound === 0
    ? allKills
    : (rounds.find((r) => r.round_number === selectedRound)?.kills || []);

  const seekTo = (seconds) => {
    if (videoRef.current && Number.isFinite(seconds)) {
      videoRef.current.currentTime = Math.max(0, seconds - 1.5);
      videoRef.current.play().catch(() => {});
    }
  };

  const parseTimeToSeconds = (str) => {
    if (!str) return 0;
    const parts = str.split(':');
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    return 0;
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="review-modal-card" role="dialog" aria-modal="true">
        <header className="review-modal-header">
          <h2>
            <Play size={20} className="badge-team-friendly" />
            <span>Review do Treino: <strong>{vod.title}</strong></span>
            <span className="agent-pill">{vod.map || 'Valorant'}</span>
            <span className={`result-badge ${vod.result === 'Vitória' ? 'win' : vod.result === 'Derrota' ? 'loss' : 'draw'}`}>
              {vod.result} ({vod.roundsWon ?? '—'} × {vod.roundsLost ?? '—'})
            </span>
          </h2>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="review-modal-body">
          <div className="review-player-section">
            <div className="review-video-wrap">
              {videoUrl ? (
                <video ref={videoRef} src={videoUrl} controls autoPlay />
              ) : (
                <div style={{ color: '#889', textAlign: 'center', padding: '40px' }}>
                  <FileVideo2 size={44} style={{ opacity: 0.6, marginBottom: '10px' }} />
                  <p>Arquivo de vídeo local não encontrado no caminho original.<br /><small>{vod.localVideoPath || 'Sem arquivo vinculado'}</small></p>
                </div>
              )}
            </div>
            <div className="review-video-controls">
              <span><Clock size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Clique em qualquer evento de abate para sincronizar a reprodução instantaneamente.</span>
              <span style={{ fontFamily: 'monospace' }}>{vod.localVideoPath ? vod.localVideoPath.split(/[\/\\]/).pop() : ''}</span>
            </div>
          </div>

          <div className="review-timeline-section">
            <div className="review-tabs">
              <button className={`review-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')}>
                <Target size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Timeline de Abates ({displayedKills.length})
              </button>
              <button className={`review-tab-btn ${activeTab === 'scoreboard' ? 'active' : ''}`} onClick={() => setActiveTab('scoreboard')}>
                <BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Placar do Treino ({Object.keys(playersStats).length} jogadores)
              </button>
            </div>

            {activeTab === 'timeline' ? (
              <>
                <div className="rounds-chip-grid">
                  <button
                    className={`round-chip ${selectedRound === 0 ? 'selected' : ''}`}
                    onClick={() => setSelectedRound(0)}
                  >
                    Todos ({rounds.length} rounds)
                  </button>
                  {rounds.map((r) => (
                    <button
                      key={r.round_number}
                      className={`round-chip ${r.winner === 'friendly' ? 'won' : 'lost'} ${selectedRound === r.round_number ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedRound(r.round_number);
                        if (r.start_time) seekTo(parseTimeToSeconds(r.start_time));
                      }}
                    >
                      R{r.round_number} ({r.score_after || (r.winner === 'friendly' ? 'V' : 'D')})
                    </button>
                  ))}
                </div>

                <div className="review-events-list">
                  {displayedKills.length === 0 ? (
                    <div style={{ color: '#778', textAlign: 'center', padding: '30px' }}>
                      Nenhum abate registrado para este filtro.
                    </div>
                  ) : (
                    displayedKills.map((k, i) => (
                      <div
                        key={i}
                        className="review-event-card"
                        onClick={() => seekTo(k.timestamp_sec ?? parseTimeToSeconds(k.time))}
                        title="Clique para ir para este segundo no vídeo"
                      >
                        <div className="review-event-left">
                          <span className="review-time-badge">{k.time}</span>
                          <div className="kill-player-unit">
                            <span className={`badge-team-${k.killer_team}`}>{k.killer}</span>
                            {k.killer_agent && <span className="agent-tag">{k.killer_agent}</span>}
                          </div>
                          <span style={{ color: '#556' }}>➔</span>
                          <div className="kill-player-unit">
                            <span className={`badge-team-${k.victim_team}`}>{k.victim}</span>
                            {k.victim_agent && <span className="agent-tag">{k.victim_agent}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {k.headshot && (
                            <span className="kill-tag-hs" title="Eliminação por Tiro na Cabeça">
                              <Crosshair size={10} /> HS
                            </span>
                          )}
                          {k.first_kill && (
                            <span className="kill-tag-fk" title="Primeiro Abate da Rodada">
                              <Zap size={10} /> 1st Kill
                            </span>
                          )}
                          <Play size={13} style={{ color: '#65aaff', opacity: 0.8 }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="review-scoreboard-table">
                  <thead>
                    <tr>
                      <th>JOGADOR</th>
                      <th>AGENTE</th>
                      <th>TIME</th>
                      <th>ABATES</th>
                      <th>MORTES</th>
                      <th>K/D</th>
                      <th>HS %</th>
                      <th>1st KILL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(playersStats).length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: '#778' }}>Estatísticas individuais não disponíveis.</td></tr>
                    ) : (
                      Object.entries(playersStats)
                        .sort((a, b) => b[1].kills - a[1].kills)
                        .map(([name, s]) => (
                          <tr key={name}>
                            <td><strong>{name}</strong></td>
                            <td><span className="agent-tag">{s.agent || '—'}</span></td>
                            <td className={`badge-team-${s.team}`}>{s.team === 'friendly' ? 'Aliado' : 'Inimigo'}</td>
                            <td style={{ color: '#54d6a2', fontWeight: 600 }}>{s.kills}</td>
                            <td style={{ color: '#ff6c83' }}>{s.deaths}</td>
                            <td><strong>{s.kd_ratio}x</strong></td>
                            <td>
                              <span className="kill-tag-hs">{s.headshot_rate}%</span>
                            </td>
                            <td>{s.first_kills}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;




