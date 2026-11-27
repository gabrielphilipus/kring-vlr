import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from './components/common/EmptyState.jsx';
import { Field } from './components/common/Field.jsx';
import { LightboxModal } from './components/common/LightboxModal.jsx';
import { MetricCard } from './components/common/MetricCard.jsx';
import { Modal } from './components/common/Modal.jsx';
import { ResultBadge } from './components/common/ResultBadge.jsx';
import { InteractiveVodReviewModal } from './components/vod/InteractiveVodReviewModal.jsx';
import { useAppData } from './hooks/useAppData.js';
import { CatalogManager } from './pages/Catalog/CatalogManager.jsx';
import { StatsPage } from './pages/Stats/StatsPage.jsx';
import { TrainingPage } from './pages/Training/TrainingPage.jsx';
import { VetoSimulator } from './pages/Veto/VetoSimulator.jsx';
import { copyToClipboard } from './utils/clipboard.js';
import { compressImage } from './utils/image.js';
import { formatDate, percent, today } from './utils/formatters.js';
import {
  cleanNick,
  normalizeUrl,
  stripUtf8Bom,
  uid,
  uniqueSorted,
} from './utils/string.js';
import { toNonNegativeNumberOrNull } from './utils/numbers.js';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Crosshair,
  ExternalLink,
  FileVideo2,
  Filter,
  FolderOpen,
  Map as MapIcon,
  Maximize2,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Swords,
  Target,
  Trash2,
  Trophy,
  Upload,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react';

import {
  AGENT_ROLES,
  MATCH_TYPES,
  RESULTS,
  ROUND_RESULTS,
  SIDES,
} from './constants/game.js';
import { NAV_ITEMS } from './constants/navigation.js';
import { TACTIC_CATEGORIES } from './constants/tactics.js';
import { TRAINING_CATEGORIES } from './constants/training.js';
import {
  calcStats,
  getBestMap,
  groupStats,
  normalizeSide,
} from './domain/stats.js';
import { formatDiscordReport } from './domain/discord.js';
import {
  addManualKill,
  applyKillCorrection,
  createMatchExportPayload,
  validateAndParseMatchJson,
  createMatchImportRecord,
  getMatchExportFilename,
  normalizeMatchType,
  removeKillEvent,
} from './domain/matches.js';

function App() {
  const [toast, setToast] = useState('');
  const { data, setData, ready, dataLoadError, startFromScratch } = useAppData({
    onToast: setToast,
  });
  const [view, setView] = useState('dashboard');
  const [modal, setModal] = useState(null);
  const [clearVodsModal, setClearVodsModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [formDirty, setFormDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    map: 'Todos',
    agent: 'Todos',
    result: 'Todos',
    matchType: 'Todos',
  });
  const [imageBusy, setImageBusy] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem('kring-theme') || 'dark'
  );
  const [updateInfo, setUpdateInfo] = useState(null);
  const [appVersion, setAppVersion] = useState(
    typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : 'v1.2.1'
  );
  const imageInputRef = useRef(null);

  useEffect(() => {
    if (window.kringAPI?.getAppVersion) {
      window.kringAPI.getAppVersion().then((ver) => {
        if (ver) setAppVersion(`v${ver}`);
      });
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kring-theme', theme);
  }, [theme]);

  const [appSettings, setAppSettings] = useState({
    allyRosterEnabled: false,
    defaultAllyRoster: [],
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (window.kringAPI?.loadSettings) {
          const res = await window.kringAPI.loadSettings();
          if (active && res) setAppSettings(res);
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (window.kringAPI?.onUpdaterStatus) {
      const unsub = window.kringAPI.onUpdaterStatus((statusData) => {
        if (statusData?.status === 'not-available') {
          setToast(statusData.message || 'Você já está na versão mais recente.');
        } else {
          setUpdateInfo(statusData);
        }
      });
      return unsub;
    }
  }, []);

  const handleManualCheckUpdates = async () => {
    if (!window.kringAPI?.checkForUpdates) {
      setToast('Verificação indisponível no navegador web.');
      return;
    }
    setToast('Buscando atualizações no GitHub...');
    try {
      const res = await window.kringAPI.checkForUpdates();
      if (!res?.ok) {
        let msg =
          res?.error || res?.message || 'Nenhuma atualização encontrada.';
        if (msg.includes('latest.yml') || msg.includes('404')) {
          msg =
            'Uma nova versão está sendo gerada no GitHub no momento. Aguarde cerca de 1 a 2 minutos e tente novamente.';
        }
        setToast(msg);
      } else if (res.updateAvailable === false) {
        setToast(
          `Você já está utilizando a versão mais recente (${appVersion}).`
        );
      }
    } catch {
      setToast('Erro ao consultar atualizações.');
    }
  };
  const vodFileInputRef = useRef(null);
  const importInputRef = useRef(null);
  const matchFileInputRef = useRef(null);

  const handleStartFromScratch = () => {
    const confirmed = window.confirm(
      'Tem certeza de que deseja começar do zero?\n\n' +
        'Seu arquivo danificado permanecerá preservado com segurança na pasta do aplicativo, ' +
        'mas uma nova base limpa será criada e o salvamento automático será reativado.'
    );
    if (!confirmed) return;

    startFromScratch();
    setToast(
      'Nova base iniciada com sucesso. Arquivo anterior preservado na pasta de dados.'
    );
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const overall = useMemo(() => calcStats(data.vods), [data.vods]);
  const mapsStats = useMemo(
    () => groupStats(data.vods, (v) => v.map),
    [data.vods]
  );
  const activeMaps = useMemo(
    () =>
      data.maps
        .filter((item) => item.competitiveActive)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.maps]
  );
  const activeAgents = useMemo(
    () =>
      data.agents
        .filter((item) => item.active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.agents]
  );
  const tacticsMaps = useMemo(
    () =>
      uniqueSorted([
        ...data.maps.map((item) => item.name),
        ...data.tactics.map((item) => item.map),
      ]),
    [data.maps, data.tactics]
  );
  const lineupsMaps = useMemo(
    () =>
      uniqueSorted([
        ...data.maps.map((item) => item.name),
        ...data.lineups.map((item) => item.map),
      ]),
    [data.maps, data.lineups]
  );
  const gameplanMaps = useMemo(
    () =>
      uniqueSorted([
        ...data.maps.map((item) => item.name),
        ...data.gameplans.map((item) => item.map),
      ]),
    [data.maps, data.gameplans]
  );
  const pageTitle =
    NAV_ITEMS.find((item) => item.id === view)?.label || 'Visão geral';

  const openCreate = (kind, map = '') => {
    setEditingId(null);
    setFormDirty(false);
    setDetectedRoster(null);
    setManualNickMode(false);
    setForm(
      kind === 'vod'
        ? {
            title: '',
            playerName: '',
            link: '',
            map: '',
            mapId: '',
            agent: '',
            agentId: '',
            kills: '',
            deaths: '',
            assists: '',
            result: 'Vitória',
            matchType: '',
            opponent: '',
            startingSide: '',
            reviewNotes: [],
            date: today(),
            notes: '',
            gamePlan: '',
            gameplanId: '',
            roundsWon: '',
            roundsLost: '',
            roundResults: { Ataque: {}, Defesa: {} },
            useAllyRoster: appSettings?.allyRosterEnabled ?? false,
            allyRosterList:
              appSettings?.defaultAllyRoster?.length === 5
                ? [...appSettings.defaultAllyRoster]
                : ['', '', '', '', ''],
            saveAsDefaultRoster: false,
          }
        : kind === 'lineup'
          ? {
              title: '',
              map,
              mapId: data.maps.find((item) => item.name === map)?.id || '',
              agent: '',
              agentId: '',
              ability: '',
              side: 'Ataque',
              instructions: '',
              link: '',
              imageData: '',
            }
          : kind === 'tactic'
            ? {
                title: '',
                map,
                category: 'Default',
                side: 'Ataque',
                description: '',
                imageData: '',
                link: '',
              }
            : kind === 'gameplan'
              ? {
                  name: '',
                  map,
                  mapId: data.maps.find((item) => item.name === map)?.id || '',
                  side: 'Ambos',
                  agentIds: [],
                  agentsText: '',
                  description: '',
                }
              : kind === 'catalogAgent'
                ? { name: '', role: AGENT_ROLES[0], iconUrl: '', active: true }
                : kind === 'catalogMap'
                  ? { name: '', previewUrl: '', competitiveActive: true }
                  : {
                      title: '',
                      week: today().slice(0, 10),
                      category: 'Mecânica',
                      minutes: '',
                      notes: '',
                      done: false,
                    }
    );
    setModal(kind);
  };

  const openEdit = (kind, entry) => {
    setEditingId(entry.id);
    setFormDirty(false);
    setDetectedRoster(null);
    setManualNickMode(false);
    setForm({
      ...entry,
      agentIds:
        entry.agentIds ||
        (entry.agents || [])
          .map((name) => data.agents.find((agent) => agent.name === name)?.id)
          .filter(Boolean),
      agentsText: Array.isArray(entry.agents) ? entry.agents.join(', ') : '',
      kills: entry.kills == null ? '' : String(entry.kills),
      deaths: entry.deaths == null ? '' : String(entry.deaths),
      assists: entry.assists == null ? '' : String(entry.assists),
      roundsWon: entry.roundsWon == null ? '' : String(entry.roundsWon),
      roundsLost: entry.roundsLost == null ? '' : String(entry.roundsLost),
    });
    setModal(kind);
  };

  const closeModal = () => {
    setModal(null);
    setEditingId(null);
    setFormDirty(false);
    setImageBusy(false);
    setDetectedRoster(null);
    setManualNickMode(false);
  };

  const requestCloseModal = () => {
    if (
      formDirty &&
      !window.confirm('Você tem alterações não salvas. Deseja fechar e descartar?')
    ) {
      return;
    }
    closeModal();
  };

  const updateForm = (key, value) => {
    setFormDirty(true);
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const [reviewVod, setReviewVod] = useState(null);
  const [detectingRoster, setDetectingRoster] = useState(false);
  const [detectedRoster, setDetectedRoster] = useState(null);
  const [manualNickMode, setManualNickMode] = useState(false);
  const [scrimProgress, setScrimProgress] = useState({
    busy: false,
    percent: 0,
    message: '',
    score: '0-0',
    round: 1,
    liveKills: [],
  });

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
    const unsubError = window.kringAPI.onVodError
      ? window.kringAPI.onVodError((errMsg) => {
          setToast(errMsg);
          setScrimProgress((prev) => ({
            ...prev,
            busy: false,
            message: errMsg,
          }));
        })
      : null;
    return () => {
      if (unsubProgress) unsubProgress();
      if (unsubKill) unsubKill();
      if (unsubError) unsubError();
    };
  }, []);

  const pickVideoFile = async () => {
    if (window.kringAPI?.selectVideoFile) {
      const selected = await window.kringAPI.selectVideoFile();
      if (selected) {
        const fileName = selected.split(/[/\\]/).pop();
        setDetectedRoster(null);
        setManualNickMode(false);
        setForm((prev) => ({
          ...prev,
          localVideoPath: selected,
          localVideoName: fileName,
          title: prev.title || fileName.replace(/\.[^/.]+$/, ''),
        }));
      }
    } else {
      vodFileInputRef.current?.click();
    }
  };

  const detectRosterFromVideo = async () => {
    const videoPath = form.localVideoPath;
    if (!videoPath) {
      setToast('Escolha um arquivo de vídeo primeiro.');
      return;
    }
    if (!window.kringAPI?.detectRoster) {
      setToast('Detecção de jogadores não disponível neste ambiente.');
      return;
    }
    setDetectingRoster(true);
    try {
      const rosterOpts = {};
      if (form.useAllyRoster && Array.isArray(form.allyRosterList)) {
        const cleaned = form.allyRosterList
          .map((s) => (s || '').trim())
          .filter(Boolean);
        if (cleaned.length === 5) {
          rosterOpts.allyRoster = cleaned;
        }
      }
      const res = await window.kringAPI.detectRoster(videoPath, rosterOpts);
      if (res?.ok && res.data) {
        const rosterData = res.data;
        setDetectedRoster(rosterData);
        const friendly = rosterData.friendly || [];
        const detectedMap = rosterData.map;
        const matchScore = rosterData.match_score;

        let matched = null;
        if (friendly.length > 0) {
          if (form.playerName) {
            const cleanInput = cleanNick(form.playerName);
            matched = friendly.find((p) => {
              const cn = cleanNick(p.nick);
              return (
                cn === cleanInput ||
                cn.includes(cleanInput) ||
                cleanInput.includes(cn)
              );
            });
          }
          if (!matched) {
            matched = friendly[0];
          }
        }

        setForm((prev) => {
          const updated = { ...prev };
          if (detectedMap) {
            updated.map = detectedMap;
            const foundMap = data.maps?.find(
              (m) => m.name.toLowerCase() === detectedMap.toLowerCase()
            );
            if (foundMap) updated.mapId = foundMap.id;
          }
          if (matchScore) {
            if (matchScore.friendly !== undefined && matchScore.friendly !== null) {
              updated.roundsWon = matchScore.friendly;
            }
            if (matchScore.enemy !== undefined && matchScore.enemy !== null) {
              updated.roundsLost = matchScore.enemy;
            }
            if (matchScore.result) {
              updated.result = matchScore.result;
            }
          }
          if (matched) {
            updated.playerName = matched.nick;
            if (matched.agent) updated.agent = matched.agent;
            if (matched.kills !== undefined && matched.kills !== null) {
              updated.kills = matched.kills;
            }
            if (matched.deaths !== undefined && matched.deaths !== null) {
              updated.deaths = matched.deaths;
            }
            if (matched.assists !== undefined && matched.assists !== null) {
              updated.assists = matched.assists;
            }
          }
          return updated;
        });

        if (friendly.length > 0) {
          const extraParts = [];
          if (detectedMap) extraParts.push(`Mapa: ${detectedMap}`);
          if (matchScore) extraParts.push(`Placar: ${matchScore.friendly}-${matchScore.enemy} (${matchScore.result})`);
          const extraInfo = extraParts.length ? ` · ${extraParts.join(' · ')}` : '';
          setToast(`${friendly.length} jogadores detectados com sucesso!${extraInfo}`);
        } else {
          setToast('Nenhum jogador detectado no pré-jogo.');
        }
      } else {
        setToast(res?.error || 'Não foi possível detectar os jogadores.');
      }
    } catch (err) {
      setToast(err.message || 'Erro ao detectar jogadores da partida.');
    } finally {
      setDetectingRoster(false);
    }
  };

  const updateDetectedPlayer = (team, idx, field, value) => {
    setDetectedRoster((prev) => {
      if (!prev) return prev;
      const list = [...(prev[team] || [])];
      if (list[idx]) {
        list[idx] = { ...list[idx], [field]: value };
      }
      return { ...prev, [team]: list };
    });
  };

  const startNativeAnalysis = async () => {
    const videoPath = form.localVideoPath;
    if (!videoPath) {
      setToast('Escolha um arquivo de vídeo da partida.');
      return;
    }
    setScrimProgress({
      busy: true,
      percent: 0,
      message: 'Identificando jogadores e agentes da partida…',
      score: '0-0',
      round: 1,
      liveKills: [],
    });
    try {
      const analysisOpts = {
        userNick: form.playerName || '',
        userAgent: form.agent || '',
      };
      if (detectedRoster && (detectedRoster.friendly?.length || detectedRoster.enemy?.length)) {
        analysisOpts.customRoster = {
          friendly: (detectedRoster.friendly || []).map((p) => ({ nick: p.nick, agent: p.agent })),
          enemy: (detectedRoster.enemy || []).map((p) => ({ nick: p.nick, agent: p.agent })),
        };
      }
      if (form.useAllyRoster && Array.isArray(form.allyRosterList)) {
        const cleaned = form.allyRosterList
          .map((s) => (s || '').trim())
          .filter(Boolean);
        if (cleaned.length === 5) {
          analysisOpts.allyRoster = cleaned;
          if (form.saveAsDefaultRoster && window.kringAPI?.saveSettings) {
            window.kringAPI.saveSettings({
              allyRosterEnabled: true,
              defaultAllyRoster: cleaned,
            });
            setAppSettings({
              allyRosterEnabled: true,
              defaultAllyRoster: cleaned,
            });
          }
        }
      } else if (!form.useAllyRoster) {
        analysisOpts.allyRoster = null;
      }
      const res = await window.kringAPI.startVodAnalysis(videoPath, analysisOpts);
      if (res?.ok && res.data) {
        const match = res.data;
        const friendlyScore = match.final_score?.friendly ?? 0;
        const enemyScore = match.final_score?.enemy ?? 0;
        const resultLabel =
          friendlyScore > enemyScore
            ? 'Vitória'
            : friendlyScore < enemyScore
              ? 'Derrota'
              : 'Empate';

        const openingDuels = [];
        (match.rounds || []).forEach((r) => {
          const firstK = (r.kills || []).find((k) => k.first_kill);
          if (firstK) {
            openingDuels.push({
              round: String(r.round_number),
              time: firstK.time,
              event: firstK.event_label,
              player:
                firstK.killer_team === 'friendly'
                  ? firstK.killer
                  : firstK.victim,
            });
          }
        });

        let playerKills = form.kills;
        let playerDeaths = form.deaths;
        let playerAssists = form.assists;
        let playerAgent = form.agent;
        if (form.playerName) {
          const cleanInput = cleanNick(form.playerName);
          const pKey = Object.keys(match.players_stats || {}).find((name) => {
            const cleanName = cleanNick(name);
            return (
              cleanName === cleanInput ||
              cleanName.includes(cleanInput) ||
              cleanInput.includes(cleanName)
            );
          });
          if (pKey && match.players_stats[pKey]) {
            const stats = match.players_stats[pKey];
            playerKills = stats.kills;
            playerDeaths = stats.deaths;
            if (stats.assists !== undefined) playerAssists = stats.assists;
            if (stats.agent) playerAgent = stats.agent;
          }
        }

        setFormDirty(true);
        setForm((prev) => ({
          ...prev,
          map: match.map || prev.map,
          mapId: data.maps?.find((m) => m.name.toLowerCase() === (match.map || prev.map || '').toLowerCase())?.id || prev.mapId,
          roundsWon: friendlyScore,
          roundsLost: enemyScore,
          result: resultLabel,
          openingDuels: openingDuels.length ? openingDuels : prev.openingDuels,
          kills: playerKills !== undefined ? playerKills : prev.kills,
          deaths: playerDeaths !== undefined ? playerDeaths : prev.deaths,
          assists: playerAssists !== undefined ? playerAssists : prev.assists,
          agent: playerAgent || prev.agent,
          analysisData: match,
          localVideoPath: videoPath,
        }));

        setToast(
          `Análise concluída com sucesso! ${match.all_kills?.length || 0} abates e ${match.rounds?.length || 0} rounds identificados.`
        );
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
      setScrimProgress((prev) => ({
        ...prev,
        busy: false,
        message: 'Análise cancelada.',
      }));
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
        title: form.title.trim(),
        map: form.map.trim(),
        agent: form.agent.trim(),
        mapId:
          data.maps.find((item) => item.name === form.map)?.id ||
          form.mapId ||
          null,
        agentId:
          data.agents.find((item) => item.name === form.agent)?.id ||
          form.agentId ||
          null,
        link: normalizeUrl(form.link),
        kills: Math.max(0, Number(form.kills) || 0),
        deaths: Math.max(0, Number(form.deaths) || 0),
        assists: Math.max(0, Number(form.assists) || 0),
        gameplanId: data.gameplans.some((plan) => plan.id === form.gameplanId)
          ? form.gameplanId
          : null,
        roundsWon: toNonNegativeNumberOrNull(form.roundsWon),
        roundsLost: toNonNegativeNumberOrNull(form.roundsLost),
        result: RESULTS.includes(form.result) ? form.result : 'Vitória',
        matchType: normalizeMatchType(form.matchType),
        opponent: (form.opponent || '').trim(),
        startingSide: normalizeSide(form.startingSide) || '',
        reviewNotes: Array.isArray(form.reviewNotes) ? form.reviewNotes : [],
        date: form.date || today(),
        roundResults: {
          Ataque: { ...(form.roundResults?.Ataque || {}) },
          Defesa: { ...(form.roundResults?.Defesa || {}) },
        },
        openingDuels: Array.isArray(form.openingDuels)
          ? form.openingDuels
              .filter(
                (item) => item && (item.round || item.time || item.player)
              )
              .map((item) => ({
                round: String(item.round || '').trim(),
                time: String(item.time || '').trim(),
                event:
                  item.event === 'First Death' ? 'First Death' : 'First Kill',
                player: String(item.player || '').trim(),
              }))
          : [],
        notes: (form.notes || '').trim(),
      };
      setData((previous) => ({
        ...previous,
        vods: editingId
          ? previous.vods.map((v) => (v.id === editingId ? record : v))
          : [record, ...previous.vods],
      }));
      setToast(editingId ? 'VOD atualizado.' : 'VOD adicionado à biblioteca.');
    } else {
      if (modal === 'catalogAgent' || modal === 'catalogMap') {
        const isAgent = modal === 'catalogAgent';
        const collection = isAgent ? 'agents' : 'maps';
        const oldEntry = editingId
          ? data[collection].find((item) => item.id === editingId)
          : null;
        if (!form.name?.trim()) {
          setToast('Informe o nome.');
          return;
        }
        const duplicate = data[collection].some(
          (item) =>
            item.id !== editingId &&
            item.name.toLowerCase() === form.name.trim().toLowerCase()
        );
        if (duplicate) {
          setToast('Já existe um cadastro com esse nome.');
          return;
        }
        const mediaField = isAgent ? 'iconUrl' : 'previewUrl';
        const mediaUrl = (form[mediaField] || '').trim();
        if (mediaUrl && !/^(https:\/\/|data:image\/)/i.test(mediaUrl)) {
          setToast(
            'Use um endereço de imagem que comece com https:// ou anexe uma imagem.'
          );
          return;
        }
        const record = {
          ...form,
          id: editingId || uid(),
          name: form.name.trim(),
          [mediaField]: mediaUrl,
        };
        setData((previous) => {
          const next = {
            ...previous,
            [collection]: editingId
              ? previous[collection].map((item) =>
                  item.id === editingId ? record : item
                )
              : [record, ...previous[collection]],
          };
          if (oldEntry && oldEntry.name !== record.name) {
            const field = isAgent ? 'agent' : 'map';
            const idField = isAgent ? 'agentId' : 'mapId';
            for (const key of ['vods', 'lineups', 'tactics', 'gameplans'])
              next[key] = previous[key].map((item) => ({
                ...item,
                ...(item[idField] === editingId ||
                (!item[idField] && item[field] === oldEntry.name)
                  ? { [field]: record.name, [idField]: editingId }
                  : {}),
                ...(isAgent && Array.isArray(item.agents)
                  ? {
                      agents: item.agents.map((name) =>
                        name === oldEntry.name ? record.name : name
                      ),
                    }
                  : {}),
              }));
          }
          return next;
        });
        setToast(
          editingId
            ? `${isAgent ? 'Agente' : 'Mapa'} atualizado.`
            : `${isAgent ? 'Agente' : 'Mapa'} cadastrado.`
        );
        closeModal();
        return;
      }
      if (modal === 'gameplan') {
        if (!form.name?.trim() || !form.map?.trim()) {
          setToast('Preencha o nome e o mapa do Gameplan.');
          return;
        }
        const record = {
          id: editingId || uid(),
          name: form.name.trim(),
          map: form.map.trim(),
          mapId:
            data.maps.find((item) => item.name === form.map)?.id ||
            form.mapId ||
            null,
          side: ['Ataque', 'Defesa', 'Ambos'].includes(form.side)
            ? form.side
            : 'Ambos',
          agentIds: form.agentIds || [],
          agents: (form.agentIds || [])
            .map((id) => data.agents.find((agent) => agent.id === id)?.name)
            .filter(Boolean)
            .concat(
              (form.agentsText || '')
                .split(',')
                .map((agent) => agent.trim())
                .filter(
                  (name) =>
                    !data.agents.some(
                      (catalogAgent) =>
                        catalogAgent.name.toLowerCase() === name.toLowerCase()
                    )
                )
            ),
          description: (form.description || '').trim(),
          createdAt: editingId
            ? data.gameplans.find((plan) => plan.id === editingId)?.createdAt ||
              new Date().toISOString()
            : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setData((previous) => ({
          ...previous,
          gameplans: editingId
            ? previous.gameplans.map((plan) =>
                plan.id === editingId ? record : plan
              )
            : [record, ...previous.gameplans],
        }));
        setToast(editingId ? 'Gameplan atualizado.' : 'Gameplan criado.');
        closeModal();
        return;
      }
      if (modal === 'tactic' || modal === 'training') {
        if (!form.title?.trim()) {
          setToast('Preencha o nome.');
          return;
        }
        if (modal === 'tactic' && !form.map?.trim()) {
          setToast('Escolha o mapa do tático.');
          return;
        }
        const kindKey = modal === 'tactic' ? 'tactics' : 'training';
        const record = {
          ...form,
          id: editingId || uid(),
          title: form.title.trim(),
          ...(modal === 'tactic'
            ? {
                map: form.map.trim(),
                mapId:
                  data.maps.find((item) => item.name === form.map)?.id || null,
                link: normalizeUrl(form.link),
                description: (form.description || '').trim(),
              }
            : {
                minutes: toNonNegativeNumberOrNull(form.minutes),
              }),
        };
        setData((previous) => ({
          ...previous,
          [kindKey]: editingId
            ? previous[kindKey].map((item) =>
                item.id === editingId ? record : item
              )
            : [record, ...previous[kindKey]],
        }));
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
        id: editingId || uid(),
        title: form.title.trim(),
        map: form.map.trim(),
        agent: form.agent.trim(),
        mapId: data.maps.find((item) => item.name === form.map)?.id || null,
        agentId:
          data.agents.find((item) => item.name === form.agent)?.id || null,
        ability: (form.ability || '').trim(),
        side: form.side || 'Ataque',
        instructions: (form.instructions || '').trim(),
        link: normalizeUrl(form.link),
      };
      setData((previous) => ({
        ...previous,
        lineups: editingId
          ? previous.lineups.map((l) => (l.id === editingId ? record : l))
          : [record, ...previous.lineups],
      }));
      setToast(
        editingId ? 'Lineup atualizada.' : 'Lineup adicionada à biblioteca.'
      );
    }
    closeModal();
  };

  const removeEntry = (kind, id) => {
    if (kind === 'catalogMap' || kind === 'catalogAgent') {
      const isMap = kind === 'catalogMap';
      const entry = data[isMap ? 'maps' : 'agents'].find(
        (item) => item.id === id
      );
      if (!entry) return;
      const referenced = isMap
        ? ['vods', 'lineups', 'tactics', 'gameplans'].some((key) =>
            data[key].some(
              (item) =>
                item.mapId === id || (!item.mapId && item.map === entry.name)
            )
          )
        : ['vods', 'lineups', 'gameplans'].some((key) =>
            data[key].some(
              (item) =>
                item.agentId === id ||
                (!item.agentId && item.agent === entry.name) ||
                item.agentIds?.includes(id) ||
                item.agents?.includes(entry.name)
            )
          );
      if (referenced) {
        setToast(
          'Este cadastro já está em uso. Desative-o para removê-lo dos novos seletores.'
        );
        return;
      }
      if (
        !window.confirm(
          `Excluir ${isMap ? 'o mapa' : 'o agente'} ${entry.name}?`
        )
      )
        return;
      setData((previous) => ({
        ...previous,
        [isMap ? 'maps' : 'agents']: previous[isMap ? 'maps' : 'agents'].filter(
          (item) => item.id !== id
        ),
      }));
      setToast(`${isMap ? 'Mapa' : 'Agente'} excluído.`);
      return;
    }
    const label =
      kind === 'vod'
        ? 'este VOD'
        : kind === 'lineup'
          ? 'esta lineup'
          : 'este registro';
    if (!window.confirm(`Tem certeza de que deseja excluir ${label}?`)) return;
    if (kind === 'gameplan') {
      setData((previous) => ({
        ...previous,
        gameplans: previous.gameplans.filter((plan) => plan.id !== id),
        vods: previous.vods.map((vod) =>
          vod.gameplanId === id ? { ...vod, gameplanId: null } : vod
        ),
      }));
      setToast('Gameplan removido; as partidas foram mantidas.');
      return;
    }
    const key = {
      vod: 'vods',
      lineup: 'lineups',
      tactic: 'tactics',
      training: 'training',
    }[kind];
    setData((previous) => ({
      ...previous,
      [key]: previous[key].filter((entry) => entry.id !== id),
    }));
    setToast(
      {
        vod: 'VOD removido.',
        lineup: 'Lineup removida.',
        tactic: 'Tático removido.',
        training: 'Treino removido.',
      }[kind]
    );
  };

  const openExternal = async (url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl || !/^https:\/\//i.test(safeUrl)) {
      setToast('Adicione um link válido começando com https://.');
      return;
    }
    if (window.kringAPI?.openExternal)
      await window.kringAPI.openExternal(safeUrl);
    else window.open(safeUrl, '_blank', 'noopener,noreferrer');
  };

  const exportBackup = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { ...data, backupCreatedAt: new Date().toISOString() },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kring-vlr-backup-${today()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast('Cópia de segurança exportada.');
  };

  const exportDefaults = () => {
    const defaults = data.tactics
      .filter((item) => item.category === 'Default')
      .map(({ id, title, map, mapId, side, description, link, imageData }) => ({
        id,
        title,
        map,
        mapId,
        category: 'Default',
        side,
        description,
        link,
        imageData,
      }));
    if (!defaults.length) {
      setToast('Não há táticos Default para exportar.');
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            type: 'kring-vlr-defaults',
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            tactics: defaults,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
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
      if (
        parsed.type !== 'kring-vlr-defaults' ||
        parsed.formatVersion !== 1 ||
        !Array.isArray(parsed.tactics) ||
        !parsed.tactics.length ||
        parsed.tactics.some(
          (item) =>
            item.category !== 'Default' ||
            !item.title?.trim() ||
            !item.map?.trim()
        )
      )
        throw new Error('Formato inválido');
      if (
        !window.confirm(
          `Importar ${parsed.tactics.length} Default(s) vai substituir somente os táticos da categoria Default atuais. Todas as outras categorias e dados permanecerão intactos. Deseja continuar?`
        )
      )
        return;
      const imported = parsed.tactics.map((item) => ({
        id: uid(),
        title: item.title.trim(),
        map: item.map.trim(),
        mapId: data.maps.find((map) => map.name === item.map)?.id || null,
        category: 'Default',
        side: ['Ataque', 'Defesa', 'Ambos'].includes(item.side)
          ? item.side
          : 'Ataque',
        description: String(item.description || ''),
        link: /^https:\/\//i.test(item.link || '') ? item.link : '',
        imageData:
          typeof item.imageData === 'string' &&
          /^(data:image\/|https:\/\/)/i.test(item.imageData)
            ? item.imageData
            : '',
      }));
      setData((previous) => ({
        ...previous,
        tactics: [
          ...previous.tactics.filter((item) => item.category !== 'Default'),
          ...imported,
        ],
      }));
      setToast(
        `${imported.length} Default(s) importado(s). As outras categorias foram preservadas.`
      );
    } catch {
      setToast(
        'Arquivo inválido. Selecione uma exportação de Defaults do Kring VLR.'
      );
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const fileText = await file.text();
      const parsed = JSON.parse(stripUtf8Bom(fileText));
      if (!Array.isArray(parsed.vods) || !Array.isArray(parsed.lineups))
        throw new Error('Formato inesperado');
      if (
        !window.confirm(
          'Importar esta cópia vai substituir os VODs e lineups atuais. Deseja continuar?'
        )
      )
        return;

      let normalized = parsed;
      if (window.kringAPI?.importBackupData) {
        const result = await window.kringAPI.importBackupData(parsed);
        if (!result?.ok) {
          if (result?.reason === 'unsupported-version') {
            setToast(
              `Não foi possível importar: versão ${result.currentVersion} incompatível com esta versão do aplicativo.`
            );
            return;
          }
          throw new Error(result?.error || 'Erro ao importar backup');
        }
        normalized = result.data;
      }

      setData((previous) => ({
        ...previous,
        vods: normalized.vods,
        lineups: normalized.lineups,
        tactics: Array.isArray(normalized.tactics)
          ? normalized.tactics.map((item) => ({
              ...item,
              category:
                item.category === 'Roubo de ultimate'
                  ? 'Rounds de ultimate'
                  : item.category,
            }))
          : [],
        training: Array.isArray(normalized.training) ? normalized.training : [],
        gameplans: Array.isArray(normalized.gameplans)
          ? normalized.gameplans
          : [],
        maps: Array.isArray(normalized.maps) ? normalized.maps : previous.maps,
        agents: Array.isArray(normalized.agents)
          ? normalized.agents
          : previous.agents,
      }));
      setToast('Cópia de segurança importada.');
    } catch {
      setToast('Esse arquivo não parece ser uma cópia válida do Kring VLR.');
    }
  };

  const handleUpdateVodStartingSide = (vodId, side) => {
    const normalized = normalizeSide(side) || '';
    setData((previous) => ({
      ...previous,
      vods: previous.vods.map((v) =>
        v.id === vodId ? { ...v, startingSide: normalized } : v
      ),
    }));
    setReviewVod((prev) =>
      prev && prev.id === vodId ? { ...prev, startingSide: normalized } : prev
    );
    setToast(
      normalized
        ? `Lado inicial definido: ${normalized}.`
        : 'Lado inicial removido.'
    );
  };

  const handleUpdateVodReviewNotes = (vodId, nextNotes) => {
    const safeNotes = Array.isArray(nextNotes) ? nextNotes : [];
    setData((previous) => ({
      ...previous,
      vods: previous.vods.map((v) =>
        v.id === vodId ? { ...v, reviewNotes: safeNotes } : v
      ),
    }));
    setReviewVod((prev) =>
      prev && prev.id === vodId ? { ...prev, reviewNotes: safeNotes } : prev
    );
  };

  const handleUpdateVodKill = (vodId, killRef, updates) => {
    setData((previous) => ({
      ...previous,
      vods: previous.vods.map((v) =>
        v.id === vodId
          ? {
              ...v,
              analysisData: applyKillCorrection(v.analysisData, killRef, updates),
            }
          : v
      ),
    }));
    setReviewVod((prev) =>
      prev && prev.id === vodId
        ? {
            ...prev,
            analysisData: applyKillCorrection(
              prev.analysisData,
              killRef,
              updates
            ),
          }
        : prev
    );
    setToast('Abate corrigido na timeline!');
  };

  const handleAddVodKill = (vodId, killInput) => {
    setData((previous) => ({
      ...previous,
      vods: previous.vods.map((v) =>
        v.id === vodId
          ? {
              ...v,
              analysisData: addManualKill(v.analysisData, killInput),
            }
          : v
      ),
    }));
    setReviewVod((prev) =>
      prev && prev.id === vodId
        ? {
            ...prev,
            analysisData: addManualKill(prev.analysisData, killInput),
          }
        : prev
    );
    setToast('Abate adicionado à timeline!');
  };

  const handleDeleteVodKill = (vodId, killRef) => {
    setData((previous) => ({
      ...previous,
      vods: previous.vods.map((v) =>
        v.id === vodId
          ? {
              ...v,
              analysisData: removeKillEvent(v.analysisData, killRef),
            }
          : v
      ),
    }));
    setReviewVod((prev) =>
      prev && prev.id === vodId
        ? {
            ...prev,
            analysisData: removeKillEvent(prev.analysisData, killRef),
          }
        : prev
    );
    setToast('Abate removido da timeline.');
  };

  const handleExportMatch = (vod) => {
    try {
      const payload = createMatchExportPayload(vod);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = getMatchExportFilename(vod);
      anchor.click();
      URL.revokeObjectURL(url);
      setToast(`Partida "${vod.title || vod.map || 'Valorant'}" exportada com sucesso.`);
    } catch (err) {
      setToast(`Erro ao exportar partida: ${err.message}`);
    }
  };

  const handleImportMatchFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsedMatch = validateAndParseMatchJson(text);
      const record = createMatchImportRecord(parsedMatch);

      setData((previous) => ({
        ...previous,
        vods: [record, ...previous.vods],
      }));

      setToast(
        `Partida "${record.title}" importada com sucesso para a biblioteca!`
      );
    } catch (err) {
      setToast(
        err.message || 'Arquivo inválido. Selecione um JSON de partida do Kring VLR.'
      );
    }
  };

  const restoreCatalogDefaults = async () => {
    if (
      !window.confirm(
        'Restaurar o catálogo padrão vai adicionar quaisquer mapas ou agentes oficiais ausentes da sua lista (itens personalizados serão mantidos). Deseja continuar?'
      )
    )
      return;
    try {
      let seed = { maps: [], agents: [] };
      const response = await fetch('./catalogs.json');
      if (response.ok) seed = await response.json();
      if (!Array.isArray(seed.maps) || !Array.isArray(seed.agents)) {
        setToast('Catálogo padrão indisponível.');
        return;
      }
      setData((previous) => {
        const existingMapIds = new Set(
          previous.maps.map((m) => (m.id || '').toLowerCase())
        );
        const existingMapNames = new Set(
          previous.maps.map((m) => (m.name || '').toLowerCase())
        );
        const newMaps = seed.maps.filter(
          (m) =>
            !existingMapIds.has((m.id || '').toLowerCase()) &&
            !existingMapNames.has((m.name || '').toLowerCase())
        );

        const existingAgentIds = new Set(
          previous.agents.map((a) => (a.id || '').toLowerCase())
        );
        const existingAgentNames = new Set(
          previous.agents.map((a) => (a.name || '').toLowerCase())
        );
        const newAgents = seed.agents.filter(
          (a) =>
            !existingAgentIds.has((a.id || '').toLowerCase()) &&
            !existingAgentNames.has((a.name || '').toLowerCase())
        );

        if (newMaps.length === 0 && newAgents.length === 0) {
          setToast(
            'Todos os mapas e agentes padrão já estão presentes no catálogo.'
          );
          return previous;
        }

        setToast(
          `Catálogo restaurado: +${newMaps.length} mapa(s) e +${newAgents.length} agente(s) adicionados.`
        );
        return {
          ...previous,
          maps: [...previous.maps, ...newMaps],
          agents: [...previous.agents, ...newAgents],
        };
      });
    } catch (err) {
      console.error(err);
      setToast('Não foi possível carregar o catálogo padrão.');
    }
  };

  const attachLineupImage = async (file, successMessage) => {
    if (!file) return;
    setImageBusy(true);
    try {
      const imageData = await compressImage(file);
      if (modal === 'catalogMap') {
        updateForm('previewUrl', imageData);
        setToast('Imagem de preview do mapa anexada.');
      } else if (modal === 'catalogAgent') {
        updateForm('iconUrl', imageData);
        setToast('Ícone do agente anexado.');
      } else {
        updateForm('imageData', imageData);
        setToast(
          successMessage ||
            (modal === 'tactic'
              ? 'Print anexado ao tático.'
              : 'Imagem anexada à lineup.')
        );
      }
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
    const imageItem = Array.from(event.clipboardData?.items || []).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    if (!imageItem) return; // Mantém o comportamento normal ao colar texto nos campos.

    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    if (imageBusy) {
      setToast('Aguarde o processamento da imagem atual.');
      return;
    }
    const msg =
      modal === 'tactic'
        ? 'Screenshot colado no tático.'
        : modal === 'catalogMap'
          ? 'Preview colado no mapa.'
          : modal === 'catalogAgent'
            ? 'Ícone colado no agente.'
            : 'Screenshot colado na lineup.';
    await attachLineupImage(file, msg);
  };

  const filteredVods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.vods.filter((vod) => {
      const matchesSearch =
        !q ||
        [
          vod.title,
          vod.opponent,
          vod.matchType,
          vod.map,
          vod.agent,
          vod.notes,
          vod.result,
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(q)
        );
      return (
        matchesSearch &&
        (filters.map === 'Todos' || vod.map === filters.map) &&
        (filters.agent === 'Todos' || vod.agent === filters.agent) &&
        (filters.result === 'Todos' || vod.result === filters.result) &&
        (filters.matchType === 'Todos' ||
          (vod.matchType || '') === filters.matchType)
      );
    });
  }, [data.vods, search, filters]);

  const filteredLineups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.lineups.filter(
      (lineup) =>
        !q ||
        [
          lineup.title,
          lineup.map,
          lineup.agent,
          lineup.ability,
          lineup.side,
          lineup.instructions,
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(q)
        )
    );
  }, [data.lineups, search]);

  const setFilter = (key, value) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  const clearVods = (onlyFiltered = false) => {
    if (onlyFiltered) {
      const idsToRemove = new Set(filteredVods.map((vod) => vod.id));
      setData((previous) => ({
        ...previous,
        vods: previous.vods.filter((vod) => !idsToRemove.has(vod.id)),
      }));
      if (reviewVod && idsToRemove.has(reviewVod.id)) {
        setReviewVod(null);
      }
      setToast(`${idsToRemove.size} VOD(s) filtrado(s) removido(s).`);
    } else {
      const removedCount = data.vods.length;
      setData((previous) => ({
        ...previous,
        vods: [],
      }));
      setReviewVod(null);
      setSearch('');
      setFilters({
        map: 'Todos',
        agent: 'Todos',
        result: 'Todos',
        matchType: 'Todos',
      });
      setToast(`Todos os ${removedCount} VOD(s) foram removidos da biblioteca.`);
    }
    setClearVodsModal(false);
  };

  const handleCopyDiscordReport = async (vod) => {
    const text = formatDiscordReport(vod);
    const ok = await copyToClipboard(text);
    if (ok) {
      setToast(
        'Relatório copiado para a área de transferência! Cole no Discord.'
      );
    } else {
      setToast('Não foi possível copiar o relatório.');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Crosshair size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">
              KRING <span>VLR</span>
            </div>
            <div className="brand-subtitle">PLAYER WORKSPACE</div>
          </div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? 'active' : ''}`}
                onClick={() => {
                  setView(item.id);
                  setSearch('');
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === 'vods' && data.vods.length > 0 && (
                  <span className="nav-count">{data.vods.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-icon">
              <ShieldCheck size={17} />
            </div>
            <div>
              <strong>Seus dados, no seu PC</strong>
              <span>Salvamento local automático</span>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" />
            <span>Kring VLR</span>
            <span className="version">{appVersion}</span>
            <button
              type="button"
              className="updater-check-btn"
              onClick={handleManualCheckUpdates}
              title="Buscar atualizações no GitHub"
            >
              <RefreshCw size={11} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="button button-quiet button-small theme-toggle-btn"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={
                theme === 'dark'
                  ? 'Mudar para tema claro'
                  : 'Mudar para tema escuro'
              }
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span>{theme === 'dark' ? 'Claro' : 'Escuro'}</span>
            </button>
            <button
              className="button button-quiet button-small"
              onClick={exportBackup}
              title="Exportar uma cópia de segurança"
            >
              <ArrowDownToLine size={15} /> Backup
            </button>
            <button
              className="button button-quiet button-small"
              onClick={() => importInputRef.current?.click()}
              title="Importar uma cópia de segurança"
            >
              <ArrowUpFromLine size={15} /> Importar
            </button>
            {view !== 'veto' && view !== 'stats' && view !== 'tactics' && (
              <button
                className="button button-primary button-small"
                onClick={() =>
                  openCreate(
                    view === 'lineups'
                      ? 'lineup'
                      : view === 'training'
                        ? 'training'
                        : view === 'gameplans'
                          ? 'gameplan'
                          : view === 'catalogs'
                            ? 'catalogMap'
                            : 'vod'
                  )
                }
              >
                <Plus size={16} />{' '}
                {view === 'lineups'
                  ? 'Nova lineup'
                  : view === 'training'
                    ? 'Adicionar treino'
                    : view === 'gameplans'
                      ? 'Novo Gameplan'
                      : view === 'catalogs'
                        ? 'Adicionar mapa'
                        : 'Adicionar VOD'}
              </button>
            )}
          </div>
        </header>

        {dataLoadError && (
          <div
            className="updater-banner error"
            style={{
              background: '#7f1d1d',
              borderColor: '#ef4444',
              color: '#fff',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 10,
              padding: '14px 18px',
            }}
          >
            <div className="updater-content" style={{ width: '100%' }}>
              <span className="updater-msg">
                {dataLoadError.reason === 'unsupported-version' ? (
                  <>
                    <strong>Atenção:</strong> O arquivo de dados foi gerado
                    por uma versão mais recente deste aplicativo (
                    <code>schemaVersion {dataLoadError.currentVersion}</code>
                    ). O salvamento automático foi <strong>
                      bloqueado
                    </strong>{' '}
                    para evitar perda de dados. Atualize o Kring VLR para abrir
                    este arquivo com total compatibilidade.
                  </>
                ) : dataLoadError.reason === 'migration-failed' ? (
                  <>
                    <strong>Atenção:</strong> Ocorreu uma falha ao atualizar
                    seus dados para a versão 4. O salvamento automático foi{' '}
                    <strong>bloqueado</strong> e o arquivo original foi mantido
                    intacto.
                  </>
                ) : (
                  <>
                    <strong>Atenção:</strong> O arquivo de dados local estava
                    ilegível/corrompido. O salvamento automático foi{' '}
                    <strong>bloqueado</strong> para proteger suas informações. O
                    arquivo original corrompido foi preservado como{' '}
                    <code>{dataLoadError.preservedAs}</code> na pasta de dados
                    do sistema.
                  </>
                )}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                marginTop: 2,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => window.kringAPI?.openUserDataFolder?.()}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  borderColor: 'rgba(255,255,255,0.35)',
                  color: '#fff',
                }}
              >
                <FolderOpen size={14} /> Abrir pasta dos dados
              </button>
              {dataLoadError.reason !== 'unsupported-version' && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={handleStartFromScratch}
                  style={{
                    background: '#dc2626',
                    borderColor: '#b91c1c',
                    color: '#fff',
                  }}
                >
                  Começar do zero
                </button>
              )}
            </div>
          </div>
        )}

        {updateInfo &&
          (updateInfo.status === 'downloading' ||
            updateInfo.status === 'downloaded' ||
            updateInfo.status === 'available') && (
            <div className={`updater-banner ${updateInfo.status}`}>
              <div className="updater-content">
                {updateInfo.status === 'downloading' ? (
                  <RefreshCw size={15} className="spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                <span className="updater-msg">{updateInfo.message}</span>
                {updateInfo.status === 'downloading' && (
                  <div className="updater-progress-bar">
                    <div
                      className="updater-progress-fill"
                      style={{ width: `${updateInfo.percent || 0}%` }}
                    />
                  </div>
                )}
              </div>
              {updateInfo.status === 'downloaded' && (
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={() => window.kringAPI?.quitAndInstallUpdate()}
                >
                  Reiniciar e aplicar
                </button>
              )}
              <button
                type="button"
                className="updater-close-btn"
                onClick={() => setUpdateInfo(null)}
                title="Fechar aviso"
              >
                <X size={14} />
              </button>
            </div>
          )}

        <div className="page-content">
          {view === 'dashboard' && (
            <Dashboard
              data={data}
              overall={overall}
              mapsStats={mapsStats}
              onAddVod={() => openCreate('vod')}
              onGo={setView}
              onOpenVOD={openExternal}
              onAddLineup={() => openCreate('lineup')}
              onReview={(vod) => setReviewVod(vod)}
            />
          )}
          {view === 'veto' && (
            <VetoSimulator
              maps={activeMaps}
              mapsStats={mapsStats}
              onToast={setToast}
            />
          )}
          {view === 'vods' && (
            <section>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ANÁLISE DE PARTIDAS</div>
                  <h1>Biblioteca de VODs</h1>
                  <p>
                    Organize suas partidas, registre resultados e encontre
                    padrões de desempenho.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {data.vods.length > 0 && (
                    <button
                      type="button"
                      className="button button-danger-quiet"
                      onClick={() => setClearVodsModal(true)}
                      title="Excluir todos os VODs ou limpar os VODs filtrados"
                    >
                      <Trash2 size={15} /> Excluir todos
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => matchFileInputRef.current?.click()}
                    title="Importar partida ou scrim compartilhada por outro jogador (.json)"
                  >
                    <ArrowDownToLine size={16} /> Importar Partida
                  </button>
                  <button
                    className="button button-primary"
                    onClick={() => openCreate('vod')}
                  >
                    <Plus size={17} /> Adicionar VOD
                  </button>
                </div>
              </div>
              <div className="toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por título, adversário, mapa ou agente..."
                  />
                </div>
                <div className="filter-field">
                  <Filter size={15} />
                  <select
                    value={filters.map}
                    onChange={(e) => setFilter('map', e.target.value)}
                  >
                    <option>Todos</option>
                    {uniqueSorted(data.vods.map((v) => v.map)).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div className="filter-field">
                  <select
                    aria-label="Filtrar por agente"
                    value={filters.agent}
                    onChange={(e) => setFilter('agent', e.target.value)}
                  >
                    <option>Todos</option>
                    {uniqueSorted(data.vods.map((v) => v.agent)).map(
                      (value) => (
                        <option key={value}>{value}</option>
                      )
                    )}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div className="filter-field">
                  <select
                    aria-label="Filtrar por tipo"
                    value={filters.matchType}
                    onChange={(e) => setFilter('matchType', e.target.value)}
                  >
                    <option>Todos</option>
                    {MATCH_TYPES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div className="filter-field">
                  <select
                    aria-label="Filtrar por resultado"
                    value={filters.result}
                    onChange={(e) => setFilter('result', e.target.value)}
                  >
                    <option>Todos</option>
                    {RESULTS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              {filteredVods.length === 0 ? (
                <EmptyState
                  icon={FileVideo2}
                  title={
                    data.vods.length
                      ? 'Nenhum VOD encontrado'
                      : 'Sua biblioteca começa aqui'
                  }
                  text={
                    data.vods.length
                      ? 'Tente mudar os filtros ou a busca.'
                      : 'Adicione o link de uma partida do YouTube, registre mapa, agente, abates e resultado.'
                  }
                  actionLabel="Adicionar primeiro VOD"
                  onAction={() => openCreate('vod')}
                />
              ) : (
                <div className="vod-list">
                  {filteredVods.map((vod) => (
                    <VodCard
                      key={vod.id}
                      vod={vod}
                      gameplan={data.gameplans.find(
                        (plan) => plan.id === vod.gameplanId
                      )}
                      onEdit={() => openEdit('vod', vod)}
                      onDelete={() => removeEntry('vod', vod.id)}
                      onOpen={() => openExternal(vod.link)}
                      onReview={() => setReviewVod(vod)}
                      onCopyDiscord={handleCopyDiscordReport}
                      onExportMatch={handleExportMatch}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
          {view === 'lineups' && (
            <LineupsPage
              lineups={filteredLineups}
              allLineups={data.lineups}
              maps={lineupsMaps}
              search={search}
              onSearch={setSearch}
              onAdd={(map) => openCreate('lineup', map)}
              onEdit={(item) => openEdit('lineup', item)}
              onDelete={(id) => removeEntry('lineup', id)}
              onOpen={openExternal}
              onToast={setToast}
            />
          )}
          {view === 'tactics' && (
            <TacticsPage
              tactics={data.tactics}
              maps={tacticsMaps}
              onAdd={(map) => openCreate('tactic', map)}
              onEdit={(item) => openEdit('tactic', item)}
              onDelete={(id) => removeEntry('tactic', id)}
              onOpen={openExternal}
              onExportDefaults={exportDefaults}
              onImportDefaults={importDefaults}
              onToast={setToast}
            />
          )}
          {view === 'gameplans' && (
            <GameplansPage
              gameplans={data.gameplans}
              maps={gameplanMaps}
              vods={data.vods}
              onAdd={(map) => openCreate('gameplan', map)}
              onEdit={(item) => openEdit('gameplan', item)}
              onDelete={(id) => removeEntry('gameplan', id)}
              onToast={setToast}
            />
          )}
          {view === 'catalogs' && (
            <CatalogManager
              maps={data.maps}
              agents={data.agents}
              vods={data.vods}
              lineups={data.lineups}
              tactics={data.tactics}
              gameplans={data.gameplans}
              onAddMap={() => openCreate('catalogMap')}
              onAddAgent={() => openCreate('catalogAgent')}
              onEditMap={(item) => openEdit('catalogMap', item)}
              onEditAgent={(item) => openEdit('catalogAgent', item)}
              onDeleteMap={(id) => removeEntry('catalogMap', id)}
              onDeleteAgent={(id) => removeEntry('catalogAgent', id)}
              onToggleMap={(item) =>
                setData((previous) => ({
                  ...previous,
                  maps: previous.maps.map((row) =>
                    row.id === item.id
                      ? { ...row, competitiveActive: !row.competitiveActive }
                      : row
                  ),
                }))
              }
              onToggleAgent={(item) =>
                setData((previous) => ({
                  ...previous,
                  agents: previous.agents.map((row) =>
                    row.id === item.id ? { ...row, active: !row.active } : row
                  ),
                }))
              }
              onRestoreDefaults={restoreCatalogDefaults}
            />
          )}
          {view === 'training' && (
            <TrainingPage
              training={data.training}
              onAdd={() => openCreate('training')}
              onEdit={(item) => openEdit('training', item)}
              onDelete={(id) => removeEntry('training', id)}
              onToggle={(item) =>
                setData((prev) => ({
                  ...prev,
                  training: prev.training.map((row) =>
                    row.id === item.id ? { ...row, done: !row.done } : row
                  ),
                }))
              }
              onToggleAllWeek={(weekItems, markDone) =>
                setData((prev) => ({
                  ...prev,
                  training: prev.training.map((row) =>
                    weekItems.some((wi) => wi.id === row.id)
                      ? { ...row, done: markDone }
                      : row
                  ),
                }))
              }
              onToast={setToast}
            />
          )}
          {view === 'stats' && (
            <StatsPage
              vods={data.vods}
              gameplans={data.gameplans}
              onToast={setToast}
            />
          )}
        </div>

        <footer className="main-footer">
          <span>
            KRING VLR <span className="footer-dot">•</span> Ferramenta pessoal
            de análise
          </span>
          <span>
            <ShieldCheck size={13} /> Salvamento automático local
          </span>
        </footer>
      </main>

      {modal && (
        <Modal
          title={
            modal === 'vod'
              ? editingId
                ? 'Editar partida'
                : 'Adicionar partida'
              : modal === 'lineup'
                ? editingId
                  ? 'Editar lineup'
                  : 'Nova lineup'
                : modal === 'tactic'
                  ? editingId
                    ? 'Editar tático'
                    : 'Novo tático'
                  : modal === 'gameplan'
                    ? editingId
                      ? 'Editar Gameplan'
                      : 'Novo Gameplan'
                    : modal === 'catalogMap'
                      ? editingId
                        ? 'Editar mapa'
                        : 'Adicionar mapa'
                      : modal === 'catalogAgent'
                        ? editingId
                          ? 'Editar agente'
                          : 'Adicionar agente'
                        : editingId
                          ? 'Editar treino'
                          : 'Adicionar treino'
          }
          subtitle={
            modal === 'vod'
              ? 'Registre a partida, o plano utilizado e o placar.'
              : modal === 'training'
                ? 'Organize seus objetivos para a semana.'
                : modal === 'catalogMap' || modal === 'catalogAgent'
                  ? 'Atualize o catálogo usado pelos seletores do app.'
                  : 'Adicione os detalhes para consultar durante a preparação.'
          }
          onClose={requestCloseModal}
          closeOnBackdrop={false}
        >
          <form
            onSubmit={saveForm}
            onPaste={
              ['lineup', 'tactic', 'catalogMap', 'catalogAgent'].includes(modal)
                ? onImagePaste
                : undefined
            }
            className="form-stack"
          >
            {modal === 'vod' ? (
              <>
                <Field label="Título da partida *">
                  <input
                    autoFocus
                    required
                    value={form.title || ''}
                    onChange={(e) => updateForm('title', e.target.value)}
                    placeholder="Ex.: VCB — Remo vs Elevate — Jogo 2"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Tipo de partida">
                    <select
                      aria-label="Tipo de partida"
                      value={form.matchType || ''}
                      onChange={(e) => updateForm('matchType', e.target.value)}
                    >
                      <option value="">Não informado</option>
                      {MATCH_TYPES.map((typeOpt) => (
                        <option key={typeOpt} value={typeOpt}>
                          {typeOpt}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Adversário">
                    <input
                      value={form.opponent || ''}
                      onChange={(e) => updateForm('opponent', e.target.value)}
                      placeholder="Ex.: Team Liquid, LOUD..."
                    />
                  </Field>
                </div>
                <Field label="Link da VOD">
                  <div className="input-with-icon">
                    <Video size={16} />
                    <input
                      value={form.link || ''}
                      onChange={(e) => updateForm('link', e.target.value)}
                      placeholder="https://youtube.com/..."
                    />
                  </div>
                </Field>
                <div className="scrim-analyzer-box">
                  <div className="scrim-analyzer-header">
                    <div className="scrim-analyzer-title">
                      <Sparkles size={20} />
                      <div>
                        <strong>
                          Análise de Scrim (Visão Computacional & IA)
                        </strong>
                        <span>
                          Extrai placar, rounds, quem matou quem, headshots e
                          first kills diretamente do vídeo local.
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="scrim-file-row">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={pickVideoFile}
                    >
                      <FolderOpen size={15} />{' '}
                      {form.localVideoName ||
                        'Escolher gravação do treino (.mp4, .mkv)'}
                    </button>
                    <input
                      ref={vodFileInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,.mkv"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setDetectedRoster(null);
                          setManualNickMode(false);
                          updateForm('localVideoName', file.name);
                          updateForm('localVideoPath', file.path || file.name);
                          if (!form.title)
                            updateForm(
                              'title',
                              file.name.replace(/\.[^/.]+$/, '')
                            );
                        }
                      }}
                    />
                    <div
                      className="scrim-file-path"
                      title={form.localVideoPath}
                    >
                      {form.localVideoPath ||
                        'Nenhum arquivo de vídeo selecionado'}
                    </div>
                    {!scrimProgress.busy ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={!form.localVideoPath || detectingRoster}
                          onClick={detectRosterFromVideo}
                          title="Extrai os jogadores do pré-jogo da partida em ~3 segundos"
                        >
                          <Users size={14} />{' '}
                          {detectingRoster
                            ? 'Detectando…'
                            : 'Detectar Jogadores'}
                        </button>
                        <button
                          type="button"
                          className="button button-primary button-small"
                          disabled={!form.localVideoPath || detectingRoster}
                          onClick={startNativeAnalysis}
                        >
                          <Crosshair size={14} /> Iniciar Análise do Treino
                        </button>
                      </div>
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

                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      marginBottom: '12px',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontWeight: 500,
                        fontSize: '13px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.useAllyRoster ?? false}
                        onChange={(e) =>
                          updateForm('useAllyRoster', e.target.checked)
                        }
                      />
                      <span>Meu Elenco Aliado Fixo (5 jogadores)</span>
                    </label>

                    {form.useAllyRoster && (
                      <div style={{ marginTop: '10px' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: '6px',
                            marginBottom: '8px',
                          }}
                        >
                          {[0, 1, 2, 3, 4].map((idx) => (
                            <input
                              key={idx}
                              placeholder={`Aliado ${idx + 1}`}
                              value={form.allyRosterList?.[idx] || ''}
                              onChange={(e) => {
                                const next = [
                                  ...(form.allyRosterList || [
                                    '',
                                    '',
                                    '',
                                    '',
                                    '',
                                  ]),
                                ];
                                next[idx] = e.target.value;
                                updateForm('allyRosterList', next);
                              }}
                              style={{ fontSize: '12px', padding: '6px 8px' }}
                            />
                          ))}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px',
                          }}
                        >
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              color: 'rgba(255, 255, 255, 0.7)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={form.saveAsDefaultRoster ?? false}
                              onChange={(e) =>
                                updateForm(
                                  'saveAsDefaultRoster',
                                  e.target.checked
                                )
                              }
                            />
                            Salvar como padrão nas configurações
                          </label>
                          <button
                            type="button"
                            className="button button-ghost button-small"
                            onClick={async () => {
                              const cleaned = (form.allyRosterList || [])
                                .map((s) => (s || '').trim())
                                .filter(Boolean);
                              if (cleaned.length !== 5) {
                                setToast(
                                  'Preencha os 5 apelidos antes de salvar.'
                                );
                                return;
                              }
                              if (window.kringAPI?.saveSettings) {
                                await window.kringAPI.saveSettings({
                                  allyRosterEnabled: true,
                                  defaultAllyRoster: cleaned,
                                });
                                setAppSettings({
                                  allyRosterEnabled: true,
                                  defaultAllyRoster: cleaned,
                                });
                                setToast('Elenco padrão salvo com sucesso!');
                              }
                            }}
                          >
                            Salvar Padrão
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {detectedRoster && (detectedRoster.friendly?.length > 0 || detectedRoster.enemy?.length > 0) && (
                    <div
                      style={{
                        background: 'rgba(56, 189, 248, 0.05)',
                        border: '1px solid rgba(56, 189, 248, 0.25)',
                        borderRadius: '8px',
                        padding: '12px',
                        marginBottom: '14px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px',
                        }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>
                          Elenco Detectado no Pré-Jogo (editável antes de iniciar a análise)
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Corrija apelidos com erro de OCR antes de rodar
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#22c55e',
                              display: 'block',
                              marginBottom: '6px',
                            }}
                          >
                            Time Aliado ({detectedRoster.friendly?.length || 0})
                          </span>
                          {(detectedRoster.friendly || []).map((p, idx) => (
                            <div
                              key={`friendly-${idx}`}
                              style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}
                            >
                              <input
                                value={p.nick || ''}
                                onChange={(e) =>
                                  updateDetectedPlayer('friendly', idx, 'nick', e.target.value)
                                }
                                placeholder={`Aliado ${idx + 1}`}
                                style={{ fontSize: '12px', padding: '4px 6px', flex: 1 }}
                                title="Apelido do aliado (editável)"
                              />
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: '#94a3b8',
                                  minWidth: '60px',
                                  alignSelf: 'center',
                                }}
                              >
                                {p.agent || ''}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#ef4444',
                              display: 'block',
                              marginBottom: '6px',
                            }}
                          >
                            Time Inimigo ({detectedRoster.enemy?.length || 0})
                          </span>
                          {(detectedRoster.enemy || []).map((p, idx) => (
                            <div
                              key={`enemy-${idx}`}
                              style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}
                            >
                              <input
                                value={p.nick || ''}
                                onChange={(e) =>
                                  updateDetectedPlayer('enemy', idx, 'nick', e.target.value)
                                }
                                placeholder={`Inimigo ${idx + 1}`}
                                style={{ fontSize: '12px', padding: '4px 6px', flex: 1 }}
                                title="Apelido do adversário (editável)"
                              />
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: '#94a3b8',
                                  minWidth: '60px',
                                  alignSelf: 'center',
                                }}
                              >
                                {p.agent || ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {detectedRoster?.friendly?.length > 0 && !manualNickMode ? (
                    <Field label="Seu nick na partida (selecione entre os jogadores aliados detectados)">
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                        }}
                      >
                        <select
                          value={form.playerName || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__MANUAL__') {
                              setManualNickMode(true);
                              return;
                            }
                            const found = detectedRoster.friendly.find(
                              (p) => p.nick === val
                            );
                            setForm((prev) => ({
                              ...prev,
                              playerName: val,
                              agent: found?.agent || prev.agent,
                              kills: (found?.kills !== undefined && found?.kills !== null) ? found.kills : prev.kills,
                              deaths: (found?.deaths !== undefined && found?.deaths !== null) ? found.deaths : prev.deaths,
                              assists: (found?.assists !== undefined && found?.assists !== null) ? found.assists : prev.assists,
                            }));
                          }}
                        >
                          <option value="">Selecione seu nick</option>
                          {detectedRoster.friendly.map((p) => {
                            const kda = p.kills !== undefined && p.kills !== null
                              ? ` · ${p.kills}/${p.deaths}/${p.assists}`
                              : '';
                            return (
                              <option key={p.nick} value={p.nick}>
                                {p.nick} {p.agent ? `(${p.agent})` : ''}{kda}
                              </option>
                            );
                          })}
                          <option value="__MANUAL__">
                            Outro (digitar manualmente)...
                          </option>
                        </select>
                        <button
                          type="button"
                          className="button button-ghost button-small"
                          onClick={() => setManualNickMode(true)}
                          title="Digitar apelido manualmente"
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    </Field>
                  ) : (
                    <Field label="Seu nick na partida (para identificar seus abates e mortes no time)">
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                        }}
                      >
                        <input
                          value={form.playerName || ''}
                          onChange={(e) =>
                            updateForm('playerName', e.target.value)
                          }
                          placeholder="Ex.: SeuNick"
                        />
                        {detectedRoster?.friendly?.length > 0 && (
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            onClick={() => setManualNickMode(false)}
                            title="Voltar para a lista de jogadores detectados"
                          >
                            <Users size={13} /> Lista
                          </button>
                        )}
                      </div>
                    </Field>
                  )}

                  {scrimProgress.busy && (
                    <>
                      <div className="scrim-live-hud">
                        <div className="scrim-hud-score">
                          PLACAR: {scrimProgress.score}
                        </div>
                        <div className="scrim-hud-meta">
                          <span>
                            <strong>Round {scrimProgress.round}</strong>
                          </span>
                          <span>{scrimProgress.message}</span>
                          <span>
                            <strong>{scrimProgress.percent}%</strong>
                          </span>
                        </div>
                      </div>
                      <div
                        className="progress-track"
                        style={{ height: '6px', margin: '6px 0 10px' }}
                      >
                        <div
                          className="progress-fill"
                          style={{
                            width: `${scrimProgress.percent}%`,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      {scrimProgress.liveKills.length > 0 && (
                        <div className="scrim-live-stream">
                          <span
                            style={{
                              fontSize: '10px',
                              color: '#889',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            Abates detectados em tempo real:
                          </span>
                          {scrimProgress.liveKills.slice(0, 6).map((ev, i) => (
                            <div key={i} className="scrim-kill-item">
                              <span className="scrim-kill-time">{ev.time}</span>
                              <div className="kill-player-unit">
                                <span
                                  className={`badge-team-${ev.killer_team}`}
                                >
                                  {ev.killer}
                                </span>
                                {ev.killer_agent && (
                                  <span className="agent-tag">
                                    {ev.killer_agent}
                                  </span>
                                )}
                              </div>
                              <span style={{ color: '#667' }}>➔</span>
                              <div className="kill-player-unit">
                                <span
                                  className={`badge-team-${ev.victim_team}`}
                                >
                                  {ev.victim}
                                </span>
                                {ev.victim_agent && (
                                  <span className="agent-tag">
                                    {ev.victim_agent}
                                  </span>
                                )}
                              </div>
                              {ev.headshot && (
                                <span className="kill-tag-hs">
                                  <Crosshair size={9} /> HS
                                </span>
                              )}
                              {ev.first_kill && (
                                <span className="kill-tag-fk">
                                  <Zap size={9} /> 1st
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="form-row">
                  <Field label="Mapa *">
                    <select
                      required
                      value={form.map || ''}
                      onChange={(e) => updateForm('map', e.target.value)}
                    >
                      <option value="">Selecione um mapa</option>
                      {form.map &&
                        !activeMaps.some((item) => item.name === form.map) && (
                          <option value={form.map}>{form.map} (inativo)</option>
                        )}
                      {activeMaps.map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Agente jogado *">
                    <select
                      required
                      value={form.agent || ''}
                      onChange={(e) => updateForm('agent', e.target.value)}
                    >
                      <option value="">Selecione um agente</option>
                      {form.agent &&
                        !activeAgents.some(
                          (item) => item.name === form.agent
                        ) && (
                          <option value={form.agent}>
                            {form.agent} (inativo)
                          </option>
                        )}
                      {activeAgents.map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Gameplan utilizado">
                  <select
                    value={form.gameplanId || ''}
                    onChange={(e) => {
                      const plan = data.gameplans.find(
                        (item) => item.id === e.target.value
                      );
                      setForm((previous) => ({
                        ...previous,
                        gameplanId: e.target.value,
                        ...(plan ? { map: plan.map } : {}),
                      }));
                    }}
                  >
                    <option value="">Nenhum Gameplan</option>
                    {data.gameplans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {plan.map} · {plan.side}
                      </option>
                    ))}
                  </select>
                  {!data.gameplans.length && (
                    <span className="helper-text">
                      Cadastre um Gameplan na aba correspondente para vinculá-lo
                      aqui.
                    </span>
                  )}
                </Field>
                <div className="form-row">
                  <Field label="Abates">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.kills ?? ''}
                      onChange={(e) => updateForm('kills', e.target.value)}
                      placeholder="Ex.: 21"
                    />
                  </Field>
                  <Field label="Mortes">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.deaths ?? ''}
                      onChange={(e) => updateForm('deaths', e.target.value)}
                      placeholder="Ex.: 16"
                    />
                  </Field>
                </div>
                <div className="form-row">
                  <Field label="Assistências">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.assists ?? ''}
                      onChange={(e) => updateForm('assists', e.target.value)}
                      placeholder="Ex.: 7"
                    />
                  </Field>
                  <Field label="Data da partida">
                    <input
                      type="date"
                      value={form.date || today()}
                      onChange={(e) => updateForm('date', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Resultado *">
                  <div className="result-choice">
                    {RESULTS.map((result) => (
                      <button
                        type="button"
                        key={result}
                        onClick={() => updateForm('result', result)}
                        className={`result-option ${form.result === result ? `selected ${result.toLowerCase()}` : ''}`}
                      >
                        <span className="result-radio">
                          {form.result === result && <Check size={11} />}
                        </span>
                        {result}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="form-row">
                  <Field label="Rounds ganhos">
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={form.roundsWon ?? ''}
                      onChange={(e) => updateForm('roundsWon', e.target.value)}
                      placeholder="Ex.: 13"
                    />
                  </Field>
                  <Field label="Rounds perdidos">
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={form.roundsLost ?? ''}
                      onChange={(e) => updateForm('roundsLost', e.target.value)}
                      placeholder="Ex.: 8"
                    />
                  </Field>
                </div>
                <Field label="Lado inicial da partida">
                  <div className="result-choice">
                    {[
                      { value: '', label: 'Não informado' },
                      { value: 'Ataque', label: 'Ataque' },
                      { value: 'Defesa', label: 'Defesa' },
                    ].map((opt) => {
                      const active =
                        (normalizeSide(form.startingSide) || '') === opt.value;
                      return (
                        <button
                          type="button"
                          key={opt.label}
                          onClick={() => updateForm('startingSide', opt.value)}
                          className={`result-option ${active ? 'selected' : ''}`}
                        >
                          <span className="result-radio">
                            {active && <Check size={11} />}
                          </span>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="helper-text">
                    Preenche automaticamente os rounds de Ataque vs Defesa em
                    partidas analisadas (R1–12, R13–24 e OT).
                  </span>
                </Field>
                <Field label="Rounds por lado">
                  <div className="round-results-grid">
                    {['Ataque', 'Defesa'].map((side) => (
                      <section className="round-side" key={side}>
                        <h3>{side}</h3>
                        {ROUND_RESULTS.map((round) => (
                          <label className="round-result-row" key={round}>
                            <span>{round}</span>
                            <select
                              aria-label={`${side}: ${round}`}
                              value={form.roundResults?.[side]?.[round] || ''}
                              onChange={(e) => {
                                setFormDirty(true);
                                setForm((previous) => ({
                                  ...previous,
                                  roundResults: {
                                    ...previous.roundResults,
                                    [side]: {
                                      ...previous.roundResults?.[side],
                                      [round]: e.target.value,
                                    },
                                  },
                                }));
                              }}
                            >
                              <option value="">Não registrado</option>
                              <option value="Ganhamos">Ganhamos</option>
                              <option value="Perdemos">Perdemos</option>
                            </select>
                          </label>
                        ))}
                      </section>
                    ))}
                  </div>
                </Field>
                <Field label="First Kills e First Deaths">
                  <div className="opening-duels-list">
                    {(form.openingDuels || []).map((item, index) => (
                      <div className="opening-duel-row" key={index}>
                        <input
                          aria-label="Round"
                          type="number"
                          min="1"
                          max="30"
                          placeholder="Round"
                          value={item.round || ''}
                          onChange={(e) => {
                            setFormDirty(true);
                            setForm((p) => ({
                              ...p,
                              openingDuels: p.openingDuels.map((row, i) =>
                                i === index
                                  ? { ...row, round: e.target.value }
                                  : row
                              ),
                            }));
                          }}
                        />
                        <select
                          aria-label="Tipo de evento"
                          value={item.event || 'First Kill'}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              openingDuels: p.openingDuels.map((row, i) =>
                                i === index
                                  ? { ...row, event: e.target.value }
                                  : row
                              ),
                            }))
                          }
                        >
                          <option>First Kill</option>
                          <option>First Death</option>
                        </select>
                        <input
                          aria-label="Timestamp da VOD"
                          placeholder="MM:SS"
                          value={item.time || ''}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              openingDuels: p.openingDuels.map((row, i) =>
                                i === index
                                  ? { ...row, time: e.target.value }
                                  : row
                              ),
                            }))
                          }
                        />
                        <input
                          aria-label="Jogador"
                          placeholder="Jogador"
                          value={item.player || ''}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              openingDuels: p.openingDuels.map((row, i) =>
                                i === index
                                  ? { ...row, player: e.target.value }
                                  : row
                              ),
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="icon-button danger"
                          title="Remover evento"
                          onClick={() =>
                            setForm((p) => ({
                              ...p,
                              openingDuels: p.openingDuels.filter(
                                (_, i) => i !== index
                              ),
                            }))
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          openingDuels: [
                            ...(p.openingDuels || []),
                            {
                              round: '',
                              time: '',
                              event: 'First Kill',
                              player: '',
                            },
                          ],
                        }))
                      }
                    >
                      <Plus size={14} /> Registrar evento
                    </button>
                    <span className="helper-text">
                      Anote o primeiro abate ou a primeira morte de cada round
                      enquanto revê a VOD.
                    </span>
                  </div>
                </Field>
                <Field label="Notas da análise">
                  <textarea
                    rows="3"
                    value={form.notes || ''}
                    onChange={(e) => updateForm('notes', e.target.value)}
                    placeholder="Pontos fortes, erros recorrentes, decisões de IGL, rounds para rever..."
                  />
                </Field>
                <Field label="Plano de jogo">
                  <textarea
                    rows="3"
                    value={form.gamePlan || ''}
                    onChange={(e) => updateForm('gamePlan', e.target.value)}
                    placeholder="Estratégia combinada para a partida: defaults, execuções, condições e ajustes..."
                  />
                </Field>
              </>
            ) : modal === 'lineup' ? (
              <>
                <Field label="Nome da lineup *">
                  <input
                    autoFocus
                    required
                    value={form.title || ''}
                    onChange={(e) => updateForm('title', e.target.value)}
                    placeholder="Ex.: Smoke + molly para retake A"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Mapa *">
                    <select
                      required
                      value={form.map || ''}
                      onChange={(e) => updateForm('map', e.target.value)}
                    >
                      <option value="">Selecione um mapa</option>
                      {form.map &&
                        !activeMaps.some((item) => item.name === form.map) && (
                          <option value={form.map}>{form.map} (inativo)</option>
                        )}
                      {activeMaps.map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Agente *">
                    <select
                      required
                      value={form.agent || ''}
                      onChange={(e) => updateForm('agent', e.target.value)}
                    >
                      <option value="">Selecione um agente</option>
                      {form.agent &&
                        !activeAgents.some(
                          (item) => item.name === form.agent
                        ) && (
                          <option value={form.agent}>
                            {form.agent} (inativo)
                          </option>
                        )}
                      {activeAgents.map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="form-row">
                  <Field label="Habilidade">
                    <input
                      value={form.ability || ''}
                      onChange={(e) => updateForm('ability', e.target.value)}
                      placeholder="Ex.: Viper wall / Omen smoke"
                    />
                  </Field>
                  <Field label="Lado">
                    <select
                      value={form.side || 'Ataque'}
                      onChange={(e) => updateForm('side', e.target.value)}
                    >
                      <option>Ataque</option>
                      <option>Defesa</option>
                      <option>Ambos</option>
                    </select>
                  </Field>
                </div>
                <Field label="Como executar">
                  <textarea
                    rows="4"
                    value={form.instructions || ''}
                    onChange={(e) => updateForm('instructions', e.target.value)}
                    placeholder="Posição inicial, referência no cenário, timing, comunicação e objetivo..."
                  />
                </Field>
                <Field label="Link de referência">
                  <div className="input-with-icon">
                    <ExternalLink size={16} />
                    <input
                      value={form.link || ''}
                      onChange={(e) => updateForm('link', e.target.value)}
                      placeholder="YouTube, guia ou vídeo de referência"
                    />
                  </div>
                </Field>
                <Field label="Imagem / screenshot (opcional)">
                  <div className="image-upload-row">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageBusy}
                    >
                      <Upload size={15} />{' '}
                      {imageBusy
                        ? 'Processando...'
                        : form.imageData
                          ? 'Trocar imagem'
                          : 'Escolher imagem'}
                    </button>
                    <span className="helper-text">
                      Escolha um arquivo ou cole um print diretamente.
                    </span>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={onImageSelected}
                    />
                  </div>
                  <button
                    type="button"
                    className={`image-paste-zone ${form.imageData ? 'has-image' : ''}`}
                    disabled={imageBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.currentTarget.focus();
                    }}
                    title="Clique nesta área e pressione Ctrl + V para colar um screenshot da área de transferência."
                  >
                    <ClipboardPaste size={19} />
                    <span>
                      <strong>
                        {imageBusy
                          ? 'Processando screenshot...'
                          : 'Colar screenshot com Ctrl + V'}
                      </strong>
                      <small>
                        Copie o print (por exemplo, com Win + Shift + S), clique
                        aqui e pressione Ctrl + V.
                      </small>
                    </span>
                  </button>
                  {form.imageData && (
                    <div className="image-preview-wrap">
                      <img
                        className="form-image-preview"
                        src={form.imageData}
                        alt="Prévia da lineup"
                      />
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Remover imagem"
                        onClick={() => updateForm('imageData', '')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </Field>
              </>
            ) : modal === 'tactic' ? (
              <>
                <Field label="Nome da tática *">
                  <input
                    autoFocus
                    required
                    value={form.title || ''}
                    onChange={(e) => updateForm('title', e.target.value)}
                    placeholder="Ex.: Default 1-3-1 com pressão no meio"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Mapa *">
                    <select
                      required
                      value={form.map || ''}
                      onChange={(e) => updateForm('map', e.target.value)}
                    >
                      <option value="">Selecione um mapa</option>
                      {form.map &&
                        !activeMaps.some((item) => item.name === form.map) && (
                          <option value={form.map}>{form.map} (inativo)</option>
                        )}
                      {activeMaps.map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Categoria">
                    <select
                      value={form.category || 'Default'}
                      onChange={(e) => updateForm('category', e.target.value)}
                    >
                      {TACTIC_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Lado">
                  <select
                    value={form.side || 'Ataque'}
                    onChange={(e) => updateForm('side', e.target.value)}
                  >
                    <option>Ataque</option>
                    <option>Defesa</option>
                    <option>Ambos</option>
                  </select>
                </Field>
                <Field label="Como funciona">
                  <textarea
                    rows="5"
                    value={form.description || ''}
                    onChange={(e) => updateForm('description', e.target.value)}
                    placeholder="Posicionamento, sequência, utilitários e condição de execução..."
                  />
                </Field>
                <Field label="Link do YouTube ou referência">
                  <div className="input-with-icon">
                    <ExternalLink size={16} />
                    <input
                      value={form.link || ''}
                      onChange={(e) => updateForm('link', e.target.value)}
                      placeholder="https://youtube.com/..."
                    />
                  </div>
                </Field>
                <Field label="Print do tático">
                  <div className="image-upload-row">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageBusy}
                    >
                      <Upload size={15} />{' '}
                      {imageBusy
                        ? 'Processando...'
                        : form.imageData
                          ? 'Trocar print'
                          : 'Escolher imagem'}
                    </button>
                    <span className="helper-text">
                      Selecione uma imagem baixada ou cole um print.
                    </span>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={onImageSelected}
                    />
                  </div>
                  <button
                    type="button"
                    className={`image-paste-zone ${form.imageData ? 'has-image' : ''}`}
                    disabled={imageBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.currentTarget.focus();
                    }}
                    title="Clique aqui e pressione Ctrl + V para colar um print."
                  >
                    <ClipboardPaste size={19} />
                    <span>
                      <strong>
                        {imageBusy
                          ? 'Processando print...'
                          : 'Colar print com Ctrl + V'}
                      </strong>
                      <small>
                        Copie um print, clique nesta área e pressione Ctrl + V.
                      </small>
                    </span>
                  </button>
                  {form.imageData && (
                    <div className="image-preview-wrap">
                      <img
                        className="form-image-preview"
                        src={form.imageData}
                        alt="Prévia do print do tático"
                      />
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Remover print"
                        onClick={() => updateForm('imageData', '')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </Field>
              </>
            ) : modal === 'gameplan' ? (
              <>
                <Field label="Nome do Gameplan *">
                  <input
                    autoFocus
                    required
                    value={form.name || ''}
                    onChange={(e) => updateForm('name', e.target.value)}
                    placeholder="Ex.: Agressivo B Master"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Mapa *">
                    <select
                      required
                      value={form.map || ''}
                      onChange={(e) => updateForm('map', e.target.value)}
                    >
                      <option value="">Selecione um mapa</option>
                      {form.map &&
                        !activeMaps.some((item) => item.name === form.map) && (
                          <option value={form.map}>{form.map} (inativo)</option>
                        )}
                      {activeMaps.map((item) => (
                        <option key={item.id} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Lado">
                    <select
                      value={form.side || 'Ambos'}
                      onChange={(e) => updateForm('side', e.target.value)}
                    >
                      <option>Ataque</option>
                      <option>Defesa</option>
                      <option>Ambos</option>
                    </select>
                  </Field>
                </div>
                <div className="field">
                  <span className="field-label">Composição recomendada</span>
                  <div className="agent-check-grid">
                    {data.agents.map((agent) => (
                      <label
                        className={`agent-check ${agent.active ? '' : 'inactive'}`}
                        key={agent.id}
                      >
                        <input
                          type="checkbox"
                          disabled={
                            !agent.active &&
                            !(form.agentIds || []).includes(agent.id)
                          }
                          checked={(form.agentIds || []).includes(agent.id)}
                          onChange={(event) =>
                            updateForm(
                              'agentIds',
                              event.target.checked
                                ? [...(form.agentIds || []), agent.id]
                                : (form.agentIds || []).filter(
                                    (id) => id !== agent.id
                                  )
                            )
                          }
                        />
                        <span>{agent.name}</span>
                        <small>{agent.role}</small>
                      </label>
                    ))}
                  </div>
                  <span className="helper-text">
                    Selecione os agentes recomendados. Agentes inativos já
                    vinculados podem ser removidos da composição.
                  </span>
                </div>
                <Field label="Descrição / notas">
                  <textarea
                    rows="5"
                    value={form.description || ''}
                    onChange={(e) => updateForm('description', e.target.value)}
                    placeholder="Plano de execução, posições, utilitários e condições..."
                  />
                </Field>
              </>
            ) : modal === 'catalogAgent' ? (
              <>
                <Field label="Nome do agente *">
                  <input
                    autoFocus
                    required
                    value={form.name || ''}
                    onChange={(e) => updateForm('name', e.target.value)}
                    placeholder="Ex.: Novo agente"
                  />
                </Field>
                <Field label="Classe">
                  <select
                    value={form.role || AGENT_ROLES[0]}
                    onChange={(e) => updateForm('role', e.target.value)}
                  >
                    {AGENT_ROLES.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Ícone do agente (URL ou upload local)">
                  <div className="catalog-media-input-group">
                    <div className="input-with-icon" style={{ flex: 1 }}>
                      <ExternalLink size={16} />
                      <input
                        value={form.iconUrl || ''}
                        onChange={(e) => updateForm('iconUrl', e.target.value)}
                        placeholder="https://... ou imagem carregada"
                      />
                    </div>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageBusy}
                    >
                      <Upload size={14} />{' '}
                      {imageBusy
                        ? 'Processando...'
                        : form.iconUrl
                          ? 'Trocar ícone'
                          : 'Upload local'}
                    </button>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={onImageSelected}
                    />
                  </div>
                  <span className="helper-text">
                    Insira uma URL pública ou escolha uma imagem do seu
                    computador (ou cole com Ctrl+V).
                  </span>
                  {form.iconUrl && (
                    <div className="catalog-modal-preview agent-icon-preview">
                      <img src={form.iconUrl} alt="Prévia do ícone" />
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Remover ícone"
                        onClick={() => updateForm('iconUrl', '')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </Field>
                <label className="catalog-toggle-field">
                  <input
                    type="checkbox"
                    checked={form.active !== false}
                    onChange={(e) => updateForm('active', e.target.checked)}
                  />
                  <span>Ativo nos novos registros e seletores</span>
                </label>
              </>
            ) : modal === 'catalogMap' ? (
              <>
                <Field label="Nome do mapa *">
                  <input
                    autoFocus
                    required
                    value={form.name || ''}
                    onChange={(e) => updateForm('name', e.target.value)}
                    placeholder="Ex.: Novo mapa"
                  />
                </Field>
                <Field label="Imagem de preview (URL ou upload local)">
                  <div className="catalog-media-input-group">
                    <div className="input-with-icon" style={{ flex: 1 }}>
                      <ExternalLink size={16} />
                      <input
                        value={form.previewUrl || ''}
                        onChange={(e) =>
                          updateForm('previewUrl', e.target.value)
                        }
                        placeholder="https://... ou imagem carregada"
                      />
                    </div>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageBusy}
                    >
                      <Upload size={14} />{' '}
                      {imageBusy
                        ? 'Processando...'
                        : form.previewUrl
                          ? 'Trocar preview'
                          : 'Upload local'}
                    </button>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={onImageSelected}
                    />
                  </div>
                  <span className="helper-text">
                    Insira uma URL pública ou escolha uma imagem do seu
                    computador (ou cole com Ctrl+V).
                  </span>
                  {form.previewUrl && (
                    <div className="catalog-modal-preview">
                      <img src={form.previewUrl} alt="Prévia do mapa" />
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Remover imagem"
                        onClick={() => updateForm('previewUrl', '')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </Field>
                <label className="catalog-toggle-field">
                  <input
                    type="checkbox"
                    checked={form.competitiveActive !== false}
                    onChange={(e) =>
                      updateForm('competitiveActive', e.target.checked)
                    }
                  />
                  <span>Disponível no pool competitivo (VCT)</span>
                </label>
              </>
            ) : (
              <>
                <Field label="O que vai treinar? *">
                  <input
                    autoFocus
                    required
                    value={form.title || ''}
                    onChange={(e) => updateForm('title', e.target.value)}
                    placeholder="Ex.: Counter strafe e primeira bala"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Semana de início">
                    <input
                      type="date"
                      value={form.week || today()}
                      onChange={(e) => updateForm('week', e.target.value)}
                    />
                  </Field>
                  <Field label="Categoria">
                    <select
                      value={form.category || 'Mecânica'}
                      onChange={(e) => updateForm('category', e.target.value)}
                    >
                      {TRAINING_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Tempo planejado (minutos)">
                  <input
                    type="number"
                    min="0"
                    value={form.minutes || ''}
                    onChange={(e) => updateForm('minutes', e.target.value)}
                    placeholder="Ex.: 30"
                  />
                </Field>
                <Field label="Observações">
                  <textarea
                    rows="3"
                    value={form.notes || ''}
                    onChange={(e) => updateForm('notes', e.target.value)}
                    placeholder="Exercício, mapa de treino ou meta da semana"
                  />
                </Field>
              </>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button button-quiet"
                onClick={requestCloseModal}
              >
                Cancelar
              </button>
              <button type="submit" className="button button-primary">
                <Check size={16} />{' '}
                {editingId
                  ? 'Salvar alterações'
                  : modal === 'vod'
                    ? 'Adicionar VOD'
                    : modal === 'lineup'
                      ? 'Salvar lineup'
                      : modal === 'gameplan'
                        ? 'Criar Gameplan'
                        : modal === 'catalogAgent'
                          ? 'Adicionar agente'
                          : modal === 'catalogMap'
                            ? 'Adicionar mapa'
                            : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {clearVodsModal && (
        <Modal
          title="Excluir VODs da biblioteca"
          subtitle="Esta ação remove os registros de partidas salvos localmente."
          onClose={() => setClearVodsModal(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              Você está prestes a excluir{' '}
              <strong>{data.vods.length} partida(s)</strong> da Biblioteca de
              VODs. Os seus Lineups, Táticos, Gameplans, Treinos e Catálogos não
              serão afetados.
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setClearVodsModal(false)}
              >
                Cancelar
              </button>
              {filteredVods.length > 0 &&
                filteredVods.length < data.vods.length && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => clearVods(true)}
                  >
                    <Trash2 size={15} /> Excluir apenas filtrados (
                    {filteredVods.length})
                  </button>
                )}
              <button
                type="button"
                className="button button-danger-solid"
                onClick={() => clearVods(false)}
              >
                <Trash2 size={15} /> Excluir todos ({data.vods.length})
              </button>
            </div>
          </div>
        </Modal>
      )}

      {reviewVod && (
        <InteractiveVodReviewModal
          vod={reviewVod}
          onClose={() => setReviewVod(null)}
          onToast={setToast}
          onExportMatch={handleExportMatch}
          onUpdateStartingSide={handleUpdateVodStartingSide}
          onUpdateReviewNotes={handleUpdateVodReviewNotes}
          onUpdateKill={handleUpdateVodKill}
          onAddKill={handleAddVodKill}
          onDeleteKill={handleDeleteVodKill}
        />
      )}

      <input
        ref={matchFileInputRef}
        type="file"
        accept=".json,.kringmatch"
        hidden
        onChange={handleImportMatchFile}
      />

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={importBackup}
      />
      {toast && (
        <div className="toast">
          <Check size={16} />
          <span>{toast}</span>
          <button aria-label="Fechar aviso" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {!ready && (
        <div className="loading-overlay">
          <div className="loading-mark">
            <Crosshair size={28} />
          </div>
          <span>Carregando seu workspace...</span>
        </div>
      )}
    </div>
  );
}

function LineupsPage({
  lineups,
  allLineups,
  maps,
  search,
  onSearch,
  onAdd,
  onEdit,
  onDelete,
  onOpen,
  onToast,
}) {
  const [selectedMap, setSelectedMap] = useState('');
  const [agentFilter, setAgentFilter] = useState('Todos');
  const [sideFilter, setSideFilter] = useState('Todos');
  const [previewLineup, setPreviewLineup] = useState(null);

  const hasSearch = Boolean(search && search.trim());
  const isGridView = Boolean(selectedMap || hasSearch);

  // Available agents in current scope (either in selectedMap or in allLineups if searching)
  const availableAgents = useMemo(() => {
    const list = selectedMap
      ? allLineups.filter((l) => l.map === selectedMap)
      : allLineups;
    return uniqueSorted(list.map((l) => l.agent));
  }, [allLineups, selectedMap]);

  // Filtered rows
  const rows = useMemo(() => {
    return lineups.filter((item) => {
      if (selectedMap && item.map !== selectedMap) return false;
      if (agentFilter !== 'Todos' && item.agent !== agentFilter) return false;
      if (sideFilter !== 'Todos' && (item.side || 'Ataque') !== sideFilter)
        return false;
      return true;
    });
  }, [lineups, selectedMap, agentFilter, sideFilter]);

  const countForMap = (map) =>
    allLineups.filter((item) => item.map === map).length;

  const copyInstructions = async (lineup) => {
    const text = `**Lineup: ${lineup.title}**\nMapa: ${lineup.map} | Agente: ${lineup.agent} | Lado: ${lineup.side || 'Ataque'}${lineup.ability ? ` | Habilidade: ${lineup.ability}` : ''}\n\n**Instruções:**\n${lineup.instructions || 'Sem instruções registradas.'}${lineup.link ? `\n\nReferência: ${lineup.link}` : ''}`;
    const ok = await copyToClipboard(text);
    if (ok) {
      if (onToast) onToast('Instruções copiadas para a área de transferência!');
    } else {
      if (onToast) onToast('Não foi possível copiar as instruções.');
    }
  };

  const handleSelectMap = (map) => {
    setSelectedMap(map);
    setAgentFilter('Todos');
    setSideFilter('Todos');
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PLAYBOOK PESSOAL</div>
          <h1>
            {selectedMap
              ? `Lineups · ${selectedMap}`
              : hasSearch
                ? 'Resultados da busca'
                : 'Biblioteca de lineups'}
          </h1>
          <p>
            {selectedMap
              ? `Lineups salvas na pasta de ${selectedMap}.`
              : hasSearch
                ? `Exibindo lineups encontradas em todos os mapas para "${search}".`
                : 'Escolha um mapa para abrir a pasta com seus setups e referências.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasSearch && !selectedMap && (
            <button
              className="button button-quiet"
              onClick={() => onSearch('')}
            >
              <X size={15} /> Limpar busca
            </button>
          )}
          <button
            className="button button-primary"
            onClick={() => onAdd(selectedMap || '')}
          >
            <Plus size={17} /> Nova lineup
          </button>
        </div>
      </div>

      <div className="toolbar">
        {selectedMap && (
          <button
            className="button button-quiet button-small"
            onClick={() => handleSelectMap('')}
          >
            <ArrowRight size={14} className="back-arrow" /> Todos os mapas
          </button>
        )}
        <div className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar por nome, mapa, agente ou habilidade..."
          />
        </div>
        {isGridView && (
          <>
            <div className="filter-field">
              <select
                aria-label="Filtrar por agente"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="Todos">Todos os agentes</option>
                {availableAgents.map((ag) => (
                  <option key={ag} value={ag}>
                    {ag}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <div className="filter-field">
              <select
                aria-label="Filtrar por lado"
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value)}
              >
                <option value="Todos">Todos os lados</option>
                {SIDES.map((side) => (
                  <option key={side} value={side}>
                    {side}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </>
        )}
        <div className="toolbar-note">
          <Target size={15} />{' '}
          {isGridView
            ? `${rows.length} ${rows.length === 1 ? 'lineup encontrada' : 'lineups encontradas'}`
            : `${allLineups.length} lineups salvas`}
        </div>
      </div>

      {isGridView ? (
        rows.length ? (
          <div className="lineup-grid">
            {rows.map((lineup) => (
              <LineupCard
                key={lineup.id}
                lineup={lineup}
                onEdit={() => onEdit(lineup)}
                onDelete={() => onDelete(lineup.id)}
                onOpen={() => onOpen(lineup.link)}
                onPreview={() => setPreviewLineup(lineup)}
                onCopy={() => copyInstructions(lineup)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title={
              selectedMap
                ? 'Nenhuma lineup nesta pasta'
                : 'Nenhuma lineup encontrada'
            }
            text={
              hasSearch || agentFilter !== 'Todos' || sideFilter !== 'Todos'
                ? 'Tente ajustar os filtros ou a busca de texto.'
                : 'Adicione a primeira lineup com posições e referências.'
            }
            actionLabel="Nova lineup"
            onAction={() => onAdd(selectedMap || '')}
          />
        )
      ) : (
        <div className="tactic-map-grid">
          {maps.map((map) => (
            <button
              className="panel tactic-map-folder"
              key={map}
              onClick={() => handleSelectMap(map)}
            >
              <span className="tactic-folder-icon">
                <FolderOpen size={22} />
              </span>
              <strong>{map}</strong>
              <span>
                {countForMap(map)}{' '}
                {countForMap(map) === 1 ? 'lineup' : 'lineups'}
              </span>
              <ArrowRight size={15} className="folder-arrow" />
            </button>
          ))}
        </div>
      )}

      {previewLineup && (
        <LightboxModal
          onClose={() => setPreviewLineup(null)}
          imageSrc={previewLineup.imageData}
          imageAlt={`Visualização de ${previewLineup.title}`}
          headerTitle={
            <>
              <div className="lineup-kicker">
                {previewLineup.map} <span>•</span> {previewLineup.agent}
              </div>
              <h2>{previewLineup.title}</h2>
              {previewLineup.ability && (
                <span
                  className="ability-label"
                  style={{ marginTop: 4, display: 'inline-flex' }}
                >
                  <Zap size={13} /> {previewLineup.ability}
                </span>
              )}
            </>
          }
          headerBadge={
            <span
              className={`side-tag ${previewLineup.side?.toLowerCase()}`}
              style={{ position: 'static' }}
            >
              {previewLineup.side || 'Ataque'}
            </span>
          }
          sidebar={
            <>
              <div className="lineup-instructions-box">
                <div className="instructions-header">
                  <strong>Instruções de Execução</strong>
                  <button
                    type="button"
                    className="button button-quiet button-micro"
                    onClick={() => copyInstructions(previewLineup)}
                    title="Copiar texto de execução"
                  >
                    <Copy size={12} /> Copiar
                  </button>
                </div>
                <p>
                  {previewLineup.instructions ||
                    'Nenhuma instrução por escrito cadastrada para esta lineup.'}
                </p>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 'auto',
                }}
              >
                {previewLineup.link && (
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => onOpen(previewLineup.link)}
                  >
                    <ExternalLink size={14} /> Abrir link de referência
                  </button>
                )}
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() => {
                    const item = previewLineup;
                    setPreviewLineup(null);
                    onEdit(item);
                  }}
                >
                  <Pencil size={14} /> Editar dados da lineup
                </button>
              </div>
            </>
          }
        />
      )}
    </section>
  );
}

function GameplansPage({
  gameplans,
  maps,
  vods = [],
  onAdd,
  onEdit,
  onDelete,
  onToast,
}) {
  const [selectedMap, setSelectedMap] = useState('');
  const [search, setSearch] = useState('');
  const [sideFilter, setSideFilter] = useState('Todos');
  const [agentFilter, setAgentFilter] = useState('Todos');

  const hasSearch = Boolean(search && search.trim());
  const isGridView = Boolean(selectedMap || hasSearch);

  // Available agents across gameplans in current scope
  const availableAgents = useMemo(() => {
    const list = selectedMap
      ? gameplans.filter((p) => p.map === selectedMap)
      : gameplans;
    const all = list.flatMap((p) => p.agents || []);
    return uniqueSorted(all);
  }, [gameplans, selectedMap]);

  // Live Performance map from VODs
  const perfByGameplan = useMemo(() => {
    const map = new Map();
    (gameplans || []).forEach((plan) => {
      const matches = (vods || []).filter((v) => v.gameplanId === plan.id);
      const wins = matches.filter((v) => v.result === 'Vitória').length;
      const losses = matches.filter((v) => v.result === 'Derrota').length;
      const decisions = wins + losses;
      const winrate = decisions ? (wins / decisions) * 100 : 0;
      map.set(plan.id, {
        matches: matches.length,
        wins,
        losses,
        decisions,
        winrate,
      });
    });
    return map;
  }, [gameplans, vods]);

  // Filtered gameplans
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return gameplans.filter((plan) => {
      if (selectedMap && plan.map !== selectedMap) return false;
      if (sideFilter !== 'Todos' && plan.side !== sideFilter) return false;
      if (agentFilter !== 'Todos' && !(plan.agents || []).includes(agentFilter))
        return false;
      if (q) {
        const matchesQuery = [
          plan.name,
          plan.map,
          plan.side,
          plan.description,
          ...(plan.agents || []),
        ].some((val) =>
          String(val || '')
            .toLowerCase()
            .includes(q)
        );
        if (!matchesQuery) return false;
      }
      return true;
    });
  }, [gameplans, selectedMap, sideFilter, agentFilter, search]);

  const countForMap = (map) =>
    gameplans.filter((plan) => plan.map === map).length;

  const copyGameplan = async (plan) => {
    const perf = perfByGameplan.get(plan.id);
    let text = `**GAMEPLAN: ${plan.name}**\n`;
    text += `Mapa: **${plan.map}** | Lado: **${plan.side}**\n`;
    if (plan.agents?.length) {
      text += `Composição: **${plan.agents.join(' · ')}**\n`;
    }
    if (perf && perf.decisions > 0) {
      text += `Histórico em Scrims: **${Math.round(perf.winrate)}% WR** (${perf.wins}V - ${perf.losses}D em ${perf.matches} jogos)\n`;
    }
    text += `\n**Estratégia e Execução:**\n${plan.description || 'Sem descrição cadastrada.'}\n\n`;
    text += `*Gerado pelo KRING Valorant Analyzer*`;

    const ok = await copyToClipboard(text);
    if (ok) {
      if (onToast) onToast('Gameplan copiado para a área de transferência!');
    } else {
      if (onToast) onToast('Não foi possível copiar o gameplan.');
    }
  };

  const handleSelectMap = (map) => {
    setSelectedMap(map);
    setSideFilter('Todos');
    setAgentFilter('Todos');
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ESTRATÉGIA DE EQUIPE</div>
          <h1>
            {selectedMap
              ? `Gameplans · ${selectedMap}`
              : hasSearch
                ? 'Resultados da busca'
                : 'Gameplans'}
          </h1>
          <p>
            {selectedMap
              ? `Planos de jogo salvos na pasta de ${selectedMap}.`
              : hasSearch
                ? `Exibindo planos de jogo encontrados em todos os mapas para "${search}".`
                : 'Escolha um mapa para abrir a pasta com seus planos de jogo.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasSearch && !selectedMap && (
            <button
              className="button button-quiet"
              onClick={() => setSearch('')}
            >
              <X size={15} /> Limpar busca
            </button>
          )}
          <button
            className="button button-primary"
            onClick={() => onAdd(selectedMap || '')}
          >
            <Plus size={17} /> Novo Gameplan
          </button>
        </div>
      </div>

      <div className="toolbar">
        {selectedMap && (
          <button
            className="button button-quiet button-small"
            onClick={() => handleSelectMap('')}
          >
            <ArrowRight size={14} className="back-arrow" /> Todos os mapas
          </button>
        )}
        <div className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, mapa, agente ou estratégia..."
          />
        </div>
        {isGridView && (
          <>
            <div className="filter-field">
              <select
                aria-label="Filtrar por lado"
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value)}
              >
                <option value="Todos">Todos os lados</option>
                <option value="Ataque">Ataque</option>
                <option value="Defesa">Defesa</option>
                <option value="Ambos">Ambos</option>
              </select>
              <ChevronDown size={14} />
            </div>
            <div className="filter-field">
              <select
                aria-label="Filtrar por agente na composição"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="Todos">Todos os agentes</option>
                {availableAgents.map((ag) => (
                  <option key={ag} value={ag}>
                    {ag}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </>
        )}
        <div className="toolbar-note">
          <Swords size={15} />{' '}
          {isGridView
            ? `${rows.length} ${rows.length === 1 ? 'plano encontrado' : 'planos encontrados'}`
            : `${gameplans.length} planos salvos`}
        </div>
      </div>

      {isGridView ? (
        rows.length ? (
          <div className="lineup-grid">
            {rows.map((plan) => {
              const perf = perfByGameplan.get(plan.id);
              return (
                <article className="panel gameplan-card" key={plan.id}>
                  <div className="gameplan-card-top">
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <span className="gameplan-icon">
                        <Swords size={20} />
                      </span>
                      <span
                        className={`side-tag ${plan.side?.toLowerCase()}`}
                        style={{ position: 'static' }}
                      >
                        {plan.side}
                      </span>
                    </div>
                    {perf &&
                      (perf.decisions > 0 ? (
                        <span
                          className={`gameplan-perf-badge ${perf.winrate >= 60 ? 'win' : perf.winrate <= 40 ? 'loss' : 'neutral'}`}
                          title={`${perf.wins} Vitórias · ${perf.losses} Derrotas`}
                        >
                          {perf.winrate >= 60 ? '⭐ ' : ''}
                          {Math.round(perf.winrate)}% WR ({perf.wins}V-
                          {perf.losses}D)
                        </span>
                      ) : perf.matches > 0 ? (
                        <span className="gameplan-perf-badge neutral">
                          {perf.matches} VOD(s)
                        </span>
                      ) : (
                        <span className="gameplan-perf-badge neutral">
                          Sem VODs
                        </span>
                      ))}
                  </div>
                  <div className="gameplan-card-body">
                    <div className="lineup-kicker">{plan.map}</div>
                    <h3>{plan.name}</h3>
                    {plan.agents?.length > 0 && (
                      <div className="gameplan-agent-chips">
                        {plan.agents.map((agentName) => (
                          <span key={agentName} className="gameplan-agent-chip">
                            <Crosshair size={10} /> {agentName}
                          </span>
                        ))}
                      </div>
                    )}
                    {plan.description && (
                      <p className="lineup-instructions">{plan.description}</p>
                    )}
                    <div className="lineup-card-footer">
                      <span className="lineup-saved">
                        <Check size={13} /> Plano reutilizável
                      </span>
                      <div className="lineup-actions">
                        <button
                          type="button"
                          className="icon-button"
                          title="Copiar plano para Discord"
                          onClick={() => copyGameplan(plan)}
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="Editar Gameplan"
                          onClick={() => onEdit(plan)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          title="Excluir Gameplan"
                          onClick={() => onDelete(plan.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Swords}
            title={
              selectedMap ? 'Pasta sem Gameplans' : 'Nenhum Gameplan encontrado'
            }
            text={
              hasSearch || sideFilter !== 'Todos' || agentFilter !== 'Todos'
                ? 'Tente ajustar os filtros ou o termo de busca.'
                : 'Cadastre o primeiro plano de jogo para este mapa.'
            }
            actionLabel="Criar Gameplan"
            onAction={() => onAdd(selectedMap || '')}
          />
        )
      ) : (
        <div className="tactic-map-grid">
          {maps.map((map) => (
            <button
              className="panel tactic-map-folder"
              key={map}
              onClick={() => handleSelectMap(map)}
            >
              <span className="tactic-folder-icon">
                <FolderOpen size={22} />
              </span>
              <strong>{map}</strong>
              <span>
                {countForMap(map)}{' '}
                {countForMap(map) === 1 ? 'Gameplan' : 'Gameplans'}
              </span>
              <ArrowRight size={15} className="folder-arrow" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TacticsPage({
  tactics,
  maps,
  onAdd,
  onEdit,
  onDelete,
  onOpen,
  onExportDefaults,
  onImportDefaults,
  onToast,
}) {
  const [selectedMap, setSelectedMap] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todas');
  const [sideFilter, setSideFilter] = useState('Todos');
  const [previewTactic, setPreviewTactic] = useState(null);
  const importRef = useRef(null);

  const hasSearch = Boolean(search && search.trim());
  const isGridView = Boolean(selectedMap || hasSearch);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tactics.filter((item) => {
      if (selectedMap && item.map !== selectedMap) return false;
      if (category !== 'Todas' && item.category !== category) return false;
      if (sideFilter !== 'Todos' && (item.side || 'Ambos') !== sideFilter)
        return false;
      if (q) {
        const matchesQuery = [
          item.title,
          item.map,
          item.category,
          item.side,
          item.description,
        ].some((val) =>
          String(val || '')
            .toLowerCase()
            .includes(q)
        );
        if (!matchesQuery) return false;
      }
      return true;
    });
  }, [tactics, selectedMap, category, sideFilter, search]);

  const countForMap = (map) =>
    tactics.filter((item) => item.map === map).length;

  const copyTactic = async (item) => {
    let text = `**TÁTICO: ${item.title}**\n`;
    text += `Mapa: **${item.map}** | Lado: **${item.side || 'Ambos'}** | Categoria: **${item.category}**\n\n`;
    text += `**Como Funciona / Execução:**\n${item.description || 'Sem descrição cadastrada.'}\n`;
    if (item.link) {
      text += `\nReferência: ${item.link}\n`;
    }
    text += `\n*Gerado pelo KRING Valorant Analyzer*`;

    const ok = await copyToClipboard(text);
    if (ok) {
      if (onToast) onToast('Tático copiado para a área de transferência!');
    } else {
      if (onToast) onToast('Não foi possível copiar o tático.');
    }
  };

  const handleSelectMap = (map) => {
    setSelectedMap(map);
    setCategory('Todas');
    setSideFilter('Todos');
  };

  return (
    <section>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onImportDefaults}
      />
      <div className="page-heading">
        <div>
          <div className="eyebrow">PLAYBOOK DE EQUIPE</div>
          <h1>
            {selectedMap
              ? `Táticos · ${selectedMap}`
              : hasSearch
                ? 'Resultados da busca'
                : 'Playbook de táticos'}
          </h1>
          <p>
            {selectedMap
              ? `Táticas salvas na pasta de ${selectedMap}.`
              : hasSearch
                ? `Exibindo táticas encontradas em todos os mapas para "${search}".`
                : 'Escolha um mapa para abrir sua pasta de táticos ou importe referências.'}
          </p>
        </div>
        <div className="tactics-header-actions">
          {hasSearch && !selectedMap && (
            <button
              className="button button-quiet button-small"
              onClick={() => setSearch('')}
            >
              <X size={14} /> Limpar busca
            </button>
          )}
          <button
            className="button button-secondary button-small"
            onClick={onExportDefaults}
            title="Exportar cópia dos táticos Default em arquivo JSON"
          >
            <ArrowDownToLine size={14} /> Exportar Defaults
          </button>
          <button
            className="button button-secondary button-small"
            onClick={() => importRef.current?.click()}
            title="Importar táticos Default de um arquivo JSON"
          >
            <ArrowUpFromLine size={14} /> Importar Defaults
          </button>
          <button
            className="button button-primary"
            onClick={() => onAdd(selectedMap || '')}
          >
            <Plus size={17} /> Novo tático
          </button>
        </div>
      </div>

      <div className="toolbar">
        {selectedMap && (
          <button
            className="button button-quiet button-small"
            onClick={() => handleSelectMap('')}
          >
            <ArrowRight size={14} className="back-arrow" /> Todos os mapas
          </button>
        )}
        <div className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, mapa, categoria ou instrução..."
          />
        </div>
        {isGridView && (
          <>
            <div className="filter-field">
              <select
                aria-label="Filtrar por categoria"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="Todas">Todas as categorias</option>
                {TACTIC_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <div className="filter-field">
              <select
                aria-label="Filtrar por lado"
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value)}
              >
                <option value="Todos">Todos os lados</option>
                {SIDES.map((side) => (
                  <option key={side} value={side}>
                    {side}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </>
        )}
        <div className="toolbar-note">
          <BookOpen size={15} />{' '}
          {isGridView
            ? `${rows.length} ${rows.length === 1 ? 'tática encontrada' : 'táticas encontradas'}`
            : `${tactics.length} táticas salvas`}
        </div>
      </div>

      {isGridView ? (
        rows.length ? (
          <div className="tactic-grid">
            {rows.map((item) => (
              <article className="panel tactic-card" key={item.id}>
                <div
                  className={`tactic-image ${item.imageData ? 'has-image is-clickable' : ''}`}
                  onClick={
                    item.imageData ? () => setPreviewTactic(item) : undefined
                  }
                  title={
                    item.imageData
                      ? 'Clique para ampliar a imagem em tela cheia'
                      : undefined
                  }
                >
                  {item.imageData ? (
                    <>
                      <img
                        src={item.imageData}
                        alt={`Print de ${item.title}`}
                      />
                      <span className="lineup-zoom-hint">
                        <Maximize2 size={12} /> Ampliar
                      </span>
                    </>
                  ) : (
                    <BookOpen size={25} />
                  )}
                  <span
                    className={`side-tag ${(item.side || 'Ambos').toLowerCase()}`}
                  >
                    {item.side || 'Ambos'}
                  </span>
                </div>
                <div className="tactic-card-body">
                  <div className="lineup-kicker">{item.map}</div>
                  <div
                    className="vod-card-title-row"
                    style={{ alignItems: 'flex-start' }}
                  >
                    <h3 style={{ margin: 0, fontSize: 14 }}>{item.title}</h3>
                    <span className="agent-pill">{item.category}</span>
                  </div>
                  {item.description && (
                    <p className="vod-notes" style={{ margin: '4px 0 0' }}>
                      {item.description}
                    </p>
                  )}
                  <div
                    className="vod-card-actions"
                    style={{ marginTop: 'auto', paddingTop: 8 }}
                  >
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      onClick={() => copyTactic(item)}
                      title="Copiar tático para Discord"
                    >
                      <Copy size={14} /> Copiar
                    </button>
                    {item.link && (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => onOpen(item.link)}
                      >
                        <ExternalLink size={14} /> Referência
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      onClick={() => onEdit(item)}
                    >
                      <Pencil size={14} /> Editar
                    </button>
                    <button
                      type="button"
                      className="button button-danger-quiet button-small"
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 size={14} /> Excluir
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={BookOpen}
            title={
              selectedMap ? 'Pasta sem táticos' : 'Nenhum tático encontrado'
            }
            text={
              hasSearch || category !== 'Todas' || sideFilter !== 'Todos'
                ? 'Tente ajustar os filtros ou o termo de busca.'
                : 'Adicione o primeiro tático deste mapa. Você pode incluir descrição, print e link de referência.'
            }
            actionLabel="Adicionar tático"
            onAction={() => onAdd(selectedMap || '')}
          />
        )
      ) : (
        <div className="tactic-map-grid">
          {maps.map((map) => (
            <button
              className="panel tactic-map-folder"
              key={map}
              onClick={() => handleSelectMap(map)}
            >
              <span className="tactic-folder-icon">
                <FolderOpen size={22} />
              </span>
              <strong>{map}</strong>
              <span>
                {countForMap(map)}{' '}
                {countForMap(map) === 1 ? 'tático' : 'táticos'}
              </span>
              <ArrowRight size={15} className="folder-arrow" />
            </button>
          ))}
        </div>
      )}

      {previewTactic && (
        <LightboxModal
          onClose={() => setPreviewTactic(null)}
          imageSrc={previewTactic.imageData}
          imageAlt={`Visualização de ${previewTactic.title}`}
          headerTitle={
            <>
              <div className="lineup-kicker">
                {previewTactic.map} <span>•</span> {previewTactic.category}
              </div>
              <h2>{previewTactic.title}</h2>
            </>
          }
          headerBadge={
            <span
              className={`side-tag ${(previewTactic.side || 'Ambos').toLowerCase()}`}
              style={{ position: 'static' }}
            >
              {previewTactic.side || 'Ambos'}
            </span>
          }
          sidebar={
            <>
              <div className="lineup-instructions-box">
                <div className="instructions-header">
                  <strong>Instruções e Execução</strong>
                  <button
                    type="button"
                    className="button button-quiet button-micro"
                    onClick={() => copyTactic(previewTactic)}
                    title="Copiar texto do tático"
                  >
                    <Copy size={12} /> Copiar
                  </button>
                </div>
                <p>
                  {previewTactic.description ||
                    'Nenhuma instrução por escrito cadastrada para este tático.'}
                </p>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 'auto',
                }}
              >
                {previewTactic.link && (
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => onOpen(previewTactic.link)}
                  >
                    <ExternalLink size={14} /> Abrir link de referência
                  </button>
                )}
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() => {
                    const item = previewTactic;
                    setPreviewTactic(null);
                    onEdit(item);
                  }}
                >
                  <Pencil size={14} /> Editar dados do tático
                </button>
              </div>
            </>
          }
        />
      )}
    </section>
  );
}

function Dashboard({
  data,
  overall,
  mapsStats,
  onAddVod,
  onAddLineup,
  onGo,
  onOpenVOD,
  onReview,
}) {
  const recent = data.vods
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 5);
  const bestMap = getBestMap(mapsStats);
  return (
    <section>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">
            PLAYER DASHBOARD <span className="live-pip" />
          </div>
          <h1>Seu centro de performance.</h1>
          <p>
            VODs organizados, lineups prontas e dados para evoluir com intenção.
          </p>
        </div>
        <div className="welcome-date">
          <span>WORKSPACE PESSOAL</span>
          <strong>
            {new Date().toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </strong>
        </div>
      </div>
      <div className="stats-cards">
        <MetricCard
          icon={FileVideo2}
          label="VODs registradas"
          value={overall.matches}
          detail={`${overall.wins} vitórias · ${overall.losses} derrotas`}
          accent="blue"
        />
        <MetricCard
          icon={Trophy}
          label="Winrate geral"
          value={percent(overall.winrate)}
          detail={`${overall.decisions} partidas com decisão`}
          accent="green"
        />
        <MetricCard
          icon={Swords}
          label="Abates registrados"
          value={overall.kills}
          detail={`Média de ${overall.avgKills.toFixed(1).replace('.', ',')} por VOD`}
          accent="purple"
        />
        <MetricCard
          icon={Target}
          label="Lineups salvas"
          value={data.lineups.length}
          detail="No seu playbook pessoal"
          accent="orange"
        />
        <MetricCard
          icon={Activity}
          label="Média de K/D por VOD"
          value={
            overall.kdMatches
              ? `${overall.avgKD.toFixed(2).replace('.', ',')}x`
              : '—'
          }
          detail={`${overall.kdMatches} VODs com mortes registradas`}
          accent="blue"
        />
      </div>
      <div className="dashboard-grid">
        <div className="panel performance-panel">
          <div className="panel-heading">
            <div>
              <h2>Winrate por mapa</h2>
              <p>Visão rápida dos mapas que você registrou</p>
            </div>
            <button className="text-link" onClick={() => onGo('stats')}>
              Ver análise <ExternalLink size={13} />
            </button>
          </div>
          {mapsStats.length ? (
            <div className="map-performance-list">
              {mapsStats.slice(0, 6).map((stat) => (
                <div className="map-performance" key={stat.name}>
                  <div className="map-letter">
                    {stat.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="map-performance-content">
                    <div className="bar-label-row">
                      <strong>{stat.name}</strong>
                      <span>
                        {stat.wins}V – {stat.losses}D
                        {stat.draws ? ` – ${stat.draws}E` : ''}
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${stat.winrate}%` }}
                      />
                    </div>
                  </div>
                  <div
                    className={`map-percent ${stat.decisions && stat.winrate >= 50 ? 'good' : ''}`}
                  >
                    {percent(stat.winrate)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-empty">
              <MapIcon size={22} />
              <span>Adicione VODs para gerar seu gráfico por mapa.</span>
            </div>
          )}
        </div>
        <div className="panel quick-panel">
          <div className="panel-heading">
            <div>
              <h2>Acesso rápido</h2>
              <p>Continue seu trabalho de preparação</p>
            </div>
            <Zap size={17} className="muted-icon" />
          </div>
          <button className="quick-action" onClick={onAddVod}>
            <div className="quick-icon blue-bg">
              <Plus size={18} />
            </div>
            <div>
              <strong>Registrar partida</strong>
              <span>Adicionar VOD, mapa, agente e resultado</span>
            </div>
            <span className="quick-arrow">↗</span>
          </button>
          <button className="quick-action" onClick={onAddLineup}>
            <div className="quick-icon purple-bg">
              <Target size={18} />
            </div>
            <div>
              <strong>Salvar lineup</strong>
              <span>Adicionar imagem, execução e referência</span>
            </div>
            <span className="quick-arrow">↗</span>
          </button>
          <button className="quick-action" onClick={() => onGo('stats')}>
            <div className="quick-icon green-bg">
              <BarChart3 size={18} />
            </div>
            <div>
              <strong>Revisar estatísticas</strong>
              <span>Comparar mapas e agentes</span>
            </div>
            <span className="quick-arrow">↗</span>
          </button>
          {bestMap && (
            <div className="best-map-note">
              <div className="best-map-icon">
                <Activity size={17} />
              </div>
              <div>
                <span>Seu melhor winrate registrado</span>
                <strong>
                  {bestMap.name} <em>{percent(bestMap.winrate)}</em>
                </strong>
                <small>Base: {bestMap.decisions} partidas com decisão</small>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>Partidas recentes</h2>
            <p>Últimos registros da sua biblioteca</p>
          </div>
          <button className="text-link" onClick={() => onGo('vods')}>
            Ver biblioteca <ExternalLink size={13} />
          </button>
        </div>
        {recent.length ? (
          <div className="recent-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PARTIDA</th>
                  <th>MAPA</th>
                  <th>AGENTE</th>
                  <th>ABATES</th>
                  <th>RESULTADO</th>
                  <th>DATA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.map((vod) => (
                  <tr key={vod.id}>
                    <td>
                      <div className="match-title-cell">
                        <span className="mini-vod-icon">
                          <Video size={14} />
                        </span>
                        <strong>{vod.title}</strong>
                      </div>
                    </td>
                    <td>{vod.map}</td>
                    <td>
                      <span className="agent-pill">{vod.agent}</span>
                    </td>
                    <td className="numeric-cell">{Number(vod.kills) || 0}</td>
                    <td>
                      <ResultBadge result={vod.result} />
                    </td>
                    <td className="date-cell">{formatDate(vod.date)}</td>
                    <td>
                      <button
                        className="icon-button"
                        title={
                          vod.localVideoPath || vod.analysisData
                            ? 'Review Interativa do Treino'
                            : 'Abrir VOD'
                        }
                        onClick={() =>
                          vod.localVideoPath || vod.analysisData
                            ? onReview(vod)
                            : onOpenVOD(vod.link)
                        }
                        disabled={
                          !vod.link && !vod.localVideoPath && !vod.analysisData
                        }
                      >
                        {vod.localVideoPath || vod.analysisData ? (
                          <Play size={14} style={{ color: '#54d6a2' }} />
                        ) : (
                          <ExternalLink size={15} />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-empty">
            <FileVideo2 size={20} />
            <span>Nenhuma partida registrada ainda.</span>
            <button className="text-link" onClick={onAddVod}>
              Adicionar primeira VOD <Plus size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="dashboard-bottom-note">
        <CircleHelp size={15} />
        <span>
          O winrate é calculado como vitórias ÷ (vitórias + derrotas). Empates
          ficam fora desse cálculo.
        </span>
      </div>
    </section>
  );
}

function VodCard({
  vod,
  gameplan,
  onEdit,
  onDelete,
  onOpen,
  onReview,
  onCopyDiscord,
  onExportMatch,
}) {
  const duels = Array.isArray(vod.openingDuels) ? vod.openingDuels : [];
  return (
    <article className="vod-card">
      <div className="vod-card-symbol">
        <FileVideo2 size={22} />
      </div>
      <div className="vod-card-main">
        <div className="vod-card-title-row">
          <h3>{vod.title}</h3>
          <div className="vod-card-badges">
            {vod.matchType && (
              <span className="vod-type-pill">{vod.matchType}</span>
            )}
            {vod.opponent && (
              <span className="vod-opponent-pill">vs {vod.opponent}</span>
            )}
            <ResultBadge result={vod.result} />
          </div>
        </div>
        <div className="vod-meta-row">
          <span>
            <MapIcon size={14} /> {vod.map}
          </span>
          <span>
            <Crosshair size={14} /> {vod.agent}
          </span>
          <span>
            <Swords size={14} /> {Number(vod.kills) || 0} abates
          </span>
          <span>{Number(vod.deaths) || 0} mortes</span>
          <span>{Number(vod.assists) || 0} assistências</span>
          {vod.roundsWon != null && vod.roundsLost != null && (
            <span>
              <Trophy size={14} /> {vod.roundsWon} × {vod.roundsLost}
            </span>
          )}
          <span>
            <BookOpen size={14} /> {formatDate(vod.date)}
          </span>
        </div>
        {duels.length > 0 && (
          <div className="opening-duel-summary">
            <strong>Eventos de abertura · {duels.length}</strong>
            <div>
              {duels.map((item, i) => (
                <span key={i}>
                  <b>{item.event}</b> · R{item.round || '?'}
                  {item.time ? ` · ${item.time}` : ''}
                  {item.player ? ` · ${item.player}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
        {gameplan && (
          <p className="vod-notes">
            <strong>Gameplan:</strong> {gameplan.name} · {gameplan.side}
          </p>
        )}
        {vod.gamePlan && (
          <p className="vod-notes">
            <strong>Notas de estratégia:</strong> {vod.gamePlan}
          </p>
        )}
        {vod.notes && <p className="vod-notes">{vod.notes}</p>}
        <div className="vod-card-actions">
          {(vod.localVideoPath || vod.analysisData) && (
            <button
              className="button button-primary button-small"
              onClick={onReview}
            >
              <Play size={14} /> Review do Treino
            </button>
          )}
          {onExportMatch && (
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={() => onExportMatch(vod)}
              title="Exportar arquivo da partida (.json) para compartilhar com a equipe"
            >
              <ArrowUpFromLine size={14} /> Exportar
            </button>
          )}
          {vod.analysisData && onCopyDiscord && (
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={() => onCopyDiscord(vod)}
              title="Copiar resumo formatado para colar no Discord"
            >
              <ClipboardPaste size={14} /> Discord
            </button>
          )}
          {vod.link && (
            <button
              className="button button-secondary button-small"
              onClick={onOpen}
            >
              <ExternalLink size={14} /> Abrir VOD
            </button>
          )}
          <button className="button button-quiet button-small" onClick={onEdit}>
            <Pencil size={14} /> Editar
          </button>
          <button
            className="button button-danger-quiet button-small"
            onClick={onDelete}
          >
            <Trash2 size={14} /> Excluir
          </button>
        </div>
      </div>
    </article>
  );
}

function LineupCard({ lineup, onEdit, onDelete, onOpen, onPreview, onCopy }) {
  return (
    <article className="lineup-card">
      <div
        className={`lineup-image ${lineup.imageData ? 'has-image is-clickable' : ''}`}
        onClick={lineup.imageData ? onPreview : undefined}
        title={
          lineup.imageData
            ? 'Clique para ampliar a imagem em tela cheia'
            : undefined
        }
      >
        {lineup.imageData ? (
          <>
            <img src={lineup.imageData} alt={`Imagem de ${lineup.title}`} />
            <span className="lineup-zoom-hint">
              <Maximize2 size={12} /> Ampliar
            </span>
          </>
        ) : (
          <div className="lineup-placeholder">
            <Target size={28} />
            <span>{lineup.map}</span>
          </div>
        )}
        <span className={`side-tag ${lineup.side?.toLowerCase()}`}>
          {lineup.side || 'Ataque'}
        </span>
      </div>
      <div className="lineup-card-body">
        <div className="lineup-kicker">
          {lineup.map} <span>•</span> {lineup.agent}
        </div>
        <h3>{lineup.title}</h3>
        {lineup.ability && (
          <div className="ability-label">
            <Zap size={13} /> {lineup.ability}
          </div>
        )}
        {lineup.instructions && (
          <p className="lineup-instructions">{lineup.instructions}</p>
        )}
        <div className="lineup-card-footer">
          <span className="lineup-saved">
            <Check size={13} /> Salva no playbook
          </span>
          <div className="lineup-actions">
            {lineup.instructions && (
              <button
                type="button"
                className="icon-button"
                title="Copiar instruções"
                onClick={onCopy}
              >
                <Copy size={15} />
              </button>
            )}
            {lineup.link && (
              <button
                type="button"
                className="icon-button"
                title="Abrir referência"
                onClick={onOpen}
              >
                <ExternalLink size={15} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              title="Editar lineup"
              onClick={onEdit}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="icon-button danger"
              title="Excluir lineup"
              onClick={onDelete}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default App;
