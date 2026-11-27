import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpFromLine,
  BarChart3,
  Bookmark,
  Check,
  ClipboardPaste,
  Clock,
  Copy,
  Crosshair,
  FileVideo2,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { REVIEW_NOTE_TAGS } from '../../constants/game.js';
import { formatDiscordReport } from '../../domain/discord.js';
import {
  isGenericKillName,
  normalizeReviewNotes,
} from '../../domain/matches.js';
import { inferRoundSide, normalizeSide } from '../../domain/stats.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import { formatSeconds, parseTimeToSeconds } from '../../utils/formatters.js';
import { levenshtein, uid } from '../../utils/string.js';

export function InteractiveVodReviewModal({
  vod,
  onClose,
  onToast,
  onExportMatch,
  onUpdateStartingSide,
  onUpdateReviewNotes,
  onUpdateKill,
  onAddKill,
  onDeleteKill,
}) {
  const videoRef = useRef(null);
  const seekTimeoutRef = useRef(null);
  const noteInputRef = useRef(null);
  const [selectedRound, setSelectedRound] = useState(0); // 0 = all
  const [activeTab, setActiveTab] = useState('timeline'); // 'timeline' | 'notes' | 'scoreboard'
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [activeKill, setActiveKill] = useState(null);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [scoreboardTeamFilter, setScoreboardTeamFilter] = useState('all');
  const [jumpOffset, setJumpOffset] = useState(0); // 0 = tempo exato do abate, 3 = -3s de setup
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [killTypeFilter, setKillTypeFilter] = useState('all'); // 'all' | 'fk' | 'hs' | 'trade' | 'friendly' | 'enemy' | 'generic'
  const [killPlayerFilter, setKillPlayerFilter] = useState('all');
  const [editingKill, setEditingKill] = useState(null);
  const [editKillerSelect, setEditKillerSelect] = useState('');
  const [editKillerCustom, setEditKillerCustom] = useState('');
  const [editVictimSelect, setEditVictimSelect] = useState('');
  const [editVictimCustom, setEditVictimCustom] = useState('');
  const [editHeadshot, setEditHeadshot] = useState(false);
  const [addingKill, setAddingKill] = useState(false);
  const [addKillTime, setAddKillTime] = useState('00:00');
  const [addKillRound, setAddKillRound] = useState('');
  const [addKillerTeam, setAddKillerTeam] = useState('friendly');
  const [addKillerSelect, setAddKillerSelect] = useState('__custom__');
  const [addKillerCustom, setAddKillerCustom] = useState('');
  const [addVictimSelect, setAddVictimSelect] = useState('__custom__');
  const [addVictimCustom, setAddVictimCustom] = useState('');
  const [addHeadshot, setAddHeadshot] = useState(false);
  const [noteTagFilter, setNoteTagFilter] = useState('Todas');
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteTimeText, setNoteTimeText] = useState('00:00');
  const [noteRound, setNoteRound] = useState('');
  const [noteTag, setNoteTag] = useState(REVIEW_NOTE_TAGS[0]);
  const [noteText, setNoteText] = useState('');

  const videoUrl =
    window.kringAPI?.toLocalVideoUrl && vod.localVideoPath
      ? window.kringAPI.toLocalVideoUrl(vod.localVideoPath)
      : '';

  const analysis = useMemo(() => vod.analysisData || {}, [vod.analysisData]);
  const rounds = useMemo(() => analysis.rounds || [], [analysis.rounds]);
  const allKills = useMemo(() => analysis.all_kills || [], [analysis.all_kills]);
  const qualityWarnings = analysis.quality?.warnings || [];
  const reviewNotes = useMemo(
    () => normalizeReviewNotes(vod.reviewNotes),
    [vod.reviewNotes]
  );

  const filteredNotes = useMemo(() => {
    if (noteTagFilter === 'Todas') return reviewNotes;
    return reviewNotes.filter((n) => n.tag === noteTagFilter);
  }, [reviewNotes, noteTagFilter]);

  const inferRoundAtTime = useCallback(
    (sec) => {
      if (!rounds.length || !Number.isFinite(sec)) {
        return selectedRound > 0 ? selectedRound : null;
      }
      let matched = null;
      for (const r of rounds) {
        const start = r.start_time ? parseTimeToSeconds(r.start_time) : null;
        const end = r.end_time ? parseTimeToSeconds(r.end_time) : null;
        if (start != null && sec >= start) {
          if (end == null || sec <= end) {
            return r.round_number;
          }
          matched = r.round_number;
        }
      }
      return matched || (selectedRound > 0 ? selectedRound : null);
    },
    [rounds, selectedRound]
  );

  const timelinePlayers = useMemo(() => {
    const names = new Set();
    allKills.forEach((k) => {
      if (k.killer && !isGenericKillName(k.killer)) {
        names.add(k.killer);
      }
      if (k.victim && !isGenericKillName(k.victim)) {
        names.add(k.victim);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [allKills]);

  const roundKillsBase = useMemo(
    () =>
      selectedRound === 0
        ? allKills
        : rounds.find((r) => r.round_number === selectedRound)?.kills || [],
    [allKills, rounds, selectedRound]
  );

  const unresolvedKillsCount = useMemo(
    () =>
      roundKillsBase.filter(
        (k) => isGenericKillName(k.killer) || isGenericKillName(k.victim)
      ).length,
    [roundKillsBase]
  );

  const displayedKills = useMemo(() => {
    return roundKillsBase.filter((k) => {
      if (killTypeFilter === 'fk' && !k.first_kill) return false;
      if (killTypeFilter === 'hs' && !k.headshot) return false;
      if (killTypeFilter === 'trade' && !k.is_trade_kill) return false;
      if (killTypeFilter === 'friendly' && k.killer_team !== 'friendly')
        return false;
      if (killTypeFilter === 'enemy' && k.killer_team !== 'enemy')
        return false;
      if (
        killTypeFilter === 'generic' &&
        !isGenericKillName(k.killer) &&
        !isGenericKillName(k.victim)
      ) {
        return false;
      }
      if (
        killPlayerFilter !== 'all' &&
        k.killer !== killPlayerFilter &&
        k.victim !== killPlayerFilter
      ) {
        return false;
      }
      return true;
    });
  }, [roundKillsBase, killTypeFilter, killPlayerFilter]);

  const changeSpeed = (rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  const seekRelative = useCallback((delta) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(
        0,
        videoRef.current.currentTime + delta
      );
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const p = video.play();
      if (p !== undefined) p.catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const seekTo = useCallback(
    (seconds, killItem = null) => {
      if (killItem) setActiveKill(killItem);
      if (!Number.isFinite(seconds)) return;
      const targetSec = Math.max(0, seconds - jumpOffset);

      // Cancel pending seek to avoid browser demuxer overload from rapid clicks
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }

      seekTimeoutRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;

        try {
          if (typeof video.fastSeek === 'function') {
            video.fastSeek(targetSec);
          } else {
            video.currentTime = targetSec;
          }

          // Only start play if paused, to avoid Promise spamming
          if (video.paused) {
            const p = video.play();
            if (p !== undefined) {
              p.catch(() => {});
            }
          }
        } catch (err) {
          console.warn('[ReviewPlayer] Erro suave ao saltar:', err);
        }
      }, 30);
    },
    [jumpOffset]
  );

  const stepKill = useCallback(
    (direction) => {
      if (!displayedKills.length) return;
      const currentIdx = activeKill ? displayedKills.indexOf(activeKill) : -1;
      const nextIdx =
        currentIdx === -1
          ? direction > 0
            ? 0
            : displayedKills.length - 1
          : Math.max(
              0,
              Math.min(displayedKills.length - 1, currentIdx + direction)
            );
      const targetKill = displayedKills[nextIdx];
      if (!targetKill) return;
      const sec =
        targetKill.timestamp_sec ?? parseTimeToSeconds(targetKill.time);
      seekTo(sec, targetKill);
    },
    [activeKill, displayedKills, seekTo]
  );

  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, []);

  const openNewNoteAtCurrentTime = useCallback(() => {
    const videoTime = videoRef.current?.currentTime;
    const baseSec =
      Number.isFinite(videoTime) && videoTime > 0
        ? videoTime
        : (activeKill?.timestamp_sec ?? 0);
    const inferred = inferRoundAtTime(baseSec);
    setEditingNoteId(null);
    setNoteTimeText(formatSeconds(baseSec));
    setNoteRound(inferred ? String(inferred) : '');
    setNoteTag(REVIEW_NOTE_TAGS[0]);
    setNoteText('');
    setActiveTab('notes');
    setNoteFormOpen(true);
    setTimeout(() => noteInputRef.current?.focus(), 0);
  }, [activeKill, inferRoundAtTime]);

  const openEditNote = (note) => {
    setEditingNoteId(note.id);
    setNoteTimeText(note.time || formatSeconds(note.timestampSec));
    setNoteRound(note.round ? String(note.round) : '');
    setNoteTag(note.tag || REVIEW_NOTE_TAGS[0]);
    setNoteText(note.text || '');
    setActiveTab('notes');
    setNoteFormOpen(true);
    setTimeout(() => noteInputRef.current?.focus(), 0);
  };

  const handleSaveNote = (event) => {
    event?.preventDefault();
    const trimmedText = noteText.trim();
    if (!trimmedText) {
      if (onToast) onToast('Escreva uma anotação antes de salvar.');
      return;
    }
    const sec = parseTimeToSeconds(noteTimeText);
    const roundNum = Number(noteRound);
    const entry = {
      id: editingNoteId || uid(),
      timestampSec: sec,
      time: formatSeconds(sec),
      round: Number.isFinite(roundNum) && roundNum >= 1 ? Math.floor(roundNum) : null,
      tag: noteTag || 'Geral',
      text: trimmedText,
      createdAt:
        (editingNoteId &&
          reviewNotes.find((n) => n.id === editingNoteId)?.createdAt) ||
        new Date().toISOString(),
    };
    const rawList = editingNoteId
      ? reviewNotes.map((n) => (n.id === editingNoteId ? entry : n))
      : [...reviewNotes, entry];
    const nextNotes = normalizeReviewNotes(rawList);
    if (onUpdateReviewNotes) {
      onUpdateReviewNotes(vod.id, nextNotes);
    }
    setNoteFormOpen(false);
    setEditingNoteId(null);
    setNoteText('');
    if (onToast) {
      onToast(editingNoteId ? 'Marcação atualizada!' : 'Marcação salva!');
    }
  };

  const handleDeleteNote = (noteId) => {
    const nextNotes = reviewNotes.filter((n) => n.id !== noteId);
    if (onUpdateReviewNotes) {
      onUpdateReviewNotes(vod.id, nextNotes);
    }
    if (activeNoteId === noteId) setActiveNoteId(null);
    if (editingNoteId === noteId) {
      setNoteFormOpen(false);
      setEditingNoteId(null);
      setNoteText('');
    }
    if (onToast) onToast('Marcação removida.');
  };

  const copyNotesToClipboard = async () => {
    if (!reviewNotes.length) return;
    const header = `**MARCAÇÕES DO REVIEW — ${vod.title || vod.map || 'Valorant'}** (${reviewNotes.length})`;
    const lines = reviewNotes.map((n) => {
      const rPart = n.round ? ` (R${String(n.round).padStart(2, '0')})` : '';
      return `• \`${n.time}\`${rPart} **[${n.tag}]** — ${n.text}`;
    });
    const ok = await copyToClipboard(`${header}\n${lines.join('\n')}`);
    if (onToast) {
      onToast(
        ok
          ? 'Anotações copiadas para a área de transferência!'
          : 'Não foi possível copiar as anotações.'
      );
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (editingKill) {
          event.preventDefault();
          setEditingKill(null);
          return;
        }
        if (addingKill) {
          event.preventDefault();
          setAddingKill(false);
          return;
        }
        if (noteFormOpen) {
          event.preventDefault();
          setNoteFormOpen(false);
          return;
        }
        const escTargetTag = event.target?.tagName || '';
        if (
          escTargetTag === 'INPUT' ||
          escTargetTag === 'TEXTAREA' ||
          escTargetTag === 'SELECT' ||
          event.target?.isContentEditable
        ) {
          return;
        }
        onClose();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      const tagName = target?.tagName || '';
      if (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.code === 'Space' && tagName !== 'BUTTON') || key === 'k') {
        event.preventDefault();
        togglePlayPause();
      } else if (event.key === 'ArrowLeft' || key === 'j') {
        event.preventDefault();
        seekRelative(-5);
      } else if (event.key === 'ArrowRight' || key === 'l') {
        event.preventDefault();
        seekRelative(5);
      } else if (event.key === '[') {
        event.preventDefault();
        stepKill(-1);
      } else if (event.key === ']') {
        event.preventDefault();
        stepKill(1);
      } else if (key === 'm') {
        event.preventDefault();
        toggleMute();
      } else if (key === 'b') {
        event.preventDefault();
        openNewNoteAtCurrentTime();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    addingKill,
    editingKill,
    noteFormOpen,
    onClose,
    openNewNoteAtCurrentTime,
    seekRelative,
    stepKill,
    toggleMute,
    togglePlayPause,
  ]);

  const copyDiscord = async () => {
    const text = formatDiscordReport(vod);
    const ok = await copyToClipboard(text);
    if (ok) {
      if (onToast)
        onToast(
          'Relatório copiado para a área de transferência! Cole no Discord.'
        );
    } else {
      if (onToast) onToast('Não foi possível copiar o relatório.');
    }
  };

  // Clean, normalize and cluster OCR player stats into real match participants
  const cleanedPlayers = useMemo(() => {
    const raw = vod.analysisData?.players_stats;
    if (!raw || typeof raw !== 'object') return [];

    const WEAPONS_AND_IGNORE = new Set([
      'aliado',
      'inimigo',
      'agente',
      'fense',
      'defense',
      'attack',
      'round',
      'match',
      'high',
      'medium',
      'low',
      'sec',
      'vandal',
      'phantom',
      'sheriff',
      'ghost',
      'classic',
      'spectre',
      'operator',
      'guardian',
      'ares',
      'odin',
      'stinger',
      'bucky',
      'judge',
      'marshal',
      'outlaw',
      'frenzy',
      'shorty',
      'sidearm',
      'sheriffisidearm',
    ]);

    const candidates = [];
    for (const [name, s] of Object.entries(raw)) {
      if (!name || name.length < 2) continue;
      if (
        /^\d+$/.test(name) ||
        /^\d+\/\d+$/.test(name) ||
        /^\d+\.\d+$/.test(name)
      )
        continue;
      const cleanLower = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!cleanLower || cleanLower.length < 2) continue;
      if (WEAPONS_AND_IGNORE.has(cleanLower)) continue;
      if (cleanLower.startsWith('jogador')) continue;

      candidates.push({
        canonical: name.trim(),
        cleanKey: cleanLower,
        agent: s.agent && s.agent !== 'Agente' ? s.agent : '',
        team: s.team || 'friendly',
        kills: s.kills || 0,
        deaths: s.deaths || 0,
        assists: s.assists || 0,
        scoreboard_verified: !!s.scoreboard_verified,
        headshots: s.headshots || 0,
        first_kills: s.first_kills || 0,
        first_deaths: s.first_deaths || 0,
        trade_kills: s.trade_kills || 0,
        traded_deaths: s.traded_deaths || 0,
        clutches_won: s.clutches_won || 0,
        kast_pct: s.kast_pct,
      });
    }

    // Sort by kills descending
    candidates.sort((a, b) => b.kills - a.kills);

    const clusters = [];
    for (const cand of candidates) {
      let matched = null;
      for (const cl of clusters) {
        if (cl.cleanKey === cand.cleanKey) {
          matched = cl;
          break;
        }
        const dist = levenshtein(cl.cleanKey, cand.cleanKey);
        const minLen = Math.min(cl.cleanKey.length, cand.cleanKey.length);
        if (dist <= 1 || (dist <= 2 && minLen >= 6)) {
          matched = cl;
          break;
        }
      }

      if (matched) {
        matched.kills += cand.kills;
        matched.deaths += cand.deaths;
        matched.assists = (matched.assists || 0) + (cand.assists || 0);
        if (cand.scoreboard_verified) matched.scoreboard_verified = true;
        matched.headshots += cand.headshots;
        matched.first_kills += cand.first_kills;
        matched.first_deaths += cand.first_deaths;
        if (cand.trade_kills) matched.trade_kills = (matched.trade_kills || 0) + cand.trade_kills;
        if (cand.traded_deaths) matched.traded_deaths = (matched.traded_deaths || 0) + cand.traded_deaths;
        if (cand.clutches_won) matched.clutches_won = (matched.clutches_won || 0) + cand.clutches_won;
        if (cand.kast_pct !== undefined && matched.kast_pct === undefined) matched.kast_pct = cand.kast_pct;
        if (!matched.agent && cand.agent) matched.agent = cand.agent;
      } else {
        clusters.push({ ...cand });
      }
    }

    return clusters
      .filter((p) => p.kills + p.deaths >= 2)
      .map((p) => ({
        name: p.canonical,
        agent: p.agent || 'Agente',
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists || 0,
        scoreboard_verified: p.scoreboard_verified,
        trade_kills: p.trade_kills || 0,
        traded_deaths: p.traded_deaths || 0,
        clutches_won: p.clutches_won || 0,
        kast_pct: p.kast_pct,
        kd_ratio:
          p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2),
        headshot_rate:
          p.kills > 0 ? ((p.headshots / p.kills) * 100).toFixed(1) : '0.0',
        first_kills: p.first_kills,
        first_deaths: p.first_deaths,
      }))
      .sort((a, b) => b.kills - a.kills);
  }, [vod.analysisData?.players_stats]);

  const filteredPlayers = useMemo(() => {
    if (scoreboardTeamFilter === 'friendly')
      return cleanedPlayers.filter((p) => p.team === 'friendly');
    if (scoreboardTeamFilter === 'enemy')
      return cleanedPlayers.filter((p) => p.team === 'enemy');
    return cleanedPlayers;
  }, [cleanedPlayers, scoreboardTeamFilter]);

  const hasTacticalStats = useMemo(
    () => cleanedPlayers.some((p) => p.kast_pct !== undefined),
    [cleanedPlayers]
  );

  const teamCandidates = useMemo(() => {
    const friendlySet = new Set();
    const enemySet = new Set();
    cleanedPlayers.forEach((p) => {
      if (!p.name || isGenericKillName(p.name)) return;
      if (p.team === 'enemy') enemySet.add(p.name);
      else friendlySet.add(p.name);
    });
    allKills.forEach((k) => {
      if (k.killer && !isGenericKillName(k.killer)) {
        if (k.killer_team === 'enemy') enemySet.add(k.killer);
        else friendlySet.add(k.killer);
      }
      if (k.victim && !isGenericKillName(k.victim)) {
        if (k.victim_team === 'enemy') enemySet.add(k.victim);
        else friendlySet.add(k.victim);
      }
    });
    return {
      friendly: Array.from(friendlySet).sort((a, b) => a.localeCompare(b)),
      enemy: Array.from(enemySet).sort((a, b) => a.localeCompare(b)),
    };
  }, [cleanedPlayers, allKills]);

  const getKillCandidates = (team, currentName) => {
    const base = team === 'enemy' ? teamCandidates.enemy : teamCandidates.friendly;
    if (
      currentName &&
      !isGenericKillName(currentName) &&
      !base.includes(currentName)
    ) {
      return [currentName, ...base];
    }
    return base;
  };

  const openKillEditor = (k) => {
    if (editingKill === k) {
      setEditingKill(null);
      return;
    }
    const killerList = getKillCandidates(k.killer_team, k.killer);
    const victimList = getKillCandidates(k.victim_team, k.victim);
    setEditingKill(k);
    if (k.killer && !isGenericKillName(k.killer) && killerList.includes(k.killer)) {
      setEditKillerSelect(k.killer);
      setEditKillerCustom('');
    } else if (isGenericKillName(k.killer) && killerList.length > 0) {
      setEditKillerSelect(killerList[0]);
      setEditKillerCustom('');
    } else {
      setEditKillerSelect('__custom__');
      setEditKillerCustom(k.killer || '');
    }
    if (k.victim && !isGenericKillName(k.victim) && victimList.includes(k.victim)) {
      setEditVictimSelect(k.victim);
      setEditVictimCustom('');
    } else if (isGenericKillName(k.victim) && victimList.length > 0) {
      setEditVictimSelect(victimList[0]);
      setEditVictimCustom('');
    } else {
      setEditVictimSelect('__custom__');
      setEditVictimCustom(k.victim || '');
    }
    setEditHeadshot(Boolean(k.headshot));
  };

  const handleSaveKillEdit = (e, k) => {
    e.preventDefault();
    e.stopPropagation();
    const resolvedKiller = (
      editKillerSelect === '__custom__' ? editKillerCustom : editKillerSelect
    ).trim();
    const resolvedVictim = (
      editVictimSelect === '__custom__' ? editVictimCustom : editVictimSelect
    ).trim();
    if (!resolvedKiller || !resolvedVictim) {
      if (onToast) onToast('Informe autor e vítima do abate antes de salvar.');
      return;
    }
    if (onUpdateKill) {
      onUpdateKill(vod.id, k, {
        killer: resolvedKiller,
        victim: resolvedVictim,
        headshot: editHeadshot,
      });
    }
    setEditingKill(null);
  };

  const openAddKillForm = () => {
    if (addingKill) {
      setAddingKill(false);
      return;
    }
    const videoTime = videoRef.current?.currentTime;
    const baseSec =
      Number.isFinite(videoTime) && videoTime > 0
        ? videoTime
        : (activeKill?.timestamp_sec ?? 0);
    const inferred = inferRoundAtTime(baseSec);
    setEditingKill(null);
    setAddKillTime(formatSeconds(baseSec));
    setAddKillRound(inferred ? String(inferred) : '1');
    setAddKillerTeam('friendly');
    const friendlyOpts = getKillCandidates('friendly', '');
    const enemyOpts = getKillCandidates('enemy', '');
    setAddKillerSelect(friendlyOpts[0] || '__custom__');
    setAddKillerCustom('');
    setAddVictimSelect(enemyOpts[0] || '__custom__');
    setAddVictimCustom('');
    setAddHeadshot(false);
    setAddingKill(true);
  };

  const handleSaveNewKill = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const resolvedKiller = (
      addKillerSelect === '__custom__' ? addKillerCustom : addKillerSelect
    ).trim();
    const resolvedVictim = (
      addVictimSelect === '__custom__' ? addVictimCustom : addVictimSelect
    ).trim();
    if (!resolvedKiller || !resolvedVictim) {
      if (onToast) onToast('Informe autor e vítima do abate antes de adicionar.');
      return;
    }
    const sec = parseTimeToSeconds(addKillTime);
    const roundNum = Number(addKillRound);
    const victimTeam = addKillerTeam === 'friendly' ? 'enemy' : 'friendly';
    if (onAddKill) {
      onAddKill(vod.id, {
        round:
          Number.isFinite(roundNum) && roundNum >= 1
            ? Math.floor(roundNum)
            : null,
        timestamp_sec: sec,
        time: formatSeconds(sec),
        killer: resolvedKiller,
        killer_team: addKillerTeam,
        victim: resolvedVictim,
        victim_team: victimTeam,
        headshot: addHeadshot,
      });
    }
    setAddingKill(false);
  };

  return (
    <div className="modal-backdrop">
      <div
        className={`review-modal-card ${isMaximized ? 'maximized' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <header className="review-modal-header">
          <h2>
            <Play size={20} className="badge-team-friendly" />
            <span>
              Review do Treino: <strong>{vod.title}</strong>
            </span>
            <span className="agent-pill">{vod.map || 'Valorant'}</span>
            <span
              className={`result-badge ${vod.result === 'Vitória' ? 'win' : vod.result === 'Derrota' ? 'loss' : 'draw'}`}
            >
              {vod.result} ({vod.roundsWon ?? '—'} × {vod.roundsLost ?? '—'})
            </span>
            {analysis.ocr_provider && (
              <span
                className="ocr-provider-pill"
                title={`Motor OCR executado via ${analysis.ocr_provider}`}
              >
                {analysis.ocr_provider === 'DirectML' ? 'GPU DirectML' : 'CPU'}
              </span>
            )}
            {onUpdateStartingSide && (
              <div
                className="side-toggle-group"
                title="Definir lado inicial para calcular estatísticas de Ataque vs Defesa"
              >
                <span className="speed-label">Início:</span>
                {['Ataque', 'Defesa'].map((sideOpt) => {
                  const isActive = normalizeSide(vod.startingSide) === sideOpt;
                  return (
                    <button
                      key={sideOpt}
                      type="button"
                      className={`speed-chip ${isActive ? 'active' : ''}`}
                      onClick={() =>
                        onUpdateStartingSide(vod.id, isActive ? '' : sideOpt)
                      }
                    >
                      {sideOpt === 'Ataque' ? 'ATK' : 'DEF'}
                    </button>
                  );
                })}
              </div>
            )}
          </h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {qualityWarnings.length > 0 && (
              <button
                type="button"
                className={`button button-small ${showDiagnostics ? 'button-secondary' : 'button-ghost'}`}
                onClick={() => setShowDiagnostics((prev) => !prev)}
                title="Alternar visualização dos avisos técnicos de diagnóstico"
                style={{ fontSize: '12px' }}
              >
                <AlertTriangle size={13} style={{ color: '#f59e0b' }} /> Diagnóstico ({qualityWarnings.length})
              </button>
            )}
            {onExportMatch && (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => onExportMatch(vod)}
                title="Exportar arquivo da partida (.json) para compartilhar com a equipe"
              >
                <ArrowUpFromLine size={14} /> Exportar Partida
              </button>
            )}
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={copyDiscord}
              title="Copiar relatório formatado para o Discord"
            >
              <ClipboardPaste size={14} /> Copiar p/ Discord
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
              title={
                isMaximized
                  ? 'Restaurar tamanho padrão'
                  : 'Maximizar janela (Expandir visão)'
              }
              onClick={() => setIsMaximized(!isMaximized)}
            >
              {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              className="icon-button"
              aria-label="Fechar"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {qualityWarnings.length > 0 && showDiagnostics && (
          <aside className="review-quality-banner" role="status" aria-label="Avisos de qualidade da análise">
            <div
              className="review-quality-banner-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={16} className="quality-warning-icon" />
                <strong>Avisos de Diagnóstico da Análise ({qualityWarnings.length})</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowDiagnostics(false)}
                title="Fechar avisos de diagnóstico"
                style={{ padding: '2px 6px' }}
              >
                <X size={14} />
              </button>
            </div>
            <ul
              className="review-quality-banner-list"
              style={{ maxHeight: '160px', overflowY: 'auto' }}
            >
              {qualityWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </aside>
        )}

        <div
          className={`review-modal-body ${activeTab === 'scoreboard' ? 'scoreboard-active' : ''}`}
        >
          <div className="review-player-section">
            <div className="review-video-wrap">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  autoPlay
                  playsInline
                  onError={(e) =>
                    console.warn('Falha na reprodução de vídeo:', e)
                  }
                />
              ) : (
                <div
                  style={{
                    color: '#889',
                    textAlign: 'center',
                    padding: '40px',
                  }}
                >
                  <FileVideo2
                    size={44}
                    style={{ opacity: 0.6, marginBottom: '10px' }}
                  />
                  <p>
                    Arquivo de vídeo local não encontrado no caminho original.
                    <br />
                    <small>
                      {vod.localVideoPath || 'Sem arquivo vinculado'}
                    </small>
                  </p>
                </div>
              )}
            </div>
            <div className="review-video-controls">
              <div className="video-controls-actions">
                <button
                  type="button"
                  className="speed-chip"
                  onClick={() => seekRelative(-5)}
                  title="Voltar 5 segundos"
                >
                  <RotateCcw size={12} /> -5s
                </button>
                <button
                  type="button"
                  className="speed-chip"
                  onClick={() => seekRelative(5)}
                  title="Avançar 5 segundos"
                >
                  +5s
                </button>
                <button
                  type="button"
                  className="speed-chip"
                  onClick={() => stepKill(-1)}
                  disabled={displayedKills.length === 0}
                  title="Ir para o abate anterior ([)"
                >
                  ← Abate
                </button>
                <button
                  type="button"
                  className="speed-chip"
                  onClick={() => stepKill(1)}
                  disabled={displayedKills.length === 0}
                  title="Ir para o próximo abate (])"
                >
                  Abate →
                </button>
                <button
                  type="button"
                  className={`speed-chip ${noteFormOpen ? 'active' : ''}`}
                  onClick={openNewNoteAtCurrentTime}
                  title="Marcar anotação no instante atual do vídeo (B)"
                >
                  <Bookmark size={12} /> Marcar momento
                </button>
                <div className="speed-group">
                  <span className="speed-label">Velocidade:</span>
                  {[0.5, 0.75, 1.0, 1.25, 1.5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`speed-chip ${playbackRate === s ? 'active' : ''}`}
                      onClick={() => changeSpeed(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <div
                  className="speed-group"
                  title="Modo de salto ao clicar nos abates"
                >
                  <span className="speed-label">Salto:</span>
                  <button
                    type="button"
                    className={`speed-chip ${jumpOffset === 0 ? 'active' : ''}`}
                    onClick={() => setJumpOffset(0)}
                    title="Ir exatamente no segundo do abate registrado"
                  >
                    Exato (0s)
                  </button>
                  <button
                    type="button"
                    className={`speed-chip ${jumpOffset === 3 ? 'active' : ''}`}
                    onClick={() => setJumpOffset(3)}
                    title="Pular 3 segundos antes do abate (preparação do tiro)"
                  >
                    -3s
                  </button>
                  <button
                    type="button"
                    className={`speed-chip ${jumpOffset === 5 ? 'active' : ''}`}
                    onClick={() => setJumpOffset(5)}
                    title="Pular 5 segundos antes do abate"
                  >
                    -5s
                  </button>
                </div>
              </div>
              <div className="video-controls-info">
                <span>
                  <Clock
                    size={13}
                    style={{ verticalAlign: 'middle', marginRight: '4px' }}
                  />
                  {jumpOffset === 0
                    ? 'Clique no abate para ir ao momento exato'
                    : `Salto com ${jumpOffset}s de pré-lance`}
                  {' · '}
                  <span style={{ opacity: 0.8 }}>
                    Espaço/K: Play · ←/→: ±5s · [/]: Abate · M: Mudo · B: Marcar
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="review-timeline-section">
            <div className="review-tabs">
              <button
                className={`review-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                onClick={() => setActiveTab('timeline')}
              >
                <Target
                  size={14}
                  style={{ verticalAlign: 'middle', marginRight: '4px' }}
                />{' '}
                Timeline de Abates ({displayedKills.length})
              </button>
              <button
                className={`review-tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
                onClick={() => setActiveTab('notes')}
              >
                <Bookmark
                  size={14}
                  style={{ verticalAlign: 'middle', marginRight: '4px' }}
                />{' '}
                Anotações ({reviewNotes.length})
              </button>
              <button
                className={`review-tab-btn ${activeTab === 'scoreboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('scoreboard')}
              >
                <BarChart3
                  size={14}
                  style={{ verticalAlign: 'middle', marginRight: '4px' }}
                />{' '}
                Placar do Treino ({cleanedPlayers.length} jogadores)
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
                  {rounds.map((r) => {
                    const rSide =
                      normalizeSide(r.side) ||
                      inferRoundSide(r.round_number, vod.startingSide);
                    return (
                      <button
                        key={r.round_number}
                        className={`round-chip ${r.winner === 'friendly' ? 'won' : 'lost'} ${selectedRound === r.round_number ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedRound(r.round_number);
                          if (r.start_time)
                            seekTo(parseTimeToSeconds(r.start_time));
                        }}
                      >
                        R{r.round_number}
                        {rSide ? (
                          <span
                            className={
                              rSide === 'Ataque'
                                ? 'side-pill-atk'
                                : 'side-pill-def'
                            }
                          >
                            {rSide === 'Ataque' ? 'ATK' : 'DEF'}
                          </span>
                        ) : null}{' '}
                        ({r.score_after || (r.winner === 'friendly' ? 'V' : 'D')})
                      </button>
                    );
                  })}
                </div>

                {selectedRound > 0 && (() => {
                  const curRound = rounds.find((r) => r.round_number === selectedRound);
                  if (!curRound) return null;
                  const curSide =
                    normalizeSide(curRound.side) ||
                    inferRoundSide(curRound.round_number, vod.startingSide);
                  return (
                    <div
                      className="review-round-header"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        marginBottom: '12px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        Round {curRound.round_number} ({curRound.score_after || (curRound.winner === 'friendly' ? 'Vitória' : 'Derrota')})
                        {curSide && (
                          <span
                            className={
                              curSide === 'Ataque'
                                ? 'side-pill-atk'
                                : 'side-pill-def'
                            }
                          >
                            {curSide}
                          </span>
                        )}
                      </span>
                      {curRound.clutch && (
                        <span
                          className="badge badge-clutch"
                          title={`Clutch 1v${curRound.clutch.vs_count} vencido por ${curRound.clutch.player}`}
                          style={{
                            background: 'linear-gradient(135deg, #ea580c, #dc2626)',
                            color: '#ffffff',
                            padding: '3px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '700',
                            letterSpacing: '0.04em',
                            boxShadow: '0 2px 8px rgba(234, 88, 12, 0.35)',
                          }}
                        >
                          CLUTCH {curRound.clutch.label} ({curRound.clutch.player})
                        </span>
                      )}
                    </div>
                  );
                })()}

                <div className="review-kill-filters">
                  <div className="review-kill-filter-chips">
                    {[
                      { id: 'all', label: 'Todos' },
                      { id: 'fk', label: '1st Kill' },
                      { id: 'hs', label: 'HS' },
                      { id: 'trade', label: 'Trades' },
                      { id: 'friendly', label: 'Aliados' },
                      { id: 'enemy', label: 'Inimigos' },
                      ...(unresolvedKillsCount > 0 || killTypeFilter === 'generic'
                        ? [
                            {
                              id: 'generic',
                              label: `Genéricos (${unresolvedKillsCount})`,
                            },
                          ]
                        : []),
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`round-chip ${killTypeFilter === opt.id ? 'selected' : ''}`}
                        onClick={() => setKillTypeFilter(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {timelinePlayers.length > 0 && (
                    <select
                      aria-label="Filtrar abates por jogador"
                      className="review-player-select"
                      value={killPlayerFilter}
                      onChange={(e) => setKillPlayerFilter(e.target.value)}
                    >
                      <option value="all">Todos os jogadores</option>
                      {timelinePlayers.map((playerName) => (
                        <option key={playerName} value={playerName}>
                          {playerName}
                        </option>
                      ))}
                    </select>
                  )}
                  {(killTypeFilter !== 'all' || killPlayerFilter !== 'all') && (
                    <button
                      type="button"
                      className="speed-chip"
                      onClick={() => {
                        setKillTypeFilter('all');
                        setKillPlayerFilter('all');
                      }}
                    >
                      Limpar
                    </button>
                  )}
                  {onAddKill && (
                    <button
                      type="button"
                      className={`speed-chip ${addingKill ? 'active' : ''}`}
                      onClick={openAddKillForm}
                      title="Adicionar abate perdido manualmente no instante atual do vídeo"
                    >
                      <Plus size={12} /> Abate
                    </button>
                  )}
                </div>

                {addingKill && onAddKill && (
                  <form
                    className="review-kill-add-form"
                    onSubmit={handleSaveNewKill}
                  >
                    <div className="review-kill-add-grid">
                      <div className="review-note-mini-field">
                        <span>Tempo</span>
                        <input
                          aria-label="Tempo do abate"
                          value={addKillTime}
                          onChange={(e) => setAddKillTime(e.target.value)}
                          placeholder="00:00"
                        />
                      </div>
                      <div className="review-note-mini-field">
                        <span>Round</span>
                        <input
                          type="number"
                          min="1"
                          aria-label="Round do abate"
                          value={addKillRound}
                          onChange={(e) => setAddKillRound(e.target.value)}
                          placeholder="1"
                        />
                      </div>
                      <div className="review-note-mini-field">
                        <span>Time do autor</span>
                        <select
                          aria-label="Time do autor"
                          value={addKillerTeam}
                          onChange={(e) => {
                            const nextTeam = e.target.value;
                            setAddKillerTeam(nextTeam);
                            const kOpts = getKillCandidates(nextTeam, '');
                            const vOpts = getKillCandidates(
                              nextTeam === 'friendly' ? 'enemy' : 'friendly',
                              ''
                            );
                            setAddKillerSelect(kOpts[0] || '__custom__');
                            setAddVictimSelect(vOpts[0] || '__custom__');
                          }}
                        >
                          <option value="friendly">Aliado</option>
                          <option value="enemy">Inimigo</option>
                        </select>
                      </div>
                    </div>
                    <div className="review-kill-edit-row">
                      <div className="review-note-mini-field">
                        <span>Autor do abate</span>
                        <select
                          aria-label="Autor do novo abate"
                          value={addKillerSelect}
                          onChange={(e) => setAddKillerSelect(e.target.value)}
                        >
                          {getKillCandidates(addKillerTeam, '').map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                          <option value="__custom__">Outro (digitar)...</option>
                        </select>
                        {addKillerSelect === '__custom__' && (
                          <input
                            aria-label="Nick personalizado do autor"
                            value={addKillerCustom}
                            onChange={(e) => setAddKillerCustom(e.target.value)}
                            placeholder="Nick do autor..."
                          />
                        )}
                      </div>
                      <div className="review-note-mini-field">
                        <span>Vítima</span>
                        <select
                          aria-label="Vítima do novo abate"
                          value={addVictimSelect}
                          onChange={(e) => setAddVictimSelect(e.target.value)}
                        >
                          {getKillCandidates(
                            addKillerTeam === 'friendly' ? 'enemy' : 'friendly',
                            ''
                          ).map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                          <option value="__custom__">Outro (digitar)...</option>
                        </select>
                        {addVictimSelect === '__custom__' && (
                          <input
                            aria-label="Nick personalizado da vítima"
                            value={addVictimCustom}
                            onChange={(e) => setAddVictimCustom(e.target.value)}
                            placeholder="Nick da vítima..."
                          />
                        )}
                      </div>
                      <label className="review-kill-hs-toggle">
                        <input
                          type="checkbox"
                          aria-label="Headshot no novo abate"
                          checked={addHeadshot}
                          onChange={(e) => setAddHeadshot(e.target.checked)}
                        />
                        <span>HS</span>
                      </label>
                    </div>
                    <div className="review-kill-edit-actions">
                      <button
                        type="button"
                        className="button button-quiet button-small"
                        onClick={() => setAddingKill(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="button button-primary button-small"
                      >
                        <Check size={13} /> Adicionar abate
                      </button>
                    </div>
                  </form>
                )}

                <div className="review-events-list">
                  {displayedKills.length === 0 ? (
                    <div
                      style={{
                        color: '#778',
                        textAlign: 'center',
                        padding: '30px',
                      }}
                    >
                      Nenhum abate registrado para este filtro.
                    </div>
                  ) : (
                    displayedKills.map((k, i) => {
                      const hasGeneric =
                        isGenericKillName(k.killer) ||
                        isGenericKillName(k.victim);
                      const isEditing = editingKill === k;
                      const killerOptions = getKillCandidates(
                        k.killer_team,
                        k.killer
                      );
                      const victimOptions = getKillCandidates(
                        k.victim_team,
                        k.victim
                      );
                      return (
                        <div
                          key={i}
                          className={`review-event-card ${activeKill === k ? 'active-playing' : ''}`}
                          onClick={() =>
                            seekTo(
                              k.timestamp_sec ?? parseTimeToSeconds(k.time),
                              k
                            )
                          }
                          title="Clique para ir para este lance no vídeo"
                        >
                          <div className="review-event-row">
                            <div className="review-event-left">
                              <span className="review-time-badge">{k.time}</span>
                              <div className="kill-player-unit">
                                <span className={`badge-team-${k.killer_team}`}>
                                  {k.killer}
                                </span>
                                {k.killer_agent && (
                                  <span className="agent-tag">
                                    {k.killer_agent}
                                  </span>
                                )}
                              </div>
                              <span style={{ color: '#556' }}>➔</span>
                              <div className="kill-player-unit">
                                <span className={`badge-team-${k.victim_team}`}>
                                  {k.victim}
                                </span>
                                {k.victim_agent && (
                                  <span className="agent-tag">
                                    {k.victim_agent}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                gap: '6px',
                                alignItems: 'center',
                              }}
                            >
                              {hasGeneric && (
                                <span
                                  className="kill-tag-generic"
                                  title="Nome não identificado automaticamente pelo OCR"
                                >
                                  Genérico
                                </span>
                              )}
                              {(k.manually_corrected || k.manually_added) && (
                                <span
                                  className="kill-tag-manual"
                                  title={
                                    k.manually_added
                                      ? 'Abate adicionado manualmente'
                                      : 'Abate corrigido manualmente'
                                  }
                                >
                                  {k.manually_added ? 'Manual' : 'Editado'}
                                </span>
                              )}
                              {k.headshot && (
                                <span
                                  className="kill-tag-hs"
                                  title="Eliminação por Tiro na Cabeça"
                                >
                                  <Crosshair size={10} /> HS
                                </span>
                              )}
                              {k.first_kill && (
                                <span
                                  className="kill-tag-fk"
                                  title="Primeiro Abate da Rodada"
                                >
                                  <Zap size={10} /> 1st Kill
                                </span>
                              )}
                              {k.is_trade_kill && (
                                <span
                                  className="kill-tag-trade"
                                  title={`Trade Kill! Vingou ${k.traded_teammate || 'aliado'}${k.trade_delta_sec != null ? ` em ${k.trade_delta_sec}s` : ''}`}
                                  style={{
                                    background: 'rgba(234, 179, 8, 0.18)',
                                    border: '1px solid rgba(234, 179, 8, 0.5)',
                                    color: '#facc15',
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontWeight: '700',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  TRADE
                                </span>
                              )}
                              {onUpdateKill && (
                                <button
                                  type="button"
                                  className={`icon-button review-kill-edit-btn ${isEditing ? 'active' : ''}`}
                                  aria-label="Corrigir abate"
                                  title="Corrigir autor, vítima ou HS deste abate"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openKillEditor(k);
                                  }}
                                >
                                  <Pencil size={13} />
                                </button>
                              )}
                              {onDeleteKill && (
                                <button
                                  type="button"
                                  className="icon-button danger review-kill-delete-btn"
                                  aria-label="Excluir abate"
                                  title="Remover este abate da timeline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (editingKill === k) setEditingKill(null);
                                    if (activeKill === k) setActiveKill(null);
                                    onDeleteKill(vod.id, k);
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                              <Play
                                size={13}
                                style={{
                                  color: activeKill === k ? '#38bdf8' : '#65aaff',
                                  opacity: activeKill === k ? 1 : 0.8,
                                }}
                              />
                            </div>
                          </div>

                          {isEditing && (
                            <form
                              className="review-kill-edit-form"
                              onClick={(e) => e.stopPropagation()}
                              onSubmit={(e) => handleSaveKillEdit(e, k)}
                            >
                              <div className="review-kill-edit-row">
                                <div className="review-note-mini-field">
                                  <span>Autor do abate</span>
                                  <select
                                    aria-label="Autor do abate"
                                    value={editKillerSelect}
                                    onChange={(e) =>
                                      setEditKillerSelect(e.target.value)
                                    }
                                  >
                                    {killerOptions.map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))}
                                    <option value="__custom__">
                                      Outro (digitar)...
                                    </option>
                                  </select>
                                  {editKillerSelect === '__custom__' && (
                                    <input
                                      aria-label="Nome personalizado do autor"
                                      value={editKillerCustom}
                                      onChange={(e) =>
                                        setEditKillerCustom(e.target.value)
                                      }
                                      placeholder="Nick do autor..."
                                    />
                                  )}
                                </div>

                                <div className="review-note-mini-field">
                                  <span>Vítima</span>
                                  <select
                                    aria-label="Vítima do abate"
                                    value={editVictimSelect}
                                    onChange={(e) =>
                                      setEditVictimSelect(e.target.value)
                                    }
                                  >
                                    {victimOptions.map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))}
                                    <option value="__custom__">
                                      Outro (digitar)...
                                    </option>
                                  </select>
                                  {editVictimSelect === '__custom__' && (
                                    <input
                                      aria-label="Nome personalizado da vítima"
                                      value={editVictimCustom}
                                      onChange={(e) =>
                                        setEditVictimCustom(e.target.value)
                                      }
                                      placeholder="Nick da vítima..."
                                    />
                                  )}
                                </div>

                                <label className="review-kill-hs-toggle">
                                  <input
                                    type="checkbox"
                                    aria-label="Headshot"
                                    checked={editHeadshot}
                                    onChange={(e) =>
                                      setEditHeadshot(e.target.checked)
                                    }
                                  />
                                  <span>HS</span>
                                </label>
                              </div>

                              <div className="review-kill-edit-actions">
                                <button
                                  type="button"
                                  className="button button-quiet button-small"
                                  onClick={() => setEditingKill(null)}
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="submit"
                                  className="button button-primary button-small"
                                >
                                  <Check size={13} /> Salvar
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : activeTab === 'notes' ? (
              <div className="review-notes-wrap">
                <div className="review-notes-toolbar">
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      onClick={openNewNoteAtCurrentTime}
                    >
                      <Plus size={14} /> Nova marcação
                    </button>
                    {reviewNotes.length > 0 && (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={copyNotesToClipboard}
                        title="Copiar todas as anotações formatadas para o Discord"
                      >
                        <Copy size={13} /> Copiar anotações
                      </button>
                    )}
                  </div>
                </div>

                <div className="review-kill-filter-chips" style={{ marginBottom: '10px' }}>
                  {['Todas', ...REVIEW_NOTE_TAGS].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`round-chip ${noteTagFilter === tag ? 'selected' : ''}`}
                      onClick={() => setNoteTagFilter(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                {noteFormOpen && (
                  <form className="review-note-form" onSubmit={handleSaveNote}>
                    <div className="review-note-form-row">
                      <label className="review-note-mini-field">
                        <span>Tempo</span>
                        <input
                          type="text"
                          value={noteTimeText}
                          onChange={(e) => setNoteTimeText(e.target.value)}
                          placeholder="00:00"
                          style={{ width: '74px' }}
                        />
                      </label>
                      <label className="review-note-mini-field">
                        <span>Round</span>
                        <input
                          type="number"
                          min="1"
                          max="40"
                          value={noteRound}
                          onChange={(e) => setNoteRound(e.target.value)}
                          placeholder="—"
                          style={{ width: '62px' }}
                        />
                      </label>
                      <label className="review-note-mini-field" style={{ flex: 1 }}>
                        <span>Tag tática</span>
                        <select
                          aria-label="Tag tática da marcação"
                          value={noteTag}
                          onChange={(e) => setNoteTag(e.target.value)}
                        >
                          {REVIEW_NOTE_TAGS.map((tag) => (
                            <option key={tag} value={tag}>
                              {tag}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <textarea
                      ref={noteInputRef}
                      rows="2"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveNote(e);
                        }
                      }}
                      placeholder="Descreva o ajuste tático, timing ou erro observado..."
                    />
                    <div className="review-note-form-actions">
                      <button
                        type="button"
                        className="button button-quiet button-small"
                        onClick={() => {
                          setNoteFormOpen(false);
                          setEditingNoteId(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="button button-primary button-small"
                      >
                        {editingNoteId ? 'Atualizar marcação' : 'Salvar marcação'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="review-events-list">
                  {filteredNotes.length === 0 ? (
                    <div
                      style={{
                        color: '#778',
                        textAlign: 'center',
                        padding: '30px 16px',
                      }}
                    >
                      {reviewNotes.length === 0
                        ? 'Nenhuma marcação ainda. Clique em "Marcar momento" (ou pressione B) para anotar um lance.'
                        : 'Nenhuma marcação encontrada para essa tag.'}
                    </div>
                  ) : (
                    filteredNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`review-note-card ${activeNoteId === note.id ? 'active-playing' : ''}`}
                        onClick={() => {
                          setActiveNoteId(note.id);
                          seekTo(note.timestampSec);
                        }}
                        title="Clique para pular para este momento no vídeo"
                      >
                        <div className="review-note-card-top">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span className="review-time-badge">{note.time}</span>
                            {note.round && (
                              <span className="agent-tag">R{note.round}</span>
                            )}
                            <span className="review-note-tag">{note.tag}</span>
                          </div>
                          <div className="review-note-actions">
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Editar marcação"
                              title="Editar marcação"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditNote(note);
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className="icon-button danger"
                              aria-label="Excluir marcação"
                              title="Excluir marcação"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNote(note.id);
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <p className="review-note-text">{note.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="review-scoreboard-wrap">
                <div className="scoreboard-filter-bar">
                  <div className="rounds-chip-grid" style={{ marginBottom: 0 }}>
                    <button
                      type="button"
                      className={`round-chip ${scoreboardTeamFilter === 'all' ? 'selected' : ''}`}
                      onClick={() => setScoreboardTeamFilter('all')}
                    >
                      Todos ({cleanedPlayers.length})
                    </button>
                    <button
                      type="button"
                      className={`round-chip ${scoreboardTeamFilter === 'friendly' ? 'selected won' : ''}`}
                      onClick={() => setScoreboardTeamFilter('friendly')}
                    >
                      Aliados (
                      {
                        cleanedPlayers.filter((p) => p.team === 'friendly')
                          .length
                      }
                      )
                    </button>
                    <button
                      type="button"
                      className={`round-chip ${scoreboardTeamFilter === 'enemy' ? 'selected lost' : ''}`}
                      onClick={() => setScoreboardTeamFilter('enemy')}
                    >
                      Inimigos (
                      {cleanedPlayers.filter((p) => p.team === 'enemy').length})
                    </button>
                  </div>
                </div>

                {analysis.tactical_summary && (
                  <div
                    className="tactical-summary-banner"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '14px',
                      padding: '10px 14px',
                      marginBottom: '12px',
                      background: 'rgba(56, 189, 248, 0.06)',
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#38bdf8' }}>MÉTRICAS TÁTICAS:</span>
                    {analysis.tactical_summary.first_blood_conversion?.friendly && (
                      <span style={{ color: '#cbd5e1' }}>
                        <strong>5v4 Win Rate:</strong>{' '}
                        <span style={{ color: '#34d399', fontWeight: 600 }}>
                          {analysis.tactical_summary.first_blood_conversion.friendly.rate}%
                        </span>{' '}
                        ({analysis.tactical_summary.first_blood_conversion.friendly.fb_rounds_won}/{analysis.tactical_summary.first_blood_conversion.friendly.fb_rounds_total})
                      </span>
                    )}
                    {analysis.tactical_summary.man_disadvantage_recovery?.friendly && (
                      <span style={{ color: '#cbd5e1' }}>
                        <strong>4v5 Viradas:</strong>{' '}
                        <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                          {analysis.tactical_summary.man_disadvantage_recovery.friendly.rate}%
                        </span>{' '}
                        ({analysis.tactical_summary.man_disadvantage_recovery.friendly.recovery_rounds_won}/{analysis.tactical_summary.man_disadvantage_recovery.friendly.recovery_rounds_total})
                      </span>
                    )}
                    {analysis.tactical_summary.team_trade_efficiency?.friendly && (
                      <span style={{ color: '#cbd5e1' }}>
                        <strong>Eficiência de Trades:</strong>{' '}
                        <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                          {analysis.tactical_summary.team_trade_efficiency.friendly.rate}%
                        </span>
                      </span>
                    )}
                  </div>
                )}

                <div className="scoreboard-table-container">
                  <table className="review-scoreboard-table">
                    <thead>
                      <tr>
                        <th>JOGADOR</th>
                        <th>AGENTE</th>
                        <th>TIME</th>
                        <th className="col-center">ABATES</th>
                        <th className="col-center">MORTES</th>
                        <th className="col-center">ASSISTÊNCIAS</th>
                        <th className="col-center">K/D</th>
                        <th className="col-center">HS %</th>
                        <th className="col-center">1st KILL</th>
                        <th className="col-center">1st DEATH</th>
                        {hasTacticalStats && (
                          <>
                            <th className="col-center">KAST %</th>
                            <th className="col-center">TRADES</th>
                            <th className="col-center">CLUTCH</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlayers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={hasTacticalStats ? 13 : 10}
                            style={{
                              textAlign: 'center',
                              padding: '30px',
                              color: '#778',
                            }}
                          >
                            Nenhum jogador encontrado para este filtro.
                          </td>
                        </tr>
                      ) : (
                        filteredPlayers.map((s, idx) => (
                          <tr key={s.name}>
                            <td>
                              <strong>{s.name}</strong>
                              {s.scoreboard_verified && (
                                <span
                                  title="Verificado e sincronizado com o Scoreboard Oficial (100% precisão)"
                                  style={{
                                    marginLeft: 6,
                                    fontSize: '0.72rem',
                                    color: '#38bdf8',
                                    background: 'rgba(56, 189, 248, 0.12)',
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    fontWeight: 600,
                                  }}
                                >
                                  Placar
                                </span>
                              )}
                              {idx === 0 && scoreboardTeamFilter === 'all' && (
                                <span className="mvp-badge">
                                  <Trophy size={10} /> MVP
                                </span>
                              )}
                            </td>
                            <td>
                              <span className="agent-tag">
                                {s.agent || '—'}
                              </span>
                            </td>
                            <td>
                              <span className={`badge-team-${s.team}`}>
                                {s.team === 'friendly' ? 'Aliado' : 'Inimigo'}
                              </span>
                            </td>
                            <td
                              className="col-center"
                              style={{ color: '#54d6a2', fontWeight: 700 }}
                            >
                              {s.kills}
                            </td>
                            <td
                              className="col-center"
                              style={{ color: '#ff6c83' }}
                            >
                              {s.deaths}
                            </td>
                            <td
                              className="col-center"
                              style={{ color: '#93c5fd', fontWeight: 600 }}
                            >
                              {s.assists}
                            </td>
                            <td className="col-center">
                              <span
                                className={`kd-badge ${Number(s.kd_ratio) >= 1.5 ? 'kd-high' : Number(s.kd_ratio) >= 1.0 ? 'kd-mid' : 'kd-low'}`}
                              >
                                {s.kd_ratio}x
                              </span>
                            </td>
                            <td className="col-center">
                              <span className="kill-tag-hs">
                                {s.headshot_rate}%
                              </span>
                            </td>
                            <td className="col-center">{s.first_kills}</td>
                            <td
                              className="col-center"
                              style={{ color: '#94a3b8' }}
                            >
                              {s.first_deaths}
                            </td>
                            {hasTacticalStats && (
                              <>
                                <td
                                  className="col-center"
                                  style={{ color: '#38bdf8', fontWeight: 600 }}
                                >
                                  {s.kast_pct !== undefined ? `${s.kast_pct}%` : '—'}
                                </td>
                                <td
                                  className="col-center"
                                  style={{ color: '#facc15' }}
                                >
                                  {s.trade_kills || 0}/{s.traded_deaths || 0}
                                </td>
                                <td
                                  className="col-center"
                                  style={{ color: '#fb923c', fontWeight: 600 }}
                                >
                                  {s.clutches_won > 0 ? `${s.clutches_won}` : '0'}
                                </td>
                              </>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

