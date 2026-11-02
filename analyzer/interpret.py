"""
Módulo de Interpretação e Regras de Negócio do Valorant Scrim Analyzer.
Contém funções puras para:
- Normalização e resolução de nomes de jogadores e agentes
- Gestão do elenco (roster)
- Deduplicação de eventos do killfeed
- Transição de pontuação e fechamento de rodadas
- Consolidação do scoreboard final (K/D, HS%, duelos de abertura)
"""

import difflib
import json
import re
import unicodedata
from collections import Counter
from typing import Any

VALORANT_AGENTS = [
    "Fade", "Chamber", "Waylay", "Omen", "Sage", "Jett", "Sova", "Breach",
    "Killjoy", "Cypher", "Raze", "Reyna", "Phoenix", "Yoru", "Neon", "Iso",
    "Brimstone", "Viper", "Astra", "Harbor", "Clove", "Skye", "KAY/O", "Gekko",
    "Deadlock", "Vyse", "Tejo"
]

IGNORE_WORDS = {
    "initiator", "duelist", "controller", "sentinel", "attacking", "defending",
    "spotted", "broadcast", "enemy", "spike", "planted", "round", "standard-custom",
    "picking...", "locked", "select", "press", "tobuy", "buy phase",
    "fense", "defense", "attack", "aliado", "inimigo", "agente", "jogador",
    "vandal", "phantom", "sheriff", "ghost", "classic", "spectre", "operator",
    "guardian", "ares", "odin", "stinger", "bucky", "judge", "marshal", "outlaw",
    "frenzy", "shorty", "sidearm", "headshot", "kill", "death", "assist", "match",
    "victory", "defeat", "high", "medium", "low", "sec"
}

DEFAULT_UI_TERMS = {
    "magazine", "reload speed", "reldad speed", "firerate", "fire rate",
    "1stshot spread", "istshot srread", "damage", "light armor", "regen shield",
    "altfire", "zoom", "move speed", "feature", "silenced", "featuretsilenced",
    "min next round", "let's buy", "haveextra creds", "let's save", "classic",
    "sheriff", "shorty", "frenzy", "ghost", "singularity", "melee", "vibin'",
    "tracers not visible to enemies", "crosshair follows recoil", "champions",
}

GENERIC_NICKS = {"aliado", "inimigo", "agente", "jogador"}
KDA_PATTERN = re.compile(r"^(\d{1,2})\s*[/\\|]\s*(\d{1,2})\s*[/\\|]\s*(\d{1,2})$")


def format_time(seconds: float) -> str:
    """Converte segundos em string MM:SS."""
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m:02d}:{s:02d}"


def normalize_nick(txt: str) -> str:
    """Remove caracteres especiais, espaços, acentos (NFKD) e converte para minúsculas."""
    if not txt:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(txt))
    ascii_txt = decomposed.encode("ASCII", "ignore").decode("ascii")
    return re.sub(r"[^a-zA-Z0-9_]", "", ascii_txt).lower()


def build_initial_roster(user_nick: str | None = None, user_agent: str | None = None) -> dict:
    """Inicializa o dicionário de elenco com o jogador do usuário, se fornecido."""
    roster = {}
    if user_nick:
        u_clean = user_nick.strip()
        roster[normalize_nick(u_clean)] = {
            "canonical_nick": u_clean,
            "agent": user_agent or "Agente",
            "team": "friendly"
        }
    return roster


def match_candidate_with_margin(
    query_norm: str,
    candidates: list[tuple[str, dict]],
    min_ratio: float = 0.65,
    min_margin: float = 0.10,
) -> tuple[dict, float] | None:
    """
    Busca o melhor candidato no roster usando similaridade SequenceMatcher (distância de edição).
    Exige similaridade mínima (min_ratio) e margem de segurança entre
    o 1º e o 2º melhor colocado para evitar atribuições ambíguas.
    """
    if not candidates or not query_norm:
        return None

    scores = []
    for c_norm, info in candidates:
        ratio = difflib.SequenceMatcher(None, query_norm, c_norm).ratio()
        scores.append((ratio, info))

    scores.sort(key=lambda x: x[0], reverse=True)
    best_score, best_info = scores[0]

    if best_score < min_ratio:
        return None

    if len(scores) > 1:
        second_score = scores[1][0]
        # Se a similaridade for muito alta (>= 0.88), aceita margem menor (0.05)
        req_margin = 0.05 if best_score >= 0.88 else min_margin
        if (best_score - second_score) < req_margin:
            return None  # Ambiguidade entre múltiplos candidatos

    return best_info, best_score


def resolve_player(
    raw_text: str,
    team: str,
    roster: dict,
    allow_registration: bool = False,
    min_ratio: float = 0.65,
    min_margin: float = 0.10,
) -> tuple[str, str]:
    """
    Resolve texto bruto de OCR para (canonical_nickname, agent_name).
    1. Rejeição de ruídos e palavras de sistema (IGNORE_WORDS)
    2. Detecção de nome de agente
    3. Match exato ou substring no roster
    4. Distância de edição real (SequenceMatcher) com margem entre o 1º e 2º colocado
    5. No elenco fechado (allow_registration=False): não auto-registra; leituras
       não combinadas viram 'Aliado' ou 'Inimigo' e não poluem o scoreboard.
    """
    if not raw_text:
        return ("Aliado" if team == "friendly" else "Inimigo", "Agente")

    cleaned = raw_text.strip()
    norm = normalize_nick(cleaned)

    # Rejeita números puros ou strings sem letras ASCII
    has_letters = bool(re.search(r"[a-zA-Z]", cleaned))
    if not has_letters or len(cleaned) < 2 or norm in IGNORE_WORDS:
        return ("Aliado" if team == "friendly" else "Inimigo", "Agente")

    # 1. Verifica se raw_text é nome de agente
    for ag in VALORANT_AGENTS:
        if ag.lower() in norm:
            for _, info in roster.items():
                if info["team"] == team and info["agent"].lower() == ag.lower():
                    return (info["canonical_nick"], info["agent"])
            return (f"Jogador ({ag})", ag)

    # 2. Match exato ou substring contra roster conhecido (prioriza mesmo time)
    for r_norm, info in roster.items():
        if info.get("team") == team and (r_norm == norm or (len(r_norm) >= 4 and r_norm in norm) or (len(norm) >= 4 and norm in r_norm)):
            return (info["canonical_nick"], info["agent"])
    for r_norm, info in roster.items():
        if r_norm == norm or (len(r_norm) >= 4 and r_norm in norm) or (len(norm) >= 4 and norm in r_norm):
            return (info["canonical_nick"], info["agent"])

    # 3. Distância de edição real com margem de segurança entre melhor e segundo melhor
    if len(norm) >= 3 and norm not in IGNORE_WORDS and roster:
        # Prioriza candidatos do mesmo time indicado pelo killfeed
        same_team_cands = [(rn, inf) for rn, inf in roster.items() if inf.get("team") == team]
        match_res = match_candidate_with_margin(norm, same_team_cands, min_ratio=min_ratio, min_margin=min_margin)
        if match_res is not None:
            best_info, _ = match_res
            return (best_info["canonical_nick"], best_info["agent"])

        # Se não casou no mesmo time, testa todos os candidatos do roster com threshold mais rigoroso
        all_cands = list(roster.items())
        cross_ratio = min(1.0, min_ratio + 0.07)
        cross_margin = min_margin + 0.02
        match_res = match_candidate_with_margin(norm, all_cands, min_ratio=cross_ratio, min_margin=cross_margin)
        if match_res is not None:
            best_info, _ = match_res
            return (best_info["canonical_nick"], best_info["agent"])

        # Auto-registro apenas se explicitamente habilitado (desativado no elenco fechado)
        if allow_registration:
            roster[norm] = {"canonical_nick": cleaned, "agent": "Agente", "team": team}
            return (cleaned, "Agente")

        return ("Aliado" if team == "friendly" else "Inimigo", "Agente")

    return ("Aliado" if team == "friendly" else "Inimigo", "Agente")


DEFAULT_KILL_WINDOW_SEC = 5.5
DEFAULT_KILL_PRUNE_AGE_SEC = 7.5


def prune_recent_kills(recent_kills: list[tuple], current_time_sec: float, max_age_sec: float = DEFAULT_KILL_PRUNE_AGE_SEC) -> list[tuple]:
    """Remove abates da janela de deduplicação mais antigos que max_age_sec."""
    return [k for k in recent_kills if current_time_sec - k[2] < max_age_sec]


def find_kill_merge_target(
    recent_kills: list[tuple],
    killer_nick: str,
    victim_nick: str,
    current_time_sec: float,
    window_sec: float = DEFAULT_KILL_WINDOW_SEC,
    slot_idx: int | None = None,
) -> int | None:
    k_norm = normalize_nick(killer_nick)
    v_norm = normalize_nick(victim_nick)
    k_is_gen = (not k_norm) or (k_norm in GENERIC_NICKS) or k_norm.startswith("jogador (")
    v_is_gen = (not v_norm) or (v_norm in GENERIC_NICKS) or v_norm.startswith("jogador (")

    if k_is_gen and v_is_gen:
        return None

    for idx in range(len(recent_kills) - 1, -1, -1):
        item = recent_kills[idx]
        prev_k, prev_v, prev_t = item[0], item[1], item[2]
        prev_slot = item[4] if len(item) > 4 else None
        dt = current_time_sec - prev_t
        if dt < 0 or dt >= window_sec:
            continue

        prev_k_norm = normalize_nick(prev_k)
        prev_v_norm = normalize_nick(prev_v)
        prev_k_gen = (not prev_k_norm) or (prev_k_norm in GENERIC_NICKS) or prev_k_norm.startswith("jogador (")
        prev_v_gen = (not prev_v_norm) or (prev_v_norm in GENERIC_NICKS) or prev_v_norm.startswith("jogador (")

        if not k_is_gen and not prev_k_gen and k_norm == prev_k_norm:
            if prev_v_gen and not v_is_gen:
                return idx

        if not v_is_gen and not prev_v_gen and v_norm == prev_v_norm:
            if prev_k_gen and not k_is_gen:
                return idx

        if prev_k_gen and prev_v_gen and not k_is_gen and not v_is_gen and dt < 2.0:
            return idx

        # Leituras parciais complementares no mesmo slot (ou slot que subiu)
        if (
            slot_idx is not None
            and prev_slot is not None
            and slot_idx <= prev_slot
            and dt < 2.5
        ):
            if (not prev_k_gen and prev_v_gen and k_is_gen and not v_is_gen) or (
                prev_k_gen and not prev_v_gen and not k_is_gen and v_is_gen
            ):
                return idx

    return None


def apply_kill_merge(
    recent_kills: list[tuple],
    target_idx: int,
    killer_nick: str,
    killer_agent: str,
    victim_nick: str,
    victim_agent: str,
    is_headshot: bool,
    round_dead_times: dict[str, list[float]],
    slot_idx: int | None = None,
) -> None:
    target = recent_kills[target_idx]
    prev_k = target[0]
    prev_v = target[1]
    prev_t = target[2]
    event_ref = target[3] if len(target) > 3 else None
    prev_slot = target[4] if len(target) > 4 else None
    new_slot = slot_idx if slot_idx is not None else prev_slot

    norm_prev_v = normalize_nick(prev_v)
    norm_new_v = normalize_nick(victim_nick)
    v_prev_is_gen = (not norm_prev_v) or (norm_prev_v in GENERIC_NICKS) or norm_prev_v.startswith("jogador (")
    v_new_is_gen = (not norm_new_v) or (norm_new_v in GENERIC_NICKS) or norm_new_v.startswith("jogador (")

    if v_prev_is_gen and not v_new_is_gen:
        if event_ref is not None:
            event_ref["victim"] = victim_nick
            event_ref["victim_agent"] = victim_agent
        if round_dead_times.get(norm_prev_v):
            round_dead_times[norm_prev_v].pop()
        round_dead_times.setdefault(norm_new_v, []).append(prev_t)
        prev_v = victim_nick

    norm_prev_k = normalize_nick(prev_k)
    norm_new_k = normalize_nick(killer_nick)
    k_prev_is_gen = (not norm_prev_k) or (norm_prev_k in GENERIC_NICKS) or norm_prev_k.startswith("jogador (")
    k_new_is_gen = (not norm_new_k) or (norm_new_k in GENERIC_NICKS) or norm_new_k.startswith("jogador (")

    if k_prev_is_gen and not k_new_is_gen:
        if event_ref is not None:
            event_ref["killer"] = killer_nick
            event_ref["killer_agent"] = killer_agent
        prev_k = killer_nick

    if is_headshot and event_ref is not None:
        event_ref["headshot"] = True

    if len(target) > 4 or slot_idx is not None:
        recent_kills[target_idx] = (prev_k, prev_v, prev_t, event_ref, new_slot)
    elif len(target) > 3:
        recent_kills[target_idx] = (prev_k, prev_v, prev_t, event_ref)
    else:
        recent_kills[target_idx] = (prev_k, prev_v, prev_t)


def is_duplicate_kill(
    recent_kills: list[tuple],
    killer_nick: str,
    victim_nick: str,
    current_time_sec: float,
    window_sec: float = DEFAULT_KILL_WINDOW_SEC,
    slot_idx: int | None = None,
    is_headshot: bool = False,
) -> bool:
    """
    Verifica se o evento de kill é uma duplicata de leitura do feed recente.

    1. Par exato (mesmo assassino E mesma vítima dentro da janela):
       -> É uma duplicata da linha ainda visível no feed.
    2. Mesma vítima conhecida (não-genérica):
       -> Como um jogador não pode morrer duas vezes em menos de window_sec (nem com rez),
          se a vítima é a mesma, trata-se da mesma kill.
    3. Mesmo assassino, mas VÍTIMA DIFERENTE CONHECIDA (não-genérica):
       -> NÃO é duplicata! É um Double/Triple Kill legítimo do mesmo jogador.
    4. Mesmo assassino com leitura genérica da vítima ('Inimigo' / 'Aliado'):
       -> Dentro de micro-janela (< 1.5s) ou quando o cartão está no mesmo slot/slot superior
          (slot_idx <= prev_slot) durante a janela de exibição.
    """
    k_norm = normalize_nick(killer_nick)
    v_norm = normalize_nick(victim_nick)

    k_is_generic = (not k_norm) or (k_norm in GENERIC_NICKS)
    v_is_generic = (not v_norm) or (v_norm in GENERIC_NICKS)

    for idx, item in enumerate(recent_kills):
        prev_k = item[0]
        prev_v = item[1]
        prev_t = item[2]
        event_ref = item[3] if len(item) > 3 else None
        prev_slot = item[4] if len(item) > 4 else None
        dt = current_time_sec - prev_t
        if dt < 0 or dt >= window_sec:
            continue

        prev_k_norm = normalize_nick(prev_k)
        prev_v_norm = normalize_nick(prev_v)
        prev_k_generic = (not prev_k_norm) or (prev_k_norm in GENERIC_NICKS)
        prev_v_generic = (not prev_v_norm) or (prev_v_norm in GENERIC_NICKS)

        matched = False
        if k_norm == prev_k_norm and v_norm == prev_v_norm:
            matched = True
        elif not v_is_generic and not prev_v_generic and v_norm == prev_v_norm:
            matched = True
        elif not k_is_generic and k_norm == prev_k_norm and not v_is_generic and not prev_v_generic and v_norm != prev_v_norm:
            continue
        elif not k_is_generic and k_norm == prev_k_norm and (v_is_generic or prev_v_generic):
            if dt < 1.5 or (
                slot_idx is not None and prev_slot is not None and slot_idx <= prev_slot
            ):
                matched = True
        elif (
            slot_idx is not None
            and prev_slot is not None
            and slot_idx <= prev_slot
            and not v_is_generic
            and v_norm == prev_v_norm
            and (k_is_generic or prev_k_generic)
        ):
            matched = True

        if matched:
            if is_headshot and event_ref is not None:
                event_ref["headshot"] = True
            if slot_idx is not None and len(item) > 3:
                recent_kills[idx] = (prev_k, prev_v, prev_t, event_ref, slot_idx)
            return True

    return False



RESURRECTION_AGENTS = {"sage", "clove"}


def can_record_death_in_round(
    victim_nick: str,
    round_dead_times: dict[str, list[float]],
    current_time_sec: float,
    victim_team: str,
    roster: dict,
    has_resurrection: bool = False,
    max_team_deaths: int | None = 5,
    resurrected_players: set[str] | list[str] | None = None,
) -> bool:
    """
    Valida se a vítima pode morrer na rodada atual:
    1. Duas mortes do mesmo jogador em menos de 10 segundos são sempre descartadas.
    2. Após 10 segundos, uma segunda morte só é aceita se o jogador foi ressuscitado
       (autorizado via resurrected_players ou evento de ressurreição no round).
    3. Capacidade por equipe: mortes nomeadas + genéricas <= 5 (ou 6+ com ressurreição).
    4. Rótulos genéricos ('Aliado', 'Inimigo', 'Agente') são estritamente limitados
       às vagas vazias da equipe (effective_max - jogadores nomeados já mortos), com
       intervalo mínimo de 1.0s.
    """
    cleaned = victim_nick.strip()
    norm = normalize_nick(cleaned)
    prev_times = round_dead_times.get(norm, [])
    if not prev_times and cleaned in round_dead_times:
        prev_times = round_dead_times.get(cleaned, [])

    res_agent_count = sum(
        1
        for inf in roster.values()
        if inf.get("team") == victim_team and str(inf.get("agent", "")).strip().lower() in RESURRECTION_AGENTS
    )
    has_resurrect_agent = res_agent_count > 0

    if resurrected_players is not None:
        bonus = len(resurrected_players)
    elif has_resurrection or has_resurrect_agent:
        bonus = 1
    else:
        bonus = 0
    effective_max = (max_team_deaths or 5) + bonus

    roster_by_norm: dict[str, dict] = {}
    for r_key, r_inf in roster.items():
        if isinstance(r_inf, dict):
            roster_by_norm[normalize_nick(str(r_key))] = r_inf
            c_nick = r_inf.get("canonical_nick")
            if c_nick:
                roster_by_norm[normalize_nick(str(c_nick))] = r_inf

    named_dead_players = set()
    named_team_deaths = 0
    team_second_deaths = 0
    generic_dead_count = 0
    total_team_deaths = 0

    for dead_name, times in round_dead_times.items():
        if not times:
            continue
        dead_norm = normalize_nick(str(dead_name))
        is_this_team = False
        is_gen = False
        r_entry = roster.get(dead_name) or roster_by_norm.get(dead_norm)
        if r_entry is not None:
            if r_entry.get("team") == victim_team:
                is_this_team = True
                named_dead_players.add(dead_norm)
                named_team_deaths += len(times)
                if len(times) >= 2:
                    team_second_deaths += 1
        elif victim_team == "friendly" and (dead_norm == "aliado" or dead_norm.startswith("aliado") or dead_norm in GENERIC_NICKS or "aliado" in dead_norm):
            is_this_team = True
            is_gen = True
        elif victim_team == "enemy" and (dead_norm == "inimigo" or dead_norm.startswith("inimigo") or dead_norm in GENERIC_NICKS or "inimigo" in dead_norm):
            is_this_team = True
            is_gen = True

        if is_this_team:
            total_team_deaths += len(times)
            if is_gen:
                generic_dead_count += len(times)

    is_generic_victim = (not norm) or (norm in GENERIC_NICKS) or norm.startswith("jogador (")

    if not is_generic_victim and len(prev_times) >= 1:
        # Trava Intra-Frame / Sub-segundo: o mesmo jogador não pode morrer duas vezes em menos de 1.0s
        if any(abs(current_time_sec - pt) < 1.0 for pt in prev_times):
            return False
        # Um jogador só pode morrer no máximo 2 vezes no round se tiver sido ressuscitado
        if len(prev_times) >= 2:
            return False
        time_since_last_death = current_time_sec - prev_times[-1]
        if time_since_last_death < 10.0:
            return False
        if resurrected_players is not None:
            if norm not in resurrected_players:
                return False
        elif not (has_resurrection or has_resurrect_agent):
            return False
        max_res_deaths = max(1 if has_resurrection else 0, len(resurrected_players) if resurrected_players is not None else res_agent_count)
        if team_second_deaths >= max_res_deaths:
            return False
        if max_team_deaths is not None and named_team_deaths >= effective_max:
            return False
        return True

    if max_team_deaths is not None and total_team_deaths >= effective_max:
        return False

    if is_generic_victim:
        if len(prev_times) >= 5:
            return False
        if max_team_deaths is not None:
            vacant_slots = max(0, effective_max - len(named_dead_players))
            if generic_dead_count >= vacant_slots:
                return False
        if prev_times and (current_time_sec - prev_times[-1] < 1.0):
            return False
        return True

    if len(prev_times) == 0:
        return True

    return False


def get_roster_player_team(nick: str, roster: dict) -> str | None:
    """
    Retorna a equipe imutável ("friendly" ou "enemy") associada ao jogador no roster fechado.
    Retorna None para rótulos genéricos ("Aliado", "Inimigo", "Jogador (...)") ou jogadores não mapeados.
    """
    if not nick or not roster:
        return None
    norm = normalize_nick(nick)
    if not norm or norm in GENERIC_NICKS or norm.startswith("jogador ("):
        return None
    if norm in roster and isinstance(roster[norm], dict):
        return roster[norm].get("team")
    for r_norm, r_info in roster.items():
        if not isinstance(r_info, dict):
            continue
        if r_norm == norm or normalize_nick(str(r_info.get("canonical_nick", ""))) == norm:
            return r_info.get("team")
    return None


def infer_last_surviving_victim(
    raw_v: str,
    victim_team: str,
    roster: dict,
    round_dead_times: dict[str, list[float]],
    round_resurrected_players: set[str] | None = None,
) -> tuple[str, str] | None:
    """
    Inferência do Último Sobrevivente (Closed Elimination intra-round):
    Se 4 dos 5 jogadores conhecidos do elenco daquela equipe já estão confirmados
    como mortos na rodada e ocorre uma morte para a equipe, por eliminação fechada
    a vítima pertence com 100% de certeza ao único sobrevivente restante da equipe.
    """
    if not roster:
        return None

    team_members = []
    seen = set()
    for _r_norm, r_info in roster.items():
        if not isinstance(r_info, dict):
            continue
        c_nick = str(r_info.get("canonical_nick", "")).strip()
        if r_info.get("team") == victim_team and c_nick and not c_nick.startswith(("Aliado", "Inimigo", "Jogador (")):
            if c_nick not in seen:
                seen.add(c_nick)
                team_members.append((normalize_nick(c_nick), c_nick, str(r_info.get("agent", "Agente"))))

    if len(team_members) != 5:
        return None

    dead_canonicals = set()
    for m_norm, c_nick, _ in team_members:
        times = round_dead_times.get(m_norm, [])
        if times:
            dead_canonicals.add(c_nick)

    alive_members = [m for m in team_members if m[1] not in dead_canonicals]
    if len(alive_members) == 1:
        _last_norm, last_canonical, last_agent = alive_members[0]
        return (last_canonical, last_agent)

    return None


def evict_half_generic_kill_for_named(
    current_round_kills: list[dict],
    recent_kills: list[tuple],
    round_dead_times: dict[str, list[float]],
    killer_nick: str,
    victim_nick: str,
    current_time_sec: float,
    victim_team: str,
    round_resurrected_players: set[str] | None = None,
) -> bool:
    """
    Substituição de Vítima por Confiança (Full-Named Eviction):
    Se uma vítima 100% nomeada (ex: PlayerA) já consta como morta no round (sem revive ativo),
    mas a morte anterior dela tinha assassino genérico (ex: Aliado -> PlayerA aos 1205s),
    e o novo evento tem assassino e vítima 100% nomeados (ex: PlayerB -> PlayerA aos 1234s),
    o novo evento expulsa o evento semi-genérico anterior e atualiza round_dead_times[v_norm].
    """
    k_norm = normalize_nick(killer_nick)
    v_norm = normalize_nick(victim_nick)
    k_is_gen = (not k_norm) or (k_norm in GENERIC_NICKS) or k_norm.startswith("jogador (")
    v_is_gen = (not v_norm) or (v_norm in GENERIC_NICKS) or v_norm.startswith("jogador (")

    if k_is_gen or v_is_gen:
        return False

    if round_resurrected_players and v_norm in round_resurrected_players:
        return False

    prev_phantom = None
    for k in current_round_kills:
        if k.get("victim_team") == victim_team and normalize_nick(str(k.get("victim", ""))) == v_norm:
            p_k_norm = normalize_nick(str(k.get("killer", "")))
            if (not p_k_norm) or (p_k_norm in GENERIC_NICKS) or p_k_norm.startswith("jogador ("):
                prev_phantom = k
                break

    if prev_phantom is None:
        return False

    current_round_kills.remove(prev_phantom)
    recent_kills[:] = [rk for rk in recent_kills if rk[3] != prev_phantom]

    if round_dead_times.get(v_norm):
        round_dead_times[v_norm].pop()

    return True


def evict_generic_victim_at_capacity(
    current_round_kills: list[dict],
    recent_kills: list[tuple],
    round_dead_times: dict[str, list[float]],
    killer_nick: str,
    victim_nick: str,
    victim_team: str,
    effective_max: int = 5,
) -> bool:
    """
    Evicção de Genéricos no Fechamento:
    Se o novo candidato tem vítima nomeada e o teto da equipe foi atingido (ou quase atingido),
    mas a lista do round contém uma morte com vítima genérica ('Inimigo' ou 'Aliado'),
    expulsa a vítima genérica para acomodar o jogador real nomeado.
    """
    v_norm = normalize_nick(victim_nick)
    v_is_gen = (not v_norm) or (v_norm in GENERIC_NICKS) or v_norm.startswith("jogador (")
    if v_is_gen:
        return False

    generic_kill = None
    for k in current_round_kills:
        if k.get("victim_team") == victim_team:
            g_v_norm = normalize_nick(str(k.get("victim", "")))
            if (not g_v_norm) or (g_v_norm in GENERIC_NICKS) or g_v_norm.startswith("jogador ("):
                generic_kill = k
                break

    if generic_kill is None:
        return False

    current_round_kills.remove(generic_kill)
    recent_kills[:] = [rk for rk in recent_kills if rk[3] != generic_kill]
    g_v_norm = normalize_nick(str(generic_kill.get("victim", "")))
    if round_dead_times.get(g_v_norm):
        round_dead_times[g_v_norm].pop()

    return True


def locate_killfeed_plaque_and_hs_window(
    row_crop: Any,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    killer_box_right: float | None = None,
    victim_box_left: float | None = None,
) -> dict[str, Any]:
    """
    Localiza dinamicamente na linha do killfeed:
    1. A fronteira de cor horizontal (boundary_x) entre a placa do assassino (esquerda)
       e a placa da vítima (direita), determinando killer_team, victim_team e se há
       contraste válido de cores opostas (rejeitando banners da mesma cor como ressurreição).
    2. O ícone da arma (blob branco de baixa saturação no fim da placa do assassino).
    3. A janela horizontal [hs_x1, hs_x2] para busca do template de headshot ancorada
       entre o fim do blob da arma e a fronteira de cor entre as placas, usando as caixas
       de texto do OCR apenas como reforço quando disponíveis.
    """
    import numpy as np

    if row_crop is None or not hasattr(row_crop, "shape") or row_crop.size == 0:
        default_x1 = int(115 * scale_x)
        default_x2 = int(235 * scale_x)
        return {
            "boundary_x": int(215 * scale_x),
            "killer_team": "friendly",
            "victim_team": "enemy",
            "has_opposite_plaques": False,
            "weapon_blob_left": default_x1,
            "weapon_blob_right": default_x2,
            "hs_x1": default_x1,
            "hs_x2": default_x2,
        }

    h, w = row_crop.shape[:2]
    # Recorta a faixa vertical central do cartão (~20px em 720p) para evitar contaminação de slots vizinhos
    cy_mid = h / 2.0
    c_y1 = max(0, round(cy_mid - 10.0 * scale_y))
    c_y2 = min(h, round(cy_mid + 10.0 * scale_y))
    if c_y2 - c_y1 < 6:
        c_y1, c_y2 = 0, h

    card_band = row_crop[c_y1:c_y2, :]
    r_green = (card_band[:, :, 1] > 110) & (card_band[:, :, 1] > card_band[:, :, 2] + 15)
    r_red = (card_band[:, :, 2] > 120) & (card_band[:, :, 2] > card_band[:, :, 1] + 15)
    r_purple = (card_band[:, :, 2] > 110) & (card_band[:, :, 0] > 110) & (card_band[:, :, 1] < 100)
    r_yellow = (card_band[:, :, 2] > 120) & (card_band[:, :, 1] > 120) & (card_band[:, :, 0] < 100)
    r_enemy = r_red | r_purple | r_yellow

    # O cartão do killfeed fica alinhado à direita da tela (~335px em 720p).
    # Caso a imagem de entrada possua margem à esquerda (ex: kf_crop com 448px), calcula o deslocamento.
    card_w = min(w, int(335 * scale_x))
    x_offset = max(0, w - card_w)

    x_min = x_offset + max(int(165 * scale_x), min(20, card_w // 3))
    x_max = x_offset + min(card_w - int(25 * scale_x), int(272 * scale_x))
    if x_max <= x_min:
        x_min = x_offset + max(0, card_w // 3)
        x_max = x_offset + max(x_min + 1, (2 * card_w) // 3)

    best_xb = x_offset + int(215 * scale_x)
    best_score = -1e9
    best_killer_team = "friendly"
    best_lg, best_le, best_rg, best_re = 0, 0, 0, 0

    for xb in range(x_min, x_max):
        lx1 = max(x_offset + int(55 * scale_x), xb - int(85 * scale_x))
        rx2 = min(w, xb + int(65 * scale_x))
        lg = int(np.sum(r_green[:, lx1:xb]))
        le = int(np.sum(r_enemy[:, lx1:xb]))
        rg = int(np.sum(r_green[:, xb:rx2]))
        re = int(np.sum(r_enemy[:, xb:rx2]))

        s_fe = (lg - le) + (re - rg) if (lg > le and re > rg) else -1e6
        s_ef = (le - lg) + (rg - re) if (le > lg and rg > re) else -1e6

        if s_fe >= s_ef and s_fe > best_score:
            best_score = s_fe
            best_xb = xb
            best_killer_team = "friendly"
            best_lg, best_le, best_rg, best_re = lg, le, rg, re
        elif s_ef > s_fe and s_ef > best_score:
            best_score = s_ef
            best_xb = xb
            best_killer_team = "enemy"
            best_lg, best_le, best_rg, best_re = lg, le, rg, re

    min_plaque_px = max(10, int(55 * scale_x * scale_y))
    if best_killer_team == "friendly":
        has_opposite_plaques = (
            (best_lg >= min_plaque_px)
            and (best_re >= min_plaque_px)
            and (best_lg > best_le * 1.35)
            and (best_re > best_rg * 1.35)
        )
    else:
        has_opposite_plaques = (
            (best_le >= min_plaque_px)
            and (best_rg >= min_plaque_px)
            and (best_le > best_lg * 1.35)
            and (best_rg > best_re * 1.35)
        )

    # Fallback para determinar o time se não houve transição nítida na busca de fronteira
    if best_score < 0:
        mid_x = x_offset + card_w // 2
        if int(np.sum(r_green[:, :mid_x])) >= int(np.sum(r_enemy[:, :mid_x])):
            best_killer_team = "friendly"
        else:
            best_killer_team = "enemy"

    # Caixas de texto do OCR usadas apenas como reforço para boundary_x
    if victim_box_left is not None and (x_offset + 165.0 * scale_x <= victim_box_left <= x_offset + 285.0 * scale_x):
        ocr_xb_est = victim_box_left - 8.0 * scale_x
        if not has_opposite_plaques:
            best_xb = round(ocr_xb_est)
        elif abs(ocr_xb_est - best_xb) <= 16.0 * scale_x:
            best_xb = round(0.8 * best_xb + 0.2 * ocr_xb_est)

    # Localiza o blob branco do ícone da arma no fim da placa do assassino
    b = card_band[:, :, 0].astype(np.int16)
    g = card_band[:, :, 1].astype(np.int16)
    r = card_band[:, :, 2].astype(np.int16)
    max_c = np.maximum(np.maximum(b, g), r)
    min_c = np.minimum(np.minimum(b, g), r)
    white_mask = (max_c > 170) & ((max_c - min_c) < 55)

    search_left = max(x_offset + int(75 * scale_x), best_xb - int(105 * scale_x))
    if killer_box_right is not None and (x_offset + 50.0 * scale_x <= killer_box_right <= best_xb - 22.0 * scale_x):
        search_left = max(search_left, int(killer_box_right + 3.0 * scale_x))
    search_right = max(search_left + int(12 * scale_x), best_xb - int(22 * scale_x))
    search_right = min(w, search_right)

    col_white = np.sum(white_mask[:, search_left:search_right], axis=0) if search_right > search_left else np.array([])
    weapon_cols = np.where(col_white >= max(2, int(2 * scale_y)))[0] + search_left if col_white.size > 0 else np.array([])

    if weapon_cols.size > 0:
        weapon_blob_left = int(weapon_cols[0])
        weapon_blob_right = int(weapon_cols[-1])
        hs_x1 = max(x_offset, min(weapon_blob_right - int(14 * scale_x), best_xb - int(42 * scale_x)))
        hs_x1 = max(hs_x1, best_xb - int(50 * scale_x))
    else:
        weapon_blob_left = max(x_offset, best_xb - int(65 * scale_x))
        weapon_blob_right = max(x_offset, best_xb - int(25 * scale_x))
        hs_x1 = max(x_offset, best_xb - int(44 * scale_x))

    hs_x2 = min(w, best_xb + int(8 * scale_x))
    if hs_x2 - hs_x1 < int(26 * scale_x):
        hs_x1 = max(x_offset, hs_x2 - int(36 * scale_x))

    return {
        "boundary_x": best_xb,
        "killer_team": best_killer_team,
        "victim_team": "enemy" if best_killer_team == "friendly" else "friendly",
        "has_opposite_plaques": bool(has_opposite_plaques),
        "weapon_blob_left": weapon_blob_left,
        "weapon_blob_right": weapon_blob_right,
        "hs_x1": hs_x1,
        "hs_x2": hs_x2,
    }


def segment_killfeed_rows_by_slot(
    kf_res: list,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
) -> list[dict[str, Any]]:
    """
    Segmenta as leituras de OCR do killfeed em linhas individuais ordenadas de cima
    para baixo (Slot 0 a Slot 4, passo vertical nominal de 26px a partir de cy≈41px),
    evitando que int(cy // 35) funda os Slots 0 (cy≈41) e 1 (cy≈67) numa mesma linha.
    Filtra sobreposições de resumo de morte ('killed by') e caixas abaixo do 5º slot.
    """
    if not kf_res:
        return []

    raw_items: list[tuple[float, float, str, Any]] = []
    for item in kf_res:
        box = item[0]
        txt = item[1].strip()
        if not txt or len(txt) < 2:
            continue
        t_low = txt.lower()
        if "killed" in t_low or t_low == "by":
            continue
        cy = (box[0][1] + box[2][1]) / 2.0
        cx = (box[0][0] + box[2][0]) / 2.0
        if cy > 154.0 * scale_y:
            continue
        raw_items.append((cx, cy, txt, box))

    if not raw_items:
        return []

    raw_items.sort(key=lambda x: x[1])
    clusters: list[list[tuple[float, float, str, Any]]] = []
    cluster_tol = 13.0 * scale_y

    for it in raw_items:
        if not clusters:
            clusters.append([it])
        else:
            prev_cy = sum(x[1] for x in clusters[-1]) / len(clusters[-1])
            if abs(it[1] - prev_cy) <= cluster_tol:
                clusters[-1].append(it)
            else:
                clusters.append([it])

    slot_rows: list[dict[str, Any]] = []
    for cl in clusters[:5]:
        cl.sort(key=lambda x: x[0])
        cy_mean = sum(x[1] for x in cl) / len(cl)
        slot_idx = max(0, min(4, round((cy_mean - 41.0 * scale_y) / (26.0 * scale_y))))
        slot_rows.append({
            "slot_idx": slot_idx,
            "cy_mean": cy_mean,
            "items": cl,
        })

    return slot_rows


def build_kill_event(
    round_num: int,
    time_str: str,
    current_time_sec: float,
    killer_nick: str,
    killer_agent: str,
    victim_nick: str,
    victim_agent: str,
    killer_team: str,
    victim_team: str,
    is_headshot: bool,
    is_first_kill: bool
) -> dict:
    """Monta a estrutura de dados de um evento de abate."""
    event_label = "Kill"
    if is_first_kill:
        event_label = "First Kill" if killer_team == "friendly" else "First Death"

    return {
        "round": round_num,
        "time": time_str,
        "timestamp_sec": round(current_time_sec, 2),
        "killer": killer_nick,
        "killer_agent": killer_agent,
        "victim": victim_nick,
        "victim_agent": victim_agent,
        "killer_team": killer_team,
        "victim_team": victim_team,
        "headshot": is_headshot,
        "first_kill": is_first_kill,
        "event_label": event_label,
    }


def validate_score_transition(
    detected_friendly: int,
    detected_enemy: int,
    current_score_friendly: int,
    current_score_enemy: int
) -> tuple[bool, str, int, int, int]:
    """
    Avalia a transição de placar entre frames sucessivos.
    Retorna (is_valid, winner, friendly_diff, enemy_diff, round_increment).
    """
    friendly_diff = detected_friendly - current_score_friendly
    enemy_diff = detected_enemy - current_score_enemy

    is_valid = False
    if (friendly_diff == 1 and enemy_diff == 0) or (enemy_diff == 1 and friendly_diff == 0):
        is_valid = True
    elif 0 <= friendly_diff <= 2 and 0 <= enemy_diff <= 2 and (friendly_diff + enemy_diff > 0):
        is_valid = True

    winner = "friendly" if friendly_diff >= enemy_diff else "enemy"
    round_increment = max(1, friendly_diff + enemy_diff)
    return is_valid, winner, friendly_diff, enemy_diff, round_increment


def create_round_record(
    round_number: int,
    start_time: str,
    end_time: str,
    winner: str,
    friendly_score: int,
    enemy_score: int,
    kills: list[dict],
    start_time_sec: float | None = None,
    end_time_sec: float | None = None,
    buy_phase_start: str | None = None,
    score_before: str | None = None,
) -> dict:
    """Cria o objeto de dados de uma rodada."""
    rec = {
        "round_number": round_number,
        "start_time": start_time,
        "end_time": end_time,
        "winner": winner,
        "winner_team": winner,
        "score_after": f"{friendly_score}-{enemy_score}",
        "kills": kills,
    }
    if start_time_sec is not None:
        rec["start_time_sec"] = round(start_time_sec, 2)
    if end_time_sec is not None:
        rec["end_time_sec"] = round(end_time_sec, 2)
    rec["buy_phase_start"] = buy_phase_start or start_time
    if score_before is not None:
        rec["score_before"] = score_before
    rec["first_blood"] = kills[0] if kills else None
    return rec


def is_match_decided(
    friendly_score: int,
    enemy_score: int,
    rounds_to_win: int = 13,
    overtime_mode: str = "unknown",
) -> bool:
    """
    Verifica se a partida atingiu condição formal de vitória decisiva no Valorant:
    - No regulamento padrão: rounds_to_win (padrão 13) antes do overtime (ex: 13-0 até 13-11).
    - Em prorrogação (quando ambos atingem rounds_to_win - 1, ex: 12-12):
      - 'win-by-two': requer 2 rodadas de vantagem (ex: 14-12, 15-13, 16-14). 13-12 não decide.
      - 'sudden-death': 1 rodada de vantagem decide imediatamente (ex: 13-12).
      - 'unknown' (padrão): não descarta em prorrogação (retorna False para registrar aviso).
    """
    max_s = max(friendly_score, enemy_score)
    min_s = min(friendly_score, enemy_score)
    ot_threshold = rounds_to_win - 1

    # Vitória em tempo regulamentar (antes de atingir prorrogação)
    if max_s == rounds_to_win and min_s < ot_threshold:
        return True

    # Cenário de prorrogação (ambos atingiram ou superaram rounds_to_win - 1)
    if max_s >= rounds_to_win and min_s >= ot_threshold:
        if overtime_mode == "win-by-two":
            return (max_s - min_s) >= 2
        elif overtime_mode == "sudden-death":
            return (max_s - min_s) >= 1
        elif overtime_mode == "unknown":
            return False

    # Margem anômala acima de rounds_to_win com min_s < ot_threshold
    if max_s > rounds_to_win and min_s < ot_threshold:
        return True

    return False


def wrap_up_final_round(
    rounds: list[dict],
    current_round_num: int,
    current_round_start_time: float,
    duration_to_process: float,
    current_score_friendly: int,
    current_score_enemy: int,
    current_round_kills: list[dict],
    rounds_to_win: int = 13,
    overtime_mode: str = "unknown",
    quality_warnings: list[str] | None = None,
) -> list[dict]:
    """
    Fecha a rodada final ao término do vídeo se houver abates pendentes ou nenhuma rodada.
    Se o placar já era decisivo (vitória conquistada), descarta qualquer rodada aberta pós-jogo
    e registra SEMPRE em quality_warnings o motivo do descarte.
    Se a partida atingiu prorrogação com modo 'unknown', preserva a rodada e emite aviso explicativo.
    """
    max_s = max(current_score_friendly, current_score_enemy)
    min_s = min(current_score_friendly, current_score_enemy)
    ot_threshold = rounds_to_win - 1

    if is_match_decided(current_score_friendly, current_score_enemy, rounds_to_win=rounds_to_win, overtime_mode=overtime_mode) and rounds:
        if quality_warnings is not None:
            reason = (
                f"Round espúrio pós-vitória descartado: round {current_round_num} aberto aos "
                f"{format_time(current_round_start_time)} com {len(current_round_kills)} abate(s) "
                f"foi descartado porque a partida já havia sido decidida pelo placar ({current_score_friendly}-{current_score_enemy}) "
                f"sob modo de prorrogação '{overtime_mode}'."
            )
            quality_warnings.append(reason)
        return rounds

    if overtime_mode == "unknown" and max_s >= rounds_to_win and min_s >= ot_threshold:
        if quality_warnings is not None:
            reason = (
                f"Partida em prorrogação com modo de overtime não configurado (--overtime-mode unknown): "
                f"placar ({current_score_friendly}-{current_score_enemy}), rodada {current_round_num} preservada."
            )
            quality_warnings.append(reason)

    if current_round_kills or not rounds:
        rec = {
            "round_number": current_round_num,
            "start_time": format_time(current_round_start_time),
            "end_time": format_time(duration_to_process),
            "winner": "friendly" if current_score_friendly > current_score_enemy else "enemy",
            "score_after": f"{current_score_friendly}-{current_score_enemy}",
            "kills": current_round_kills,
            "start_time_sec": round(current_round_start_time, 2),
            "end_time_sec": round(duration_to_process, 2),
            "buy_phase_start": format_time(current_round_start_time),
            "first_blood": current_round_kills[0] if current_round_kills else None,
        }
        rounds.append(rec)
    return rounds


def should_trigger_implicit_round_rollover(
    current_round_kills: list[dict],
    current_round_start_time: float,
    current_time_sec: float,
    candidate_killer: str,
    candidate_victim: str,
    round_dead_times: dict[str, list[float]],
    victim_team: str,
    roster: dict | None = None,
    min_kills: int = 3,
    min_round_duration_sec: float = 45.0,
    min_silence_gap_sec: float = 25.0,
) -> bool:
    """
    Avalia se deve ocorrer uma Transição Implícita de Rodada por Hiato Biológico
    (assinatura física da vinheta pós-round + Fase de Compra de 30s) quando o
    detector de HUD perdeu a leitura da virada de rodada.

    Condições rigorosas:
    1. A rodada atual possui >= min_kills (padrão 3 abates) e duração >= min_round_duration_sec (padrão 45.0s).
    2. Ocorreu um hiato de silêncio no killfeed >= min_silence_gap_sec (padrão 25.0s) entre o último
       abate aceito e o timestamp atual do candidato.
    3. O novo abate candidato possui pelo menos um jogador identificado do elenco (não é dupla_generica)
       E violaria a unicidade de vítima (um jogador que morreu antes do hiato está morrendo ou matando novamente)
       OU estouraria a capacidade de 5 mortes da equipe.
    """
    if len(current_round_kills) < min_kills:
        return False

    if (current_time_sec - current_round_start_time) < min_round_duration_sec:
        return False

    last_accepted_kill_time = max(
        (float(k.get("timestamp_sec", current_round_start_time)) for k in current_round_kills),
        default=current_round_start_time,
    )

    gap = current_time_sec - last_accepted_kill_time
    if gap < min_silence_gap_sec:
        return False

    # Verifica se o candidato tem ao menos um nome não-genérico
    norm_k = normalize_nick(candidate_killer)
    norm_v = normalize_nick(candidate_victim)
    is_k_gen = (not norm_k) or (norm_k in GENERIC_NICKS) or norm_k.startswith("jogador (")
    is_v_gen = (not norm_v) or (norm_v in GENERIC_NICKS) or norm_v.startswith("jogador (")
    if is_k_gen and is_v_gen:
        return False

    # 1. Violação de unicidade de vítima: vítima morreu antes do hiato de silêncio
    dead_v_times = round_dead_times.get(norm_v, [])
    if dead_v_times and any(t <= last_accepted_kill_time + 10.0 for t in dead_v_times):
        return True

    # 2. Violação de unicidade de assassino: jogador dado como morto antes do hiato agora está matando
    dead_k_times = round_dead_times.get(norm_k, [])
    if dead_k_times and any(t <= last_accepted_kill_time + 10.0 for t in dead_k_times):
        return True

    # 3. Violação de capacidade por equipe: equipe da vítima já atingiu 5 mortes
    team_deaths = sum(1 for k in current_round_kills if k.get("victim_team") == victim_team)
    if team_deaths >= 5:
        return True

    # 4. Violação de capacidade global da rodada: 10 mortes já registradas
    if len(current_round_kills) >= 10:
        return True

    return False


def perform_implicit_round_rollover(
    rounds: list[dict],
    current_round_num: int,
    current_round_start_time: float,
    current_round_kills: list[dict],
    current_score_friendly: int,
    current_score_enemy: int,
    current_time_sec: float,
    last_accepted_kill_time: float | None = None,
) -> tuple[list[dict], int, float, list[dict], int, int]:
    """
    Executa o fechamento implícito da rodada anterior e abertura da nova rodada.
    Retorna:
    (rounds, new_round_num, new_round_start_sec, new_round_kills, new_score_f, new_score_e)
    """
    if last_accepted_kill_time is None:
        last_accepted_kill_time = max(
            (float(k.get("timestamp_sec", current_round_start_time)) for k in current_round_kills),
            default=current_round_start_time,
        )

    round_close_sec = last_accepted_kill_time + 5.0
    if round_close_sec <= current_round_start_time:
        round_close_sec = max(current_round_start_time + 1.0, current_time_sec - 20.0)

    # Determina o vencedor da rodada pelo balanço de mortes
    f_deaths = sum(1 for k in current_round_kills if k.get("victim_team") == "friendly")
    e_deaths = sum(1 for k in current_round_kills if k.get("victim_team") == "enemy")
    if e_deaths > f_deaths:
        winner = "friendly"
        new_score_f = current_score_friendly + 1
        new_score_e = current_score_enemy
    elif f_deaths > e_deaths:
        winner = "enemy"
        new_score_f = current_score_friendly
        new_score_e = current_score_enemy + 1
    else:
        # Se empatado em mortes, padrão inimigo
        winner = "enemy"
        new_score_f = current_score_friendly
        new_score_e = current_score_enemy + 1

    round_rec = create_round_record(
        current_round_num,
        format_time(current_round_start_time),
        format_time(round_close_sec),
        winner,
        new_score_f,
        new_score_e,
        current_round_kills,
        start_time_sec=current_round_start_time,
        end_time_sec=round_close_sec,
        buy_phase_start=format_time(current_round_start_time),
        score_before=f"{current_score_friendly}-{current_score_enemy}",
    )
    rounds.append(round_rec)

    new_round_num = current_round_num + 1
    new_round_start_sec = max(round_close_sec, current_time_sec - 20.0)
    new_round_kills: list[dict] = []

    return rounds, new_round_num, new_round_start_sec, new_round_kills, new_score_f, new_score_e


def split_round_on_score_jump(
    round_number: int,
    start_time_sec: float,
    end_time_sec: float,
    score_before: tuple[int, int],
    detected_score: tuple[int, int],
    kills: list[dict],
    min_round_duration_sec: float = 35.0,
    min_kills_per_subround: int = 2,
    min_silence_gap_sec: float = 25.0,
) -> list[dict]:
    """
    Quando o HUD confirma um salto de placar >= +2 rounds em relação ao score_before,
    divide o bloco em rodadas distintas, localizando o maior hiato temporal entre abates
    consecutivos (>= min_silence_gap_sec) e interpolando o placar intermediário.
    Guarda de Cardinalidade Mínima: recusa a divisão e retorna uma rodada única caso
    qualquer uma das metades resultantes fique com menos de min_kills_per_subround abates.
    """
    f_before, e_before = score_before
    f_det, e_det = detected_score
    f_diff = f_det - f_before
    e_diff = e_det - e_before
    total_jump = f_diff + e_diff

    # Se o salto total não for de pelo menos 2 rounds ou não houver abates suficientes
    # para preencher ambas as metades (min_kills_per_subround em cada), retorna round único
    if total_jump <= 1 or len(kills) < (2 * min_kills_per_subround):
        winner = "friendly" if f_diff > e_diff else "enemy"
        return [
            create_round_record(
                round_number,
                format_time(start_time_sec),
                format_time(end_time_sec),
                winner,
                f_det,
                e_det,
                kills,
                start_time_sec=start_time_sec,
                end_time_sec=end_time_sec,
                buy_phase_start=format_time(start_time_sec),
                score_before=f"{f_before}-{e_before}",
            )
        ]

    # Interpolação para salto de 2 (ex: 5-7 para 5-9 ou 5-9 para 7-9)
    if f_diff == 2 and e_diff == 0:
        w1 = "friendly"
        w2 = "friendly"
        inter_f = f_before + 1
        inter_e = e_before
    elif e_diff == 2 and f_diff == 0:
        w1 = "enemy"
        w2 = "enemy"
        inter_f = f_before
        inter_e = e_before + 1
    elif f_diff >= 1 and e_diff >= 1:
        first_half_kills = [
            k for k in kills
            if float(k.get("timestamp_sec", start_time_sec)) < (start_time_sec + end_time_sec) / 2.0
        ]
        e_deaths_early = sum(1 for k in first_half_kills if k.get("victim_team") == "enemy")
        f_deaths_early = sum(1 for k in first_half_kills if k.get("victim_team") == "friendly")
        if e_deaths_early > f_deaths_early:
            w1 = "friendly"
            w2 = "enemy"
            inter_f = f_before + 1
            inter_e = e_before
        else:
            w1 = "enemy"
            w2 = "friendly"
            inter_f = f_before
            inter_e = e_before + 1
    else:
        w1 = "friendly" if f_diff > e_diff else "enemy"
        w2 = "friendly" if f_diff >= e_diff else "enemy"
        inter_f = f_before + (1 if w1 == "friendly" else 0)
        inter_e = e_before + (1 if w1 == "enemy" else 0)

    # Localização do ponto de corte temporal (t_split)
    t_split = None
    sorted_kills = sorted(kills, key=lambda k: float(k.get("timestamp_sec", start_time_sec)))

    best_gap = -1.0
    best_idx = -1
    for i in range(len(sorted_kills) - 1):
        if (i + 1) < min_kills_per_subround or (len(sorted_kills) - (i + 1)) < min_kills_per_subround:
            continue
        t_curr = float(sorted_kills[i].get("timestamp_sec", start_time_sec))
        t_next = float(sorted_kills[i + 1].get("timestamp_sec", end_time_sec))
        gap = t_next - t_curr
        if gap < min_silence_gap_sec:
            continue
        dur_1 = t_curr - start_time_sec
        dur_2 = end_time_sec - t_next
        if dur_1 >= min_round_duration_sec and dur_2 >= min_round_duration_sec:
            if gap > best_gap:
                best_gap = gap
                best_idx = i

    if best_idx < 0:
        for i in range(len(sorted_kills) - 1):
            if (i + 1) < min_kills_per_subround or (len(sorted_kills) - (i + 1)) < min_kills_per_subround:
                continue
            t_curr = float(sorted_kills[i].get("timestamp_sec", start_time_sec))
            t_next = float(sorted_kills[i + 1].get("timestamp_sec", end_time_sec))
            gap = t_next - t_curr
            if gap >= min_silence_gap_sec and gap > best_gap:
                best_gap = gap
                best_idx = i

    if best_idx < 0:
        # Guarda de Cardinalidade Mínima: recusa a divisão e retorna round único
        winner = "friendly" if f_diff > e_diff else "enemy"
        return [
            create_round_record(
                round_number,
                format_time(start_time_sec),
                format_time(end_time_sec),
                winner,
                f_det,
                e_det,
                kills,
                start_time_sec=start_time_sec,
                end_time_sec=end_time_sec,
                buy_phase_start=format_time(start_time_sec),
                score_before=f"{f_before}-{e_before}",
            )
        ]

    t_last_k = float(sorted_kills[best_idx].get("timestamp_sec", start_time_sec))
    t_next_k = float(sorted_kills[best_idx + 1].get("timestamp_sec", end_time_sec))
    t_split = min(t_last_k + 5.0, (t_last_k + t_next_k) / 2.0)
    t_split = max(start_time_sec + 1.0, min(end_time_sec - 1.0, t_split))

    # Separação dos abates
    r1_kills = []
    r2_kills = []
    for k in sorted_kills:
        k_copy = dict(k)
        if float(k.get("timestamp_sec", start_time_sec)) <= t_split:
            k_copy["round"] = round_number
            r1_kills.append(k_copy)
        else:
            k_copy["round"] = round_number + 1
            r2_kills.append(k_copy)

    rec1 = create_round_record(
        round_number,
        format_time(start_time_sec),
        format_time(t_split),
        w1,
        inter_f,
        inter_e,
        r1_kills,
        start_time_sec=start_time_sec,
        end_time_sec=t_split,
        buy_phase_start=format_time(start_time_sec),
        score_before=f"{f_before}-{e_before}",
    )
    rec2 = create_round_record(
        round_number + 1,
        format_time(t_split),
        format_time(end_time_sec),
        w2,
        f_det,
        e_det,
        r2_kills,
        start_time_sec=t_split,
        end_time_sec=end_time_sec,
        buy_phase_start=format_time(t_split),
        score_before=f"{inter_f}-{inter_e}",
    )
    return [rec1, rec2]


def reconcile_match_rounds_cardinality(
    rounds: list[dict],
    official_friendly_score: int,
    official_enemy_score: int,
) -> list[dict]:
    """
    Reconcilia a lista de rodadas com o total oficial de rodadas N_oficial = score_A + score_B:
    1. Proibição Absoluta de Rodada Vazia: remove qualquer rodada com 0 abates (len(kills) == 0).
    2. Reconciliação de Cardinalidade Pós-Jogo: se len(rounds) > N_oficial, funde micro-rounds
       adjacentes (onde a soma de dois fragmentos tem <= 6 mortes por equipe), priorizando
       rounds com <= 2 abates e menor hiato temporal.
    3. Re-indexa 1..N e atualiza o campo 'round' em todos os abates.
    Preserva a correspondência exata 1:1 entre len(rounds) e N_oficial.
    """
    if not rounds:
        return rounds

    n_official = official_friendly_score + official_enemy_score
    if n_official <= 0:
        return rounds

    # 1. Purga de rodadas vazias (0 abates)
    cleaned_rounds: list[dict] = []
    for r in rounds:
        if len(r.get("kills", [])) > 0:
            cleaned_rounds.append(dict(r))
        else:
            if cleaned_rounds:
                if "end_time" in r:
                    cleaned_rounds[-1]["end_time"] = r["end_time"]
                if "end_time_sec" in r:
                    cleaned_rounds[-1]["end_time_sec"] = r["end_time_sec"]

    if not cleaned_rounds:
        cleaned_rounds = [dict(rounds[0])]

    # 2. Fusão de micro-rounds adjacentes se len(cleaned_rounds) > n_official
    while len(cleaned_rounds) > n_official and len(cleaned_rounds) > 1:
        best_pair_idx = -1
        best_score = float("inf")

        for i in range(len(cleaned_rounds) - 1):
            r_curr = cleaned_rounds[i]
            r_next = cleaned_rounds[i + 1]
            comb_kills = r_curr.get("kills", []) + r_next.get("kills", [])

            f_deaths = sum(1 for k in comb_kills if k.get("victim_team") == "friendly")
            e_deaths = sum(1 for k in comb_kills if k.get("victim_team") == "enemy")

            # Em Valorant, uma rodada com revive tem no máximo 6 mortes por equipe
            if f_deaths <= 6 and e_deaths <= 6:
                k1 = len(r_curr.get("kills", []))
                k2 = len(r_next.get("kills", []))
                min_k = min(k1, k2)

                t1_end = float(r_curr.get("end_time_sec", 0.0))
                t2_start = float(r_next.get("start_time_sec", t1_end))
                gap = max(0.0, t2_start - t1_end)

                # Prioriza rounds muito curtos (<= 2 abates)
                pair_score = min_k * 1000.0 + gap
                if pair_score < best_score:
                    best_score = pair_score
                    best_pair_idx = i

        if best_pair_idx < 0:
            break

        # Executa a fusão do par best_pair_idx e best_pair_idx + 1
        r_a = cleaned_rounds[best_pair_idx]
        r_b = cleaned_rounds[best_pair_idx + 1]
        merged_kills = sorted(
            r_a.get("kills", []) + r_b.get("kills", []),
            key=lambda k: float(k.get("timestamp_sec", 0.0)),
        )
        merged_rec = {
            "round_number": r_a.get("round_number", best_pair_idx + 1),
            "start_time": r_a.get("start_time", "00:00"),
            "start_time_sec": r_a.get("start_time_sec", 0.0),
            "end_time": r_b.get("end_time", r_a.get("end_time", "00:00")),
            "end_time_sec": r_b.get("end_time_sec", r_a.get("end_time_sec", 0.0)),
            "winner": r_b.get("winner", r_a.get("winner", "unknown")),
            "score_before": r_a.get("score_before", "0-0"),
            "score_after": r_b.get("score_after", r_a.get("score_after", "0-0")),
            "kills": merged_kills,
            "buy_phase_start": r_a.get("buy_phase_start", r_a.get("start_time", "00:00")),
            "first_blood": r_a.get("first_blood") or r_b.get("first_blood") or (merged_kills[0] if merged_kills else None),
        }
        cleaned_rounds[best_pair_idx] = merged_rec
        cleaned_rounds.pop(best_pair_idx + 1)

    # 3. Re-indexação estrita 1..N
    for idx, r in enumerate(cleaned_rounds, start=1):
        r["round_number"] = idx
        for k in r.get("kills", []):
            k["round"] = idx
        if r.get("first_blood"):
            r["first_blood"]["round"] = idx

    return cleaned_rounds



def load_roster_file(file_path: str) -> dict:
    """
    Carrega um arquivo JSON contendo os 10 jogadores confirmados pelo usuário
    (por time e agente) para sobrepor a descoberta automática do OCR.
    Formatos aceitos:
    1. {"friendly": [{"nick": "P1", "agent": "Jett"}, ...], "enemy": [{"nick": "E1", "agent": "Omen"}, ...]}
    2. {"players": {"Player1": {"agent": "Jett", "team": "friendly"}, ...}}
    3. {"player1": {"canonical_nick": "Player1", "agent": "Jett", "team": "friendly"}, ...}
    """
    with open(file_path, encoding="utf-8") as f:
        data = json.load(f)

    roster = {}
    if "friendly" in data or "enemy" in data:
        for team in ("friendly", "enemy"):
            members = data.get(team, [])
            if isinstance(members, list):
                for m in members:
                    nick = m.get("nick") or m.get("name") or m.get("canonical_nick", "")
                    agent = m.get("agent", "Agente")
                    norm = normalize_nick(nick)
                    if norm:
                        roster[norm] = {"canonical_nick": nick, "agent": agent, "team": team}
            elif isinstance(members, dict):
                for nick, info in members.items():
                    agent = info.get("agent", "Agente")
                    norm = normalize_nick(nick)
                    if norm:
                        roster[norm] = {"canonical_nick": nick, "agent": agent, "team": team}
    elif "players" in data and isinstance(data["players"], dict):
        for nick, info in data["players"].items():
            agent = info.get("agent", "Agente")
            team = info.get("team", "friendly")
            norm = normalize_nick(nick)
            if norm:
                roster[norm] = {"canonical_nick": nick, "agent": agent, "team": team}
    elif isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, dict) and ("canonical_nick" in v or "agent" in v):
                nick = v.get("canonical_nick", k)
                agent = v.get("agent", "Agente")
                team = v.get("team", "friendly")
                norm = normalize_nick(k)
                if norm:
                    roster[norm] = {"canonical_nick": nick, "agent": agent, "team": team}

    return roster


def promote_consensus_slots(
    roster: dict,
    reads: list[dict],
    min_read_occurrences: int = 2,
    similarity_threshold: float = 0.70,
    quality_warnings: list[str] | None = None,
) -> dict:
    """
    Agrupa leituras não resolvidas do killfeed por time e similaridade léxica,
    promovendo os grupos mais frequentes às vagas vazias/genéricas do elenco.
    """
    if quality_warnings is None:
        quality_warnings = []

    for team, _ in [("friendly", "Aliado"), ("enemy", "Inimigo")]:
        vacant_keys = [
            k for k, v in roster.items()
            if v["team"] == team and v["canonical_nick"].startswith(("Aliado", "Inimigo"))
        ]
        if not vacant_keys:
            continue

        k_vacancies = len(vacant_keys)

        # Jogadores já confirmados neste time (para evitar duplicatas)
        confirmed_norms = {
            normalize_nick(v["canonical_nick"])
            for v in roster.values()
            if v["team"] == team and not v["canonical_nick"].startswith(("Aliado", "Inimigo"))
        }

        # Extrai leituras de killfeed deste time
        kf_reads = [r for r in reads if r.get("region") == "killfeed"]
        row_height = 35
        reads_by_time: dict[float, list[dict]] = {}
        for r in kf_reads:
            t = float(r.get("time_sec", 0.0))
            reads_by_time.setdefault(t, []).append(r)

        unresolved_reads: list[tuple[str, str]] = []

        for t in sorted(reads_by_time.keys()):
            time_reads = reads_by_time[t]
            items_by_row: dict[int, list[tuple[float, str, dict]]] = {}
            for item in time_reads:
                txt = item.get("text", "").strip()
                if not txt or len(txt) < 2:
                    continue
                box = item.get("box", [[0, 0], [0, 0], [0, 0], [0, 0]])
                cy = (box[0][1] + box[2][1]) / 2.0
                cx = (box[0][0] + box[2][0]) / 2.0
                r_idx = int(cy // row_height)
                if 0 <= r_idx < 4:
                    items_by_row.setdefault(r_idx, []).append((cx, txt, item))

            for _, row_items in items_by_row.items():
                row_items.sort(key=lambda x: x[0])
                if len(row_items) >= 2:
                    raw_k = row_items[0][1]
                    conf_k = float(row_items[0][2].get("confidence", 0.0))
                    raw_v = row_items[-1][1]
                    conf_v = float(row_items[-1][2].get("confidence", 0.0))
                elif len(row_items) == 1:
                    if row_items[0][0] < 180:
                        raw_k = row_items[0][1]
                        conf_k = float(row_items[0][2].get("confidence", 0.0))
                        raw_v = ""
                        conf_v = 0.0
                    else:
                        raw_k = ""
                        conf_k = 0.0
                        raw_v = row_items[0][1]
                        conf_v = float(row_items[0][2].get("confidence", 0.0))
                else:
                    continue

                team_hint = row_items[0][2].get("team_hint")
                norm_k = normalize_nick(raw_k)
                norm_v = normalize_nick(raw_v)

                if team_hint in ("friendly", "enemy"):
                    k_team = team_hint
                    v_team = "enemy" if k_team == "friendly" else "friendly"
                elif norm_k in roster and not roster[norm_k]["canonical_nick"].startswith(("Aliado", "Inimigo")):
                    k_team = roster[norm_k]["team"]
                    v_team = "enemy" if k_team == "friendly" else "friendly"
                elif norm_v in roster and not roster[norm_v]["canonical_nick"].startswith(("Aliado", "Inimigo")):
                    v_team = roster[norm_v]["team"]
                    k_team = "enemy" if v_team == "friendly" else "friendly"
                else:
                    continue

                for raw_text, conf_val, r_team in [(raw_k, conf_k, k_team), (raw_v, conf_v, v_team)]:
                    if r_team != team or not raw_text:
                        continue
                    norm = normalize_nick(raw_text)
                    if not norm or len(norm) < 2 or norm.isdigit() or norm in IGNORE_WORDS:
                        continue
                    if any(ag.lower() in norm for ag in VALORANT_AGENTS):
                        continue

                    # Ignora se já for um jogador confirmado deste time
                    is_known = False
                    for ck in confirmed_norms:
                        if ck == norm or (len(ck) >= 4 and (ck in norm or norm in ck)):
                            is_known = True
                            break
                        if difflib.SequenceMatcher(None, norm, ck).ratio() >= 0.65:
                            is_known = True
                            break
                    if not is_known:
                        unresolved_reads.append((raw_text, norm, conf_val))

        # Agrupamento por similaridade
        clusters: list[dict] = []
        for raw_text, norm, conf_val in unresolved_reads:
            matched = False
            for c in clusters:
                if difflib.SequenceMatcher(None, norm, c["norm"]).ratio() >= similarity_threshold:
                    c["count"] += 1
                    c["variants"][raw_text] = c["variants"].get(raw_text, 0) + 1
                    c["confidences"][raw_text] = max(c["confidences"].get(raw_text, 0.0), conf_val)
                    matched = True
                    break
            if not matched:
                clusters.append({
                    "norm": norm,
                    "count": 1,
                    "variants": {raw_text: 1},
                    "confidences": {raw_text: conf_val},
                })

        # Para cada cluster, define o canonical_nick como a variante mais frequente do grupo
        # Desempate por maior confiança e comprimento
        for c in clusters:
            best_variant = sorted(
                c["variants"].items(),
                key=lambda v: (v[1], c["confidences"].get(v[0], 0.0), len(v[0])),
                reverse=True,
            )[0][0]
            c["canonical"] = best_variant
            c["norm"] = normalize_nick(best_variant)

        # Ordena por frequência e filtra por evidência mínima
        clusters.sort(key=lambda x: x["count"], reverse=True)
        eligible = [c for c in clusters if c["count"] >= min_read_occurrences]

        # Promove os K mais frequentes
        to_promote = eligible[:k_vacancies]
        for c in to_promote:
            target_key = vacant_keys.pop(0)
            old_info = roster.pop(target_key)
            new_key = c["norm"]
            roster[new_key] = {
                "canonical_nick": c["canonical"],
                "agent": old_info["agent"],
                "team": team,
            }
            warn_msg = (
                f"Vaga de elenco preenchida por consenso no killfeed: '{c['canonical']}' "
                f"promovido para o time {team} ({c['count']} ocorrência(s), substituindo '{old_info['canonical_nick']}')."
            )
            quality_warnings.append(warn_msg)

    return roster


def parse_ally_roster(raw) -> list[str] | None:
    if not raw:
        return None
    items = []
    if isinstance(raw, str):
        items = [s.strip() for s in raw.split(",")]
    elif isinstance(raw, list):
        items = [str(s).strip() for s in raw]
    elif isinstance(raw, dict) and "friendly" in raw:
        f_val = raw["friendly"]
        if isinstance(f_val, list):
            for x in f_val:
                if isinstance(x, dict):
                    n = x.get("nick") or x.get("name") or x.get("canonical_nick", "")
                    items.append(str(n).strip())
                elif isinstance(x, str):
                    items.append(x.strip())
    else:
        return None

    items = [s for s in items if s]
    if len(items) != 5:
        return None

    norms = [normalize_nick(s) for s in items]
    if any(not n for n in norms):
        return None
    if len(set(norms)) != 5:
        return None

    return items


def discover_closed_roster(
    reads: list[dict],
    user_nick: str | None = None,
    user_agent: str | None = None,
    roster_override: dict | None = None,
    fill_consensus: bool = True,
    min_read_occurrences: int = 2,
    quality_warnings: list[str] | None = None,
    min_agents_per_frame: int = 4,
    ui_terms: set[str] | list[str] | None = None,
    ally_roster: list[str] | str | dict | None = None,
) -> dict:
    """
    Descobre o elenco fechado (exatamente até 5 jogadores por time) ancorado
    na geometria vertical das cartas de agentes e consenso de leituras.
    Filtra frames de pré-jogo por CONTEÚDO (mínimo de agentes detectados na coluna),
    rejeita termos de interface conhecidos (DEFAULT_UI_TERMS) e realiza votação por slot.
    Se roster_override for fornecido, sobrepõe a descoberta automática.
    """
    if roster_override and len(roster_override) > 0:
        enemies_in_override = [k for k, v in roster_override.items() if v.get("team") == "enemy"]
        if enemies_in_override:
            return dict(roster_override)
        if not ally_roster:
            ally_roster = [v["canonical_nick"] for v in roster_override.values() if v.get("team") == "friendly"]

    validated_allies = parse_ally_roster(ally_roster)
    roster = build_initial_roster(user_nick, user_agent)
    active_ui_terms = DEFAULT_UI_TERMS if ui_terms is None else set(ui_terms)

    # Agrupa cartas por time e ancora nos agentes detectados
    for region, team in [("agent_select_left", "friendly"), ("agent_select_right", "enemy")]:
        reg_reads = [r for r in reads if r.get("region") == region]
        if not reg_reads:
            continue

        # 1. Filtro de frames por CONTEÚDO (aceita só frames com >= min_agents_per_frame nomes de agente)
        reads_by_frame: dict[float, list[dict]] = {}
        for r in reg_reads:
            t = float(r.get("time_sec", 0.0))
            reads_by_frame.setdefault(t, []).append(r)

        valid_reg_reads = []
        has_multiple_frames = len(reads_by_frame) > 1 and any(r.get("time_sec") is not None for r in reg_reads)
        if min_agents_per_frame > 0 and has_multiple_frames:
            for _t, f_reads in reads_by_frame.items():
                f_agents = set()
                for r in f_reads:
                    txt = (r.get("text") or "").strip().lower()
                    for ag in VALORANT_AGENTS:
                        if ag.lower() in txt:
                            f_agents.add(ag.lower())
                if len(f_agents) >= min_agents_per_frame:
                    valid_reg_reads.extend(f_reads)
            if not valid_reg_reads:
                valid_reg_reads = reg_reads
        else:
            valid_reg_reads = reg_reads

        # Encontra agentes com suas posições Y nos frames aceitos
        agent_reads = []
        for r in valid_reg_reads:
            txt = (r.get("text") or "").strip()
            box = r.get("box", [[0, 0]])
            y = float(box[0][1])
            for ag in VALORANT_AGENTS:
                if ag.lower() in txt.lower():
                    agent_reads.append((y, ag, float(r.get("confidence", 0.0))))
                    break

        # Remove agentes duplicados muito próximos (mesmo slot lido em frames diferentes)
        agent_reads.sort(key=lambda x: x[0])
        unique_agents = []
        for y, ag, conf in agent_reads:
            if not unique_agents or abs(y - unique_agents[-1][0]) > 40:
                unique_agents.append((y, ag, conf))
            elif conf > unique_agents[-1][2]:
                unique_agents[-1] = (y, ag, conf)

        # Limita a no máximo 5 slots por time
        unique_agents = unique_agents[:5]

        # Rastreia apelidos atribuídos neste time para que um nome só ocupe um slot
        assigned_in_cards = set()
        remaining_allies = list(validated_allies) if (team == "friendly" and validated_allies) else []
        for ay, ag, _ in unique_agents:
            slot_nicks = []
            for r in valid_reg_reads:
                txt = (r.get("text") or "").strip()
                norm = normalize_nick(txt)
                if not txt or len(txt) < 2 or txt.isdigit() or norm in IGNORE_WORDS or norm in active_ui_terms:
                    continue
                if not any(c.isalpha() for c in txt):
                    continue
                if any(a.lower() in txt.lower() for a in VALORANT_AGENTS):
                    continue

                box = r.get("box", [[0, 0], [0, 0]])
                y = float(box[0][1])
                x = float(box[0][0])
                rel_x = (x - 850) if x > 450 else x
                if rel_x > 160:
                    continue

                if abs(y - ay) < 55:
                    slot_nicks.append(r)

            matched_ally = None
            if remaining_allies:
                if user_nick and user_agent and user_agent.lower() == ag.lower():
                    for c in remaining_allies:
                        if normalize_nick(c) == normalize_nick(user_nick):
                            matched_ally = c
                            break

                if not matched_ally and slot_nicks:
                    scored_candidates = []
                    for cand in remaining_allies:
                        cand_norm = normalize_nick(cand)
                        best_cand_score = 0.0
                        for r in slot_nicks:
                            t_str = r.get("text", "").strip()
                            r_norm = normalize_nick(t_str)
                            if not r_norm:
                                continue
                            if cand_norm == r_norm:
                                score = 1.0
                            elif len(cand_norm) >= 4 and (cand_norm in r_norm or r_norm in cand_norm):
                                score = max(0.90, difflib.SequenceMatcher(None, cand_norm, r_norm).ratio())
                            else:
                                score = difflib.SequenceMatcher(None, cand_norm, r_norm).ratio()
                            if score > best_cand_score:
                                best_cand_score = score
                        scored_candidates.append((best_cand_score, cand))
                    scored_candidates.sort(key=lambda x: x[0], reverse=True)
                    if scored_candidates and scored_candidates[0][0] >= 0.50:
                        matched_ally = scored_candidates[0][1]

            if matched_ally:
                best_nick = matched_ally
                remaining_allies.remove(matched_ally)
            else:
                available_nicks = [
                    r for r in slot_nicks
                    if normalize_nick(r.get("text", "")) not in assigned_in_cards
                ]

                if available_nicks:
                    # Votação por slot: variante mais frequente, desempate por confiança e tamanho
                    groups = {}
                    for r in available_nicks:
                        t_str = r.get("text", "").strip()
                        n_str = normalize_nick(t_str)
                        conf = float(r.get("confidence", 0.0))
                        if n_str not in groups:
                            groups[n_str] = {"variants": Counter(), "max_conf": 0.0, "total_votes": 0}
                        groups[n_str]["variants"][t_str] += 1
                        groups[n_str]["total_votes"] += 1
                        if conf > groups[n_str]["max_conf"]:
                            groups[n_str]["max_conf"] = conf

                    sorted_groups = sorted(
                        groups.items(),
                        key=lambda item: (item[1]["total_votes"], item[1]["max_conf"]),
                        reverse=True,
                    )
                    _best_norm, best_info = sorted_groups[0]
                    best_variant = sorted(
                        best_info["variants"].items(),
                        key=lambda v: (v[1], len(v[0])),
                        reverse=True,
                    )[0][0]
                    best_nick = best_variant
                else:
                    best_nick = f"{'Aliado' if team == 'friendly' else 'Inimigo'} ({ag})"

            norm = normalize_nick(best_nick)
            assigned_in_cards.add(norm)
            if len([k for k, v in roster.items() if v["team"] == team]) < 5 or norm in roster:
                roster[norm] = {
                    "canonical_nick": best_nick,
                    "agent": ag,
                    "team": team,
                }

    # Se um time tiver menos de 5 jogadores, preenche com placeholders estruturados
    for team, label in [("friendly", "Aliado"), ("enemy", "Inimigo")]:
        current_count = len([k for k, v in roster.items() if v["team"] == team])
        for i in range(current_count, 5):
            slot_name = f"{label} {i + 1}"
            norm = normalize_nick(slot_name)
            if norm not in roster:
                roster[norm] = {
                    "canonical_nick": slot_name,
                    "agent": "Agente",
                    "team": team,
                }

    # Preenchimento por consenso no killfeed
    if fill_consensus and reads:
        promote_consensus_slots(
            roster,
            reads,
            min_read_occurrences=min_read_occurrences,
            quality_warnings=quality_warnings,
        )

    return roster


def consolidate_players_stats(all_kills: list[dict], roster: dict) -> dict:
    """
    Consolida as estatísticas individuais de cada jogador a partir
    dos abates de todas as rodadas e do elenco fechado (5 por time).
    Jogadores desconhecidos ou leituras de ruído NÃO entram no scoreboard.
    """
    players_stats = {}
    norm_to_canonical = {}
    for _, info in roster.items():
        canonical = info["canonical_nick"]
        players_stats[canonical] = {
            "agent": info["agent"],
            "team": info["team"],
            "kills": 0,
            "deaths": 0,
            "assists": 0,
            "headshots": 0,
            "first_kills": 0,
            "first_deaths": 0,
            "headshot_rate": 0.0,
            "kd_ratio": 0.0,
        }
        norm_key = normalize_nick(canonical)
        if norm_key:
            norm_to_canonical[norm_key] = canonical

    for k in all_kills:
        killer = k.get("killer")
        victim = k.get("victim")

        k_norm = normalize_nick(killer) if killer else None
        v_norm = normalize_nick(victim) if victim else None

        k_can = norm_to_canonical.get(k_norm) if k_norm else None
        v_can = norm_to_canonical.get(v_norm) if v_norm else None

        if not k_can and k_norm:
            for cn, can_name in norm_to_canonical.items():
                if cn == k_norm or (len(cn) >= 4 and (cn in k_norm or k_norm in cn)):
                    k_can = can_name
                    break
                if len(cn) >= 3 and len(k_norm) >= 3 and difflib.SequenceMatcher(None, cn, k_norm).ratio() >= 0.75:
                    k_can = can_name
                    break

        if not v_can and v_norm:
            for cn, can_name in norm_to_canonical.items():
                if cn == v_norm or (len(cn) >= 4 and (cn in v_norm or v_norm in cn)):
                    v_can = can_name
                    break
                if len(cn) >= 3 and len(v_norm) >= 3 and difflib.SequenceMatcher(None, cn, v_norm).ratio() >= 0.75:
                    v_can = can_name
                    break

        if k_can and k_can in players_stats:
            if players_stats[k_can]["agent"] == "Agente" and k.get("killer_agent"):
                players_stats[k_can]["agent"] = k["killer_agent"]
            players_stats[k_can]["kills"] += 1
            if k.get("headshot"):
                players_stats[k_can]["headshots"] += 1
            if k.get("first_kill"):
                players_stats[k_can]["first_kills"] += 1

        if v_can and v_can in players_stats:
            if players_stats[v_can]["agent"] == "Agente" and k.get("victim_agent"):
                players_stats[v_can]["agent"] = k["victim_agent"]
            players_stats[v_can]["deaths"] += 1
            if k.get("first_kill"):
                players_stats[v_can]["first_deaths"] += 1

    # Calcula taxas derivadas (HS% e K/D) e preserva abates do feed
    for _, s in players_stats.items():
        s["feed_kills"] = s["kills"]
        s["feed_deaths"] = s["deaths"]
        s["headshot_rate"] = round((s["headshots"] / s["kills"] * 100), 1) if s["kills"] > 0 else 0.0
        s["kd_ratio"] = round(s["kills"] / s["deaths"], 2) if s["deaths"] > 0 else float(s["kills"])

    return players_stats


def locate_scoreboard_columns_by_headers(
    res: list,
    kda_items: list[dict],
    scale_x: float = 1.0,
    crop_x_offset: float = 0.0,
) -> tuple[dict[str, float], dict[str, float]]:
    """
    Localiza as coordenadas horizontais X (em pixels absolutos do frame) das colunas
    complementares de estatísticas (First Bloods, Plants, Defuses) a partir dos
    cabeçalhos detectados pelo OCR ou pela estrutura espacial da grade relativa ao KDA.
    """
    detected_headers: dict[str, float] = {}
    for r in res:
        box, txt = r[0], r[1].strip()
        cx_crop = (box[0][0] + box[2][0]) / (2.0 * 1.5)
        cy_crop = (box[0][1] + box[2][1]) / (2.0 * 1.5)
        cx_abs = cx_crop + crop_x_offset
        t_clean = "".join(c for c in txt.lower() if c.isalnum())

        # Cabeçalhos situam-se no topo da tabela (cy_crop < 45)
        if cy_crop < 45.0 * scale_x:
            if "kda" in t_clean and "kda" not in detected_headers:
                detected_headers["kda"] = cx_abs
            elif any(w in t_clean for w in ["first", "blood", "blooo", "fb"]) and "fb" not in detected_headers:
                detected_headers["fb"] = cx_abs
            elif any(w in t_clean for w in ["plant", "plnt"]) and "plants" not in detected_headers:
                detected_headers["plants"] = cx_abs
            elif any(w in t_clean for w in ["defuse", "dfs"]) and "defuses" not in detected_headers:
                detected_headers["defuses"] = cx_abs

    # Ponto de ancoragem na coluna KDA
    if "kda" in detected_headers:
        kda_x = detected_headers["kda"]
    elif kda_items:
        import numpy as np

        kda_x = float(np.median([k["cx"] for k in kda_items])) + crop_x_offset
    else:
        kda_x = 671.0 * scale_x

    # Passo estrutural horizontal entre colunas (grade de 138 px nominais em 1280x720)
    if "fb" in detected_headers:
        step_x = detected_headers["fb"] - kda_x
    elif "plants" in detected_headers:
        step_x = (detected_headers["plants"] - kda_x) / 2.0
    elif "defuses" in detected_headers:
        step_x = (detected_headers["defuses"] - kda_x) / 3.0
    else:
        step_x = 138.0 * scale_x

    cols = {
        "fb": detected_headers.get("fb", kda_x + step_x),
        "plants": detected_headers.get("plants", kda_x + 2.0 * step_x),
        "defuses": detected_headers.get("defuses", kda_x + 3.0 * step_x),
    }
    return cols, detected_headers


def parse_agent_select_bottom_cards(
    ocr_res: list,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
) -> list[dict]:
    """
    Interpreta leituras de OCR da barra inferior da tela de selecao de agentes
    (regiao horizontal central com os 5 cards de jogadores e agentes aliados).
    Retorna lista de ate 5 dicts: [{'nick': '...', 'agent': '...', 'team': 'friendly'}, ...] ordenados por X.
    """
    if not ocr_res:
        return []
    agents_lower = {a.lower(): a for a in VALORANT_AGENTS}
    nicks = []
    agents = []
    ui_ignore = {
        "公", "team:", "...", "lock in", "locked in", "custom", "standard",
        "picking...", "picking", "select", "choose", "info", "overview"
    }

    for r in ocr_res:
        box, txt = r[0], r[1].strip()
        cx = (box[0][0] + box[2][0]) / 2.0
        cy = (box[0][1] + box[2][1]) / 2.0
        txt_l = txt.lower()

        matched_ag = None
        for ag_l, ag_orig in agents_lower.items():
            if ag_l == txt_l or (len(txt_l) >= 4 and ag_l in txt_l):
                matched_ag = ag_orig
                break

        if matched_ag:
            agents.append({"cx": cx, "cy": cy, "agent": matched_ag})
        elif txt_l not in ui_ignore and len(txt) >= 3 and not txt_l.startswith("pick"):
            nicks.append({"cx": cx, "cy": cy, "nick": txt})

    slots = []
    for n in sorted(nicks, key=lambda x: x["cx"]):
        cand_agents = [a for a in agents if abs(a["cx"] - n["cx"]) < 70.0 * scale_x]
        ag = cand_agents[0]["agent"] if cand_agents else "Agente"
        slots.append({"nick": n["nick"], "agent": ag, "team": "friendly"})

    return slots[:5]


def parse_scoreboard_ocr(
    res: list,
    roster: dict,
    scale_y: float = 1.0,
    frame: Any = None,
    ocr_engine: Any = None,
    scale_x: float = 1.0,
    crop_y_offset: int = 0,
    crop_x_offset: int = 0,
) -> dict[str, dict]:
    """
    Interpreta leituras de OCR da tela de Scoreboard/Placar oficial.
    Associa cada linha KDA (Kills/Deaths/Assists) e colunas complementares
    (First Bloods, Plants, Defuses) aos jogadores do elenco fechado (roster).
    Localiza colunas de forma dinâmica e estrutural por cabeçalhos ou distância gradeada.
    """
    if not res:
        return {}

    kda_items = []
    name_items = []

    for r in res:
        box, txt = r[0], r[1].strip()
        conf = float(r[2]) if len(r) > 2 else 1.0
        cy = (box[0][1] + box[2][1]) / (2.0 * 1.5)
        cx = (box[0][0] + box[2][0]) / (2.0 * 1.5)
        m = KDA_PATTERN.match(txt)
        if m:
            kda_items.append({
                "cy": cy,
                "cx": cx,
                "kills": int(m.group(1)),
                "deaths": int(m.group(2)),
                "assists": int(m.group(3)),
                "conf": conf,
            })
        else:
            name_items.append({"cy": cy, "cx": cx, "text": txt, "conf": conf})

    if not kda_items:
        return {}

    kda_sorted = sorted(kda_items, key=lambda x: x["cy"])

    # Localização dinâmica e estrutural das colunas por cabeçalhos
    col_x_map, _ = locate_scoreboard_columns_by_headers(
        res,
        kda_items,
        scale_x=scale_x,
        crop_x_offset=crop_x_offset,
    )
    import cv2

    char_map = {"ld": 5, "d": 0, "o": 0, "i": 1, "l": 1, "s": 5, "b": 8, "z": 2}
    cell_fx = max(2.0, 2.0 / scale_y) if scale_y > 0 else 2.0

    for k in kda_sorted:
        k["fb"] = 0
        k["plants"] = 0
        k["defuses"] = 0
        k["row_team"] = None
        if frame is not None and hasattr(frame, "shape"):
            cy_abs = crop_y_offset + k["cy"]
            y_a = max(0, int(cy_abs - 16 * scale_y))
            y_b = min(frame.shape[0], int(cy_abs + 16 * scale_y))
            band_x1 = max(0, int(crop_x_offset + 30 * scale_x))
            band_x2 = min(frame.shape[1], int(crop_x_offset + 380 * scale_x))
            if y_b > y_a and band_x2 > band_x1:
                import numpy as np

                row_band = frame[y_a:y_b, band_x1:band_x2]
                r_minus_g = float(
                    np.mean(row_band[:, :, 2].astype(np.float32) - row_band[:, :, 1].astype(np.float32))
                )
                k["row_team"] = "enemy" if r_minus_g > 15.0 else "friendly"

            if ocr_engine is not None:
                for col_key, cx_abs in col_x_map.items():
                    x_a = max(0, int(cx_abs - 25 * scale_x))
                    x_b = min(frame.shape[1], int(cx_abs + 25 * scale_x))
                    if y_b > y_a and x_b > x_a:
                        cell_crop = frame[y_a:y_b, x_a:x_b]
                        cell_up = cv2.resize(cell_crop, (0, 0), fx=cell_fx, fy=cell_fx, interpolation=cv2.INTER_CUBIC)
                        c_res, _ = ocr_engine(cell_up)
                        if c_res:
                            txt_val = c_res[0][1].strip().lower()
                            digits = "".join(c for c in txt_val if c.isdigit())
                            if digits:
                                k[col_key] = int(digits)
                            elif txt_val in char_map:
                                k[col_key] = char_map[txt_val]

    matched_players = {}
    unmatched_rows = []

    roster_canonicals = {
        info["canonical_nick"]: info
        for info in roster.values()
        if not str(info.get("canonical_nick", "")).startswith(("Aliado", "Inimigo"))
    }
    y_tol = 20.0 * scale_y

    for k in kda_sorted:
        cands = [n for n in name_items if abs(n["cy"] - k["cy"]) <= y_tol and n["cx"] < k["cx"] - 30]
        cands.sort(key=lambda n: n["cx"])
        name_cands = [
            n
            for n in cands
            if n["cx"] < k["cx"] - 85 * scale_x or not n["text"].strip().isdigit()
        ]
        raw_name = " ".join(n["text"] for n in name_cands).strip() if name_cands else ""

        if not raw_name and frame is not None and ocr_engine is not None and hasattr(frame, "shape"):
            cy_abs = crop_y_offset + k["cy"]
            y_a = max(0, int(cy_abs - 15 * scale_y))
            y_b = min(frame.shape[0], int(cy_abs + 15 * scale_y))
            nx1 = max(0, int(crop_x_offset + 65 * scale_x))
            nx2 = min(frame.shape[1], int(crop_x_offset + 245 * scale_x))
            if y_b > y_a and nx2 > nx1:
                ncrop = frame[y_a:y_b, nx1:nx2]
                nup = cv2.resize(ncrop, (0, 0), fx=cell_fx, fy=cell_fx, interpolation=cv2.INTER_CUBIC)
                n_res, _ = ocr_engine(nup)
                if n_res:
                    raw_name = " ".join(r[1].strip() for r in n_res if r[1].strip()).strip()

        k["raw_name"] = raw_name
        norm_row = normalize_nick(raw_name)

        best_canonical = None
        best_ratio = 0.0

        for canonical in roster_canonicals:
            if canonical in matched_players:
                continue
            c_norm = normalize_nick(canonical)
            if not norm_row or not c_norm:
                continue
            if c_norm == norm_row or c_norm in norm_row or norm_row in c_norm:
                best_canonical = canonical
                break
            ratio = difflib.SequenceMatcher(None, c_norm, norm_row).ratio()
            if ratio > best_ratio and ratio >= 0.55:
                best_ratio = ratio
                best_canonical = canonical

        if best_canonical:
            matched_players[best_canonical] = {
                "kills": k["kills"],
                "deaths": k["deaths"],
                "assists": k["assists"],
                "first_bloods": k.get("fb", 0),
                "plants": k.get("plants", 0),
                "defuses": k.get("defuses", 0),
                "confidence": k["conf"],
                "source": "scoreboard_direct",
                "team": roster_canonicals[best_canonical].get("team", k.get("row_team") or "friendly"),
            }
        else:
            unmatched_rows.append(k)

    # Eliminação fechada: se falta apenas 1 jogador conhecido no roster e sobrou exatamente 1 linha KDA
    unmatched_canonicals = [c for c in roster_canonicals if c not in matched_players]
    if len(unmatched_canonicals) == 1 and len(unmatched_rows) == 1:
        rem_player = unmatched_canonicals[0]
        rem_k = unmatched_rows[0]
        matched_players[rem_player] = {
            "kills": rem_k["kills"],
            "deaths": rem_k["deaths"],
            "assists": rem_k["assists"],
            "first_bloods": rem_k.get("fb", 0),
            "plants": rem_k.get("plants", 0),
            "defuses": rem_k.get("defuses", 0),
            "confidence": rem_k["conf"],
            "source": "scoreboard_elimination",
            "team": roster_canonicals[rem_player].get("team", rem_k.get("row_team") or "friendly"),
        }
        unmatched_rows = []

    # Extração direta da tela final (ex.: modo --scoreboard-only sem roster prévio)
    for idx_u, rem_k in enumerate(unmatched_rows, 1):
        raw_n = rem_k.get("raw_name", "").strip()
        r_team = rem_k.get("row_team") or ("friendly" if idx_u <= 5 else "enemy")
        player_key = raw_n if raw_n else f"{'Aliado' if r_team == 'friendly' else 'Inimigo'} {idx_u}"
        if player_key in matched_players:
            player_key = f"{player_key}_{idx_u}"
        matched_players[player_key] = {
            "kills": rem_k["kills"],
            "deaths": rem_k["deaths"],
            "assists": rem_k["assists"],
            "first_bloods": rem_k.get("fb", 0),
            "plants": rem_k.get("plants", 0),
            "defuses": rem_k["defuses"],
            "confidence": rem_k["conf"],
            "source": "scoreboard_direct",
            "team": r_team,
        }
        if isinstance(roster, dict):
            # Substitui vaga genérica do mesmo time ou adiciona ao roster
            replaced = False
            for r_k, r_inf in list(roster.items()):
                if r_inf.get("team") == r_team and str(r_inf.get("canonical_nick", "")).startswith(("Aliado", "Inimigo")):
                    del roster[r_k]
                    roster[normalize_nick(player_key)] = {
                        "canonical_nick": player_key,
                        "agent": r_inf.get("agent", "Agente"),
                        "team": r_team,
                    }
                    replaced = True
                    break
            if not replaced:
                current_team_count = sum(1 for v in roster.values() if v.get("team") == r_team)
                if current_team_count < 5:
                    roster[normalize_nick(player_key)] = {
                        "canonical_nick": player_key,
                        "agent": "Agente",
                        "team": r_team,
                    }

    return matched_players


def parse_postmatch_score_banner(
    frame: Any,
    ocr_engine: Any,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    scoreboard_data: dict[str, dict] | None = None,
) -> dict[str, Any] | None:
    """
    Extrai o placar final (friendly vs enemy) e total de rodadas a partir do banner
    superior esquerdo da tela de Resumo Pós-Jogo ('13 VICTORY 12', '11 DEFEAT 13', etc.)
    ou do HUD superior em jogo.
    """
    if frame is None or ocr_engine is None or not hasattr(frame, "shape"):
        return None

    import cv2

    h, w = frame.shape[:2]
    total_fb = (
        sum(int(p.get("first_bloods", p.get("fb", 0))) for p in scoreboard_data.values())
        if scoreboard_data
        else 0
    )

    # 1. Tenta ler o banner de resultado pós-jogo (ex.: '13 VICTORY 12' / '11 DEFEAT 13')
    by1, by2 = max(0, int(68 * scale_y)), min(h, int(150 * scale_y))
    bx1, bx2 = max(0, int(15 * scale_x)), min(w, int(310 * scale_x))
    if by2 > by1 and bx2 > bx1:
        b_crop = frame[by1:by2, bx1:bx2]
        b_up = cv2.resize(b_crop, (0, 0), fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        b_res, _ = ocr_engine(b_up)
        if b_res:
            tokens = sorted(
                [(float(r[0][0][0] + r[0][2][0]) / 2.0, r[1].strip()) for r in b_res if r[1].strip()],
                key=lambda x: x[0],
            )
            joined = " ".join(t[1] for t in tokens).upper()
            m = re.search(
                r"(\d{1,2})\s*(VICTORY|DEFEAT|VITORIA|VITÓRIA|DERROTA|DRAW|EMPATE|[A-Z]{4,})\s*(\d{1,2})",
                joined,
            )
            if m:
                f_val = int(m.group(1))
                outcome = m.group(2)
                e_val = int(m.group(3))
                # Na fonte Tungsten Bold do pós-jogo, '13' pode ser lido como '17' (barra superior do 3)
                if total_fb >= 12 and (f_val + e_val) not in (total_fb, total_fb + 1):
                    if f_val == 17 and (13 + e_val) in (total_fb, total_fb + 1):
                        f_val = 13
                    elif e_val == 17 and (f_val + 13) in (total_fb, total_fb + 1):
                        e_val = 13
                return {
                    "friendly": f_val,
                    "enemy": e_val,
                    "rounds_count": f_val + e_val,
                    "outcome": outcome,
                }

    # 2. Fallback: HUD superior de partida em andamento (quando o placar Tab foi aberto no fim do último round)
    hy1, hy2 = 0, min(h, int(70 * scale_y))
    hx1, hx2 = max(0, int(450 * scale_x)), min(w, int(830 * scale_x))
    if hy2 > hy1 and hx2 > hx1:
        h_crop = frame[hy1:hy2, hx1:hx2]
        h_res, _ = ocr_engine(h_crop)
        if h_res:
            f_digs, e_digs = [], []
            for item in h_res:
                txt = item[1].strip()
                if txt.isdigit():
                    val = int(txt)
                    if 0 <= val <= 25:
                        cx = (item[0][0][0] + item[0][1][0]) / (2.0 * scale_x)
                        if cx < 140:
                            f_digs.append(val)
                        elif cx > 240:
                            e_digs.append(val)
            if f_digs and e_digs:
                return {
                    "friendly": f_digs[0],
                    "enemy": e_digs[0],
                    "rounds_count": f_digs[0] + e_digs[0],
                    "outcome": "HUD",
                }

    return None


def validate_scoreboard_consistency(
    scoreboard_data: dict[str, dict],
    roster: dict | None = None,
    final_score: dict | None = None,
    rounds_count: int | None = None,
    max_diff: int = 3,
) -> tuple[bool, list[str]]:
    """
    Valida a leitura do placar com verificações de consistência física e matemática do Valorant:
    1. 5 jogadores por time (5 aliados e 5 inimigos).
    2. Kills do time <= mortes do outro time, com margem pequena configurável (max_diff, padrão: 3)
       para cobrir mortes ambientais (queda, dano de habilidade própria) e detonação da Spike.
    3. Placar final somado = total de rounds.
    4. First bloods somados em {rounds, rounds-1} (pelo menos 1 abate ou round resolvido por tempo/spike).
    """
    warnings = []
    if not scoreboard_data:
        return False, ["Scoreboard vazio ou não detectado."]

    friendly_players = []
    enemy_players = []

    for name, p_data in scoreboard_data.items():
        team = p_data.get("team")
        if not team and roster:
            if name in roster:
                team = roster[name].get("team")
            else:
                n_norm = normalize_nick(name)
                for r_name, r_info in roster.items():
                    if normalize_nick(r_name) == n_norm:
                        team = r_info.get("team")
                        break
        if team == "friendly":
            friendly_players.append((name, p_data))
        elif team == "enemy":
            enemy_players.append((name, p_data))

    if len(friendly_players) != 5 or len(enemy_players) != 5:
        warnings.append(
            f"Scoreboard inconsistente: contagem de jogadores inválida "
            f"({len(friendly_players)} aliados, {len(enemy_players)} inimigos, esperado: 5 de cada time)."
        )

    if friendly_players and enemy_players:
        ally_kills = sum(p.get("kills", 0) for _, p in friendly_players)
        ally_deaths = sum(p.get("deaths", 0) for _, p in friendly_players)
        enemy_kills = sum(p.get("kills", 0) for _, p in enemy_players)
        enemy_deaths = sum(p.get("deaths", 0) for _, p in enemy_players)

        # Regra de ouro: kills do time <= mortes do adversário
        if ally_kills > enemy_deaths:
            warnings.append(
                f"Scoreboard inconsistente: kills aliados ({ally_kills}) superam mortes inimigas ({enemy_deaths})."
            )
        elif (enemy_deaths - ally_kills) > max_diff:
            warnings.append(
                f"Scoreboard inconsistente: mortes inimigas ({enemy_deaths}) superam kills aliados ({ally_kills}) "
                f"além da margem ambiental configurada (diferença: {enemy_deaths - ally_kills} > {max_diff})."
            )

        if enemy_kills > ally_deaths:
            warnings.append(
                f"Scoreboard inconsistente: kills inimigos ({enemy_kills}) superam mortes aliadas ({ally_deaths})."
            )
        elif (ally_deaths - enemy_kills) > max_diff:
            warnings.append(
                f"Scoreboard inconsistente: mortes aliadas ({ally_deaths}) superam kills inimigos ({enemy_kills}) "
                f"além da margem ambiental configurada (diferença: {ally_deaths - enemy_kills} > {max_diff})."
            )

    if final_score and rounds_count is not None and rounds_count > 0:
        score_sum = final_score.get("friendly", 0) + final_score.get("enemy", 0)
        if score_sum != rounds_count:
            warnings.append(
                f"Scoreboard inconsistente: soma do placar ({score_sum}) diverge do total de rodadas ({rounds_count})."
            )

    has_fb = any("first_bloods" in p or "fb" in p for _, p in friendly_players + enemy_players)
    if has_fb and rounds_count is not None and rounds_count > 0:
        total_fb = sum(p.get("first_bloods", p.get("fb", 0)) for _, p in friendly_players + enemy_players)
        if total_fb not in (rounds_count, rounds_count - 1):
            warnings.append(
                f"Scoreboard inconsistente: soma de first bloods ({total_fb}) diverge das rodadas ({rounds_count} ou {rounds_count - 1})."
            )

    is_valid = len(warnings) == 0
    return is_valid, warnings


def reconcile_players_stats_with_scoreboard(
    players_stats: dict,
    scoreboard_data: dict[str, dict],
    roster: dict | None = None,
    final_score: dict | None = None,
    rounds_count: int | None = None,
    validate_consistency: bool = False,
    max_diff: int = 3,
) -> tuple[dict, list[str]]:
    """
    Reconcilia as estatísticas individuais com o Scoreboard oficial da partida.
    Atualiza kills, deaths, assists, first_bloods, plants, defuses e recalcula taxas derivadas
    com 100% de precisão oficial, preservando feed_kills, feed_deaths e feed_first_kills para diferenciação.
    Se validate_consistency for True e a validação falhar, aborta a aplicação do placar,
    mantém os valores do killfeed e retorna os avisos para quality.warnings.
    """
    notes = []
    if not scoreboard_data:
        return players_stats, notes

    if validate_consistency:
        is_valid, consistency_warnings = validate_scoreboard_consistency(
            scoreboard_data,
            roster=roster,
            final_score=final_score,
            rounds_count=rounds_count,
            max_diff=max_diff,
        )
        if not is_valid:
            notes.extend(consistency_warnings)
            notes.append("Scoreboard rejeitado por inconsistência matemática. Mantidos valores do killfeed.")
            for s in players_stats.values():
                s.setdefault("feed_kills", s.get("kills", 0))
                s.setdefault("feed_deaths", s.get("deaths", 0))
                s.setdefault("feed_first_kills", s.get("first_kills", 0))
                s["scoreboard_verified"] = False
            return players_stats, notes

    reconciled_count = 0
    for name, s in players_stats.items():
        s.setdefault("feed_kills", s.get("kills", 0))
        s.setdefault("feed_deaths", s.get("deaths", 0))
        s.setdefault("feed_first_kills", s.get("first_kills", 0))

        if name in scoreboard_data:
            sb = scoreboard_data[name]
            diff_k = sb["kills"] - s.get("kills", 0)
            diff_d = sb["deaths"] - s.get("deaths", 0)

            s["kills"] = sb["kills"]
            s["deaths"] = sb["deaths"]
            s["assists"] = sb["assists"]
            if "first_bloods" in sb:
                s["first_kills"] = sb["first_bloods"]
                s["first_bloods"] = sb["first_bloods"]
            elif "fb" in sb:
                s["first_kills"] = sb["fb"]
                s["first_bloods"] = sb["fb"]
            if "plants" in sb:
                s["plants"] = sb["plants"]
            if "defuses" in sb:
                s["defuses"] = sb["defuses"]
            if sb.get("team") in ("friendly", "enemy") and s.get("team") not in ("friendly", "enemy"):
                s["team"] = sb["team"]
            s["scoreboard_verified"] = True

            # Recalcula K/D e HS% com os totais oficiais
            s["kd_ratio"] = round(s["kills"] / s["deaths"], 2) if s["deaths"] > 0 else float(s["kills"])
            s["headshot_rate"] = round((s["headshots"] / s["kills"] * 100), 1) if s["kills"] > 0 else 0.0

            reconciled_count += 1
            if diff_k != 0 or diff_d != 0:
                notes.append(
                    f"Scoreboard reconciliado para {name}: kills {diff_k:+d}, deaths {diff_d:+d} (oficial: {sb['kills']}K/{sb['deaths']}D/{sb['assists']}A)"
                )

    # Closed elimination pairing: se sobrou 1 jogador em players_stats do mesmo time e 1 em scoreboard_data
    unmatched_ps = [p for p, s in players_stats.items() if not s.get("scoreboard_verified")]
    matched_sb_keys = {p for p in players_stats if players_stats[p].get("scoreboard_verified")}
    unmatched_sb = [k for k in scoreboard_data if k not in matched_sb_keys]

    for team in ("friendly", "enemy"):
        team_ps = [p for p in unmatched_ps if players_stats[p].get("team") == team or str(p).lower().startswith("aliado" if team == "friendly" else "inimigo")]
        team_sb = [k for k in unmatched_sb if scoreboard_data[k].get("team") == team or str(k).lower().startswith("aliado" if team == "friendly" else "inimigo")]
        if len(team_ps) == 1 and len(team_sb) == 1:
            p_name = team_ps[0]
            sb_k = team_sb[0]
            s = players_stats[p_name]
            sb = scoreboard_data[sb_k]
            diff_k = sb["kills"] - s.get("kills", 0)
            diff_d = sb["deaths"] - s.get("deaths", 0)
            s["kills"] = sb["kills"]
            s["deaths"] = sb["deaths"]
            s["assists"] = sb["assists"]
            s["first_kills"] = sb.get("first_bloods", sb.get("fb", 0))
            s["first_bloods"] = s["first_kills"]
            s["plants"] = sb.get("plants", 0)
            s["defuses"] = sb.get("defuses", 0)
            s["team"] = team
            s["scoreboard_verified"] = True
            s["kd_ratio"] = round(s["kills"] / s["deaths"], 2) if s["deaths"] > 0 else float(s["kills"])
            s["headshot_rate"] = round((s["headshots"] / s["kills"] * 100), 1) if s["kills"] > 0 else 0.0
            reconciled_count += 1
            notes.append(
                f"Scoreboard reconciliado por eliminação para {p_name} ({sb_k}): kills {diff_k:+d}, deaths {diff_d:+d} (oficial: {sb['kills']}K/{sb['deaths']}D/{sb['assists']}A)"
            )

    if reconciled_count > 0:
        notes.append(
            f"Estatísticas sincronizadas com o Scoreboard oficial da partida ({reconciled_count}/{len(players_stats)} jogadores verificados com 100% de precisão)."
        )

    return players_stats, notes



def generate_quality_warnings(
    rounds: list[dict],
    final_score: dict,
    roster: dict,
    players_stats: dict,
    is_truncated: bool = False,
) -> list[str]:
    """
    Gera avisos de qualidade diagnósticos sobre a análise executada.
    Se is_truncated for True (ex: execução truncada por --max-seconds),
    suprime a discrepância entre contagem de rodadas e placar.
    """
    warnings = []

    # 1. Checagem de discrepância entre placar e número de rodadas
    # Suprimida quando a análise foi truncada intencionalmente por --max-seconds
    if not is_truncated:
        f_score = final_score.get("friendly", 0)
        e_score = final_score.get("enemy", 0)
        decided_rounds = f_score + e_score
        rounds_count = len(rounds)
        if rounds_count != decided_rounds:
            diff = rounds_count - decided_rounds
            if diff > 0:
                warnings.append(
                    f"Discrepância detectada: {rounds_count} rodadas processadas versus {decided_rounds} rounds decididos no placar ({diff} rodada(s) além do placar)."
                )
            else:
                warnings.append(
                    f"Discrepância detectada: {rounds_count} rodadas processadas versus {decided_rounds} rounds decididos no placar ({abs(diff)} rodada(s) faltante(s) no HUD)."
                )

    # 2. Checagem de elenco incompleto / nicks genéricos no roster
    generic_friendly = [
        inf["canonical_nick"] for inf in roster.values()
        if inf.get("team") == "friendly" and (inf["canonical_nick"].startswith("Aliado ") or inf["canonical_nick"].startswith("Jogador ("))
    ]
    generic_enemy = [
        inf["canonical_nick"] for inf in roster.values()
        if inf.get("team") == "enemy" and (inf["canonical_nick"].startswith("Inimigo ") or inf["canonical_nick"].startswith("Jogador (") or inf["canonical_nick"].startswith("Inimigo ("))
    ]
    if generic_friendly:
        warnings.append(
            f"Elenco aliado incompleto: {len(generic_friendly)} jogador(es) com identificação genérica ({', '.join(generic_friendly)})."
        )
    if generic_enemy:
        warnings.append(
            f"Elenco inimigo incompleto: {len(generic_enemy)} jogador(es) com identificação genérica ({', '.join(generic_enemy)})."
        )

    # 3. Checagem de rodadas sem abates e rodadas com excesso de abates (> 10 + ressurreições)
    rounds_zero_kills = [r.get("round_number", idx + 1) for idx, r in enumerate(rounds) if not r.get("kills")]
    if rounds_zero_kills:
        warnings.append(
            f"Rodadas sem abates registrados no killfeed: rounds {rounds_zero_kills}."
        )

    rounds_excess_kills = []
    for idx, r in enumerate(rounds):
        r_num = r.get("round_number", idx + 1)
        k_count = len(r.get("kills", []))
        res_count = r.get("resurrections_count", 0)
        if not res_count and "resurrections" in r and isinstance(r["resurrections"], list):
            res_count = len(r["resurrections"])
        max_expected = 10 + res_count
        if k_count > max_expected:
            rounds_excess_kills.append(f"round {r_num} ({k_count} abates, teto esperado: {max_expected})")
    if rounds_excess_kills:
        warnings.append(
            f"Rodadas com contagem anômala de abates excedendo teto: {', '.join(rounds_excess_kills)}."
        )

    # 4. Checagem de taxa de abates com assassino/vítima não resolvidos (> 15%)
    all_kills = [k for r in rounds for k in r.get("kills", [])]
    total_kills = len(all_kills)
    if total_kills > 0:
        unresolved_kills = sum(
            1 for k in all_kills
            if k.get("killer") in ("Aliado", "Inimigo", "Agente") or (k.get("killer") and k["killer"].startswith("Jogador ("))
            or k.get("victim") in ("Aliado", "Inimigo", "Agente") or (k.get("victim") and k["victim"].startswith("Jogador ("))
        )
        unresolved_rate = (unresolved_kills / total_kills) * 100
        if unresolved_rate > 15.0:
            warnings.append(
                f"Taxa elevada de abates não resolvidos: {unresolved_rate:.1f}% dos abates ({unresolved_kills}/{total_kills}) contêm assassino ou vítima genéricos (limiar de qualidade: 15.0%)."
            )

    # 5. Checagem de divergência entre placar oficial e eventos do killfeed
    divergences = []
    for p_name, s in players_stats.items():
        if s.get("scoreboard_verified") and "feed_kills" in s:
            f_k = s.get("feed_kills", 0)
            o_k = s.get("kills", 0)
            if f_k != o_k:
                divergences.append(f"{p_name} ({o_k} oficial vs {f_k} feed)")
    if divergences:
        warnings.append(
            f"Divergência entre placar oficial e eventos do killfeed detectada em {len(divergences)} jogador(es): "
            f"{', '.join(divergences)}. Os totais do placar oficial foram priorizados."
        )

    return warnings


def compute_tactical_metrics(
    rounds: list[dict],
    roster: dict,
    scoreboard_players: dict | None = None,
    trade_window_sec: float = 3.5,
) -> dict:
    """
    Função pura e determinística que enriquece os eventos de abate, as rodadas
    e consolida o resumo tático da partida:
      - Detecção de Trade Kills e Traded Deaths (janela <= 3.5s)
      - Detecção Automática de Clutches (1vX, com X >= 1)
      - Cálculo de KAST (%) e Estatísticas Táticas por Jogador
      - Conversão de Vantagem Numérica da Equipe (5v4 Win Rate, 4v5 Recovery, Trade Efficiency)
    """
    norm_to_canonical: dict[str, str] = {}
    canonical_to_team: dict[str, str] = {}

    for _, info in roster.items():
        can = info.get("canonical_nick")
        if can:
            n_key = normalize_nick(can)
            if n_key:
                norm_to_canonical[n_key] = can
            canonical_to_team[can] = info.get("team", "unknown")

    if scoreboard_players:
        for p_name, s_info in scoreboard_players.items():
            n_key = normalize_nick(p_name)
            if n_key and n_key not in norm_to_canonical:
                norm_to_canonical[n_key] = p_name
            if p_name not in canonical_to_team and isinstance(s_info, dict):
                canonical_to_team[p_name] = s_info.get("team", "unknown")

    def resolve_can(raw_name: str | None) -> str | None:
        if not raw_name:
            return None
        n = normalize_nick(raw_name)
        if not n:
            return raw_name
        if n in norm_to_canonical:
            return norm_to_canonical[n]
        for cn, can_name in norm_to_canonical.items():
            if cn == n or (len(cn) >= 4 and (cn in n or n in cn)):
                return can_name
            if len(cn) >= 3 and len(n) >= 3 and difflib.SequenceMatcher(None, cn, n).ratio() >= 0.75:
                return can_name
        return raw_name

    # 1. Detecção de Trades (Kills e Deaths) e Clutches por Rodada
    match_clutches: list[dict] = []
    clutches_won_by_player: dict[str, list[str]] = {}

    for r_idx, r in enumerate(rounds):
        round_num = r.get("round_number", r_idx + 1)
        kills = r.get("kills", [])

        # Garante ordenação cronológica estável
        kills.sort(key=lambda k: float(k.get("timestamp_sec") or 0.0))
        r["kills"] = kills

        # Inicializa campos táticos nos abates
        for k in kills:
            k["is_trade_kill"] = False
            k["traded_teammate"] = None
            k["trade_delta_sec"] = None
            k["is_traded_death"] = False
            k["traded_by"] = None

        # Histórico de mortes dentro desta rodada para casar trades
        # death_record: {kill_idx, victim, victim_team, killer, killer_team, time_sec, traded}
        round_deaths: list[dict] = []

        for i, k in enumerate(kills):
            k_name = resolve_can(k.get("killer"))
            v_name = resolve_can(k.get("victim"))
            k_team = k.get("killer_team") or canonical_to_team.get(k_name, "unknown")
            v_team = k.get("victim_team") or canonical_to_team.get(v_name, "unknown")
            t_sec = float(k.get("timestamp_sec") or 0.0)

            # Checa se este abate é um trade (B mata X que havia matado A do time de B em <= trade_window_sec)
            eligible_deaths = []
            for d in round_deaths:
                if d["traded"]:
                    continue
                # X é quem morreu agora (v_name) e havia sido o killer da morte anterior
                x_match = (d["killer"] == v_name) or (normalize_nick(d["killer"]) == normalize_nick(v_name))
                if not x_match:
                    continue
                # A vítima anterior pertencia ao mesmo time de quem está matando agora (B)
                same_team = (d["victim_team"] == k_team)
                # B não está se vingando de suicídio próprio
                diff_teammate = (d["victim"] != k_name) and (normalize_nick(d["victim"]) != normalize_nick(k_name))
                # Intervalo de tempo entre a morte de A e o abate de B
                delta = t_sec - d["time_sec"]

                if same_team and diff_teammate and (0.0 <= delta <= trade_window_sec):
                    eligible_deaths.append((delta, d))

            if eligible_deaths:
                # Prioriza a morte mais recente causada por X
                eligible_deaths.sort(key=lambda item: item[0])
                delta, best_death = eligible_deaths[0]

                k["is_trade_kill"] = True
                k["traded_teammate"] = best_death["victim"]
                k["trade_delta_sec"] = round(delta, 2)

                best_death["traded"] = True
                prev_kill = kills[best_death["kill_idx"]]
                prev_kill["is_traded_death"] = True
                prev_kill["traded_by"] = k_name

                # Se X havia causado múltiplas mortes de companheiros de B nos últimos trade_window_sec,
                # a eliminação de X também vinga as outras mortes pendentes na janela
                for _other_delta, other_death in eligible_deaths[1:]:
                    other_death["traded"] = True
                    p_kill = kills[other_death["kill_idx"]]
                    p_kill["is_traded_death"] = True
                    p_kill["traded_by"] = k_name

            # Registra esta morte na rodada
            round_deaths.append({
                "kill_idx": i,
                "victim": v_name,
                "victim_team": v_team,
                "killer": k_name,
                "killer_team": k_team,
                "time_sec": t_sec,
                "traded": False,
            })

        # Detecção de Clutch (1vX com X >= 1)
        winner_team = r.get("winner_team") or r.get("winner")
        r["clutch"] = None

        if winner_team in ("friendly", "enemy"):
            opp_team = "enemy" if winner_team == "friendly" else "friendly"

            # Conjunto de vivos no início da rodada
            team_alive = {
                "friendly": set([can for can, tm in canonical_to_team.items() if tm == "friendly"]),
                "enemy": set([can for can, tm in canonical_to_team.items() if tm == "enemy"]),
            }
            # Se roster for parcial, garante que contagens comecem em 5
            alive_counts = {
                "friendly": max(5, len(team_alive["friendly"])),
                "enemy": max(5, len(team_alive["enemy"])),
            }

            clutch_candidate = None

            for k in kills:
                v_name = resolve_can(k.get("victim"))
                v_team = k.get("victim_team") or canonical_to_team.get(v_name, "unknown")
                t_sec = float(k.get("timestamp_sec") or 0.0)

                if v_team in team_alive:
                    if v_name in team_alive[v_team]:
                        team_alive[v_team].discard(v_name)
                    else:
                        norm_v = normalize_nick(v_name)
                        for living in list(team_alive[v_team]):
                            if normalize_nick(living) == norm_v:
                                team_alive[v_team].discard(living)
                                break
                    alive_counts[v_team] = max(0, alive_counts[v_team] - 1)

                win_alive_num = len(team_alive[winner_team]) if team_alive[winner_team] else alive_counts[winner_team]
                opp_alive_num = len(team_alive[opp_team]) if team_alive[opp_team] else alive_counts[opp_team]

                # Primeira vez que o time vencedor fica com 1 vivo e o perdedor tem X >= 1
                if win_alive_num == 1 and opp_alive_num >= 1 and clutch_candidate is None:
                    c_player = next(iter(team_alive[winner_team])) if team_alive[winner_team] else None
                    if not c_player:
                        c_player = k.get("killer") if k.get("killer_team") == winner_team else f"Clutcher {winner_team}"

                    clutch_candidate = {
                        "player": c_player,
                        "team": winner_team,
                        "vs_count": opp_alive_num,
                        "label": f"1v{opp_alive_num}",
                        "timestamp_sec": t_sec,
                    }

            if clutch_candidate is not None:
                r["clutch"] = clutch_candidate
                match_clutches.append({
                    "round": round_num,
                    **clutch_candidate,
                })
                c_norm = normalize_nick(clutch_candidate["player"])
                clutches_won_by_player.setdefault(c_norm, []).append(
                    f"{clutch_candidate['label']} (R{round_num:02d})"
                )

    # 2. Estatísticas Táticas por Jogador (KAST%, Trades K/D, Clutches)
    total_rounds = len(rounds)
    player_tactical_stats: dict[str, dict[str, Any]] = {}

    all_player_names = list(canonical_to_team.keys())
    if scoreboard_players:
        for p in scoreboard_players.keys():
            if p not in all_player_names:
                all_player_names.append(p)

    for r in rounds:
        for k in r.get("kills", []):
            for raw_p in (k.get("killer"), k.get("victim")):
                can_p = resolve_can(raw_p)
                if can_p and can_p not in all_player_names:
                    all_player_names.append(can_p)

    for p in all_player_names:
        p_norm = normalize_nick(p)
        p_team = canonical_to_team.get(p, "unknown")

        trade_kills = 0
        traded_deaths = 0
        feed_deaths = 0
        kst_rounds_count = 0

        for r in rounds:
            r_kills = r.get("kills", [])
            got_kill = False
            died = False
            died_and_traded = False

            for k in r_kills:
                k_norm = normalize_nick(k.get("killer", ""))
                v_norm = normalize_nick(k.get("victim", ""))

                if k_norm == p_norm:
                    got_kill = True
                    if k.get("is_trade_kill"):
                        trade_kills += 1

                if v_norm == p_norm:
                    died = True
                    feed_deaths += 1
                    if k.get("is_traded_death"):
                        died_and_traded = True
                        traded_deaths += 1

            survived = not died
            # Round KST: Kill, Survived ou Traded death
            if got_kill or survived or died_and_traded:
                kst_rounds_count += 1

        # Incorpora Assists oficiais do Scoreboard com fator de sobreposição estatística alfa = 0.45
        # Como no Valorant ~55% das assistências ocorrem em rodadas onde o jogador já obteve K, S ou T,
        # apenas ~45% das assistências resgatam efetivamente rodadas 'órfãs' (secas)
        official_assists = 0
        if scoreboard_players:
            sb_info = scoreboard_players.get(p)
            if not sb_info:
                for sbp, sbd in scoreboard_players.items():
                    if normalize_nick(sbp) == p_norm:
                        sb_info = sbd
                        break
            if sb_info and isinstance(sb_info, dict):
                official_assists = int(sb_info.get("assists", 0))

        orphan_assists = round(official_assists * 0.45)
        dry_rounds = max(0, total_rounds - kst_rounds_count)
        assists_applied = min(orphan_assists, dry_rounds)
        kast_rounds = kst_rounds_count + assists_applied
        kast_pct = round((kast_rounds / total_rounds) * 100.0, 1) if total_rounds > 0 else 0.0

        p_clutches = clutches_won_by_player.get(p_norm, [])

        tact_data = {
            "player": p,
            "team": p_team,
            "trade_kills": trade_kills,
            "traded_deaths": traded_deaths,
            "untraded_deaths": max(0, feed_deaths - traded_deaths),
            "clutches_won": len(p_clutches),
            "clutches_detail": p_clutches,
            "kast_pct": kast_pct,
            "kst_rounds": kst_rounds_count,
            "orphan_assists": orphan_assists,
            "assists_applied_to_kast": assists_applied,
        }
        player_tactical_stats[p] = tact_data

        # Enriquece diretamente se estiver no scoreboard_players
        if scoreboard_players and p in scoreboard_players and isinstance(scoreboard_players[p], dict):
            scoreboard_players[p].update({
                "trade_kills": trade_kills,
                "traded_deaths": traded_deaths,
                "untraded_deaths": max(0, feed_deaths - traded_deaths),
                "clutches_won": len(p_clutches),
                "clutches_detail": p_clutches,
                "kast_pct": kast_pct,
                "kst_rounds": kst_rounds_count,
            })

    # 3. Conversão de Vantagem Numérica e Eficiência de Trades da Equipe
    fb_wins = {"friendly": 0, "enemy": 0}
    fb_totals = {"friendly": 0, "enemy": 0}
    rec_wins = {"friendly": 0, "enemy": 0}
    rec_totals = {"friendly": 0, "enemy": 0}

    friendly_total_deaths = 0
    friendly_traded_deaths = 0
    enemy_total_deaths = 0
    enemy_traded_deaths = 0

    for r in rounds:
        r_kills = r.get("kills", [])
        w_team = r.get("winner_team") or r.get("winner")

        if r_kills:
            fb = r_kills[0]
            fb_team = fb.get("killer_team")
            victim_team = fb.get("victim_team")

            if fb_team in ("friendly", "enemy"):
                fb_totals[fb_team] += 1
                if w_team == fb_team:
                    fb_wins[fb_team] += 1

            if victim_team in ("friendly", "enemy"):
                rec_totals[victim_team] += 1
                if w_team == victim_team:
                    rec_wins[victim_team] += 1

        for k in r_kills:
            v_team = k.get("victim_team")
            if v_team == "friendly":
                friendly_total_deaths += 1
                if k.get("is_traded_death"):
                    friendly_traded_deaths += 1
            elif v_team == "enemy":
                enemy_total_deaths += 1
                if k.get("is_traded_death"):
                    enemy_traded_deaths += 1

    tactical_summary = {
        "first_blood_conversion": {
            "friendly": {
                "fb_rounds_won": fb_wins["friendly"],
                "fb_rounds_total": fb_totals["friendly"],
                "rate": round((fb_wins["friendly"] / fb_totals["friendly"] * 100.0), 1) if fb_totals["friendly"] > 0 else 0.0,
            },
            "enemy": {
                "fb_rounds_won": fb_wins["enemy"],
                "fb_rounds_total": fb_totals["enemy"],
                "rate": round((fb_wins["enemy"] / fb_totals["enemy"] * 100.0), 1) if fb_totals["enemy"] > 0 else 0.0,
            },
        },
        "man_disadvantage_recovery": {
            "friendly": {
                "recovery_rounds_won": rec_wins["friendly"],
                "recovery_rounds_total": rec_totals["friendly"],
                "rate": round((rec_wins["friendly"] / rec_totals["friendly"] * 100.0), 1) if rec_totals["friendly"] > 0 else 0.0,
            },
            "enemy": {
                "recovery_rounds_won": rec_wins["enemy"],
                "recovery_rounds_total": rec_totals["enemy"],
                "rate": round((rec_wins["enemy"] / rec_totals["enemy"] * 100.0), 1) if rec_totals["enemy"] > 0 else 0.0,
            },
        },
        "team_trade_efficiency": {
            "friendly": {
                "traded_deaths": friendly_traded_deaths,
                "total_deaths": friendly_total_deaths,
                "rate": round((friendly_traded_deaths / friendly_total_deaths * 100.0), 1) if friendly_total_deaths > 0 else 0.0,
            },
            "enemy": {
                "traded_deaths": enemy_traded_deaths,
                "total_deaths": enemy_total_deaths,
                "rate": round((enemy_traded_deaths / enemy_total_deaths * 100.0), 1) if enemy_total_deaths > 0 else 0.0,
            },
        },
        "clutches": match_clutches,
        "player_tactical_stats": player_tactical_stats,
    }

    return tactical_summary


def replay_dump(
    dump_data: dict | list,
    user_nick: str | None = None,
    user_agent: str | None = None,
    hs_threshold: float = 0.65,
    rounds_to_win: int = 13,
    overtime_mode: str = "unknown",
    roster_file: str | None = None,
    min_consensus_reads: int = 2,
    fill_consensus: bool = True,
    max_seconds: float | None = None,
    similarity_threshold: float = 0.65,
    margin_threshold: float = 0.10,
) -> dict:
    """
    Reproduz offline o fluxo de interpretação de uma partida a partir
    das leituras brutas registradas em um dump JSON versionado.
    Permite rodar suítes de métricas, calibração e testes de regressão
    sem necessidade do arquivo de vídeo.
    """
    if isinstance(dump_data, list):
        reads = dump_data
        duration_sec = 2700.0
    elif isinstance(dump_data, dict):
        reads = dump_data.get("reads", [])
        duration_sec = float(dump_data.get("video_metadata", {}).get("duration_sec", 2700.0))
    else:
        raise ValueError(f"Formato de dump inválido: {type(dump_data)}")

    is_truncated = False
    if max_seconds is not None:
        reads = [r for r in reads if float(r.get("time_sec", 0.0)) <= max_seconds]
        duration_sec = min(duration_sec, max_seconds)
        is_truncated = True

    discard_warnings: list[str] = []

    # Carrega sobreposição manual de roster se informada
    roster_override = load_roster_file(roster_file) if roster_file else None

    # Descoberta do elenco fechado (5 por time) com suporte a consenso no killfeed
    roster = discover_closed_roster(
        reads,
        user_nick=user_nick,
        user_agent=user_agent,
        roster_override=roster_override,
        fill_consensus=fill_consensus,
        min_read_occurrences=min_consensus_reads,
        quality_warnings=discard_warnings,
    )

    # 2. Agrupa leituras em jogo por timestamp cronológico
    reads_by_time: dict[float, list[dict]] = {}
    for r in reads:
        t = float(r.get("time_sec", 0.0))
        if t not in reads_by_time:
            reads_by_time[t] = []
        reads_by_time[t].append(r)

    sorted_times = sorted(reads_by_time.keys())

    rounds = []
    current_round_num = 1
    current_round_kills = []
    round_has_first_kill = False
    current_score_friendly = 0
    current_score_enemy = 0
    current_round_start_time = 45.0
    recent_kills = []
    round_dead_times: dict[str, list[float]] = {}
    last_processed_time = 0.0

    for t in sorted_times:
        time_reads = reads_by_time[t]
        time_str = format_time(t)
        last_processed_time = max(last_processed_time, t)

        # Processa atualizações de placar (HUD)
        hud_reads = [r for r in time_reads if r.get("region") == "hud_score"]
        if hud_reads:
            friendly_digits = []
            enemy_digits = []
            for item in hud_reads:
                txt = item.get("text", "").strip()
                box = item.get("box", [[0, 0], [0, 0]])
                if txt.isdigit():
                    val = int(txt)
                    if 0 <= val <= 25:
                        cx = (box[0][0] + box[1][0]) / 2.0
                        if cx < 140:
                            friendly_digits.append(val)
                        elif cx > 240:
                            enemy_digits.append(val)

            if friendly_digits and enemy_digits:
                det_f = friendly_digits[0]
                det_e = enemy_digits[0]
                is_valid, winner, _, _, r_inc = validate_score_transition(
                    det_f, det_e, current_score_friendly, current_score_enemy
                )
                if is_valid:
                    if len(current_round_kills) == 0:
                        # Proibição Absoluta de Rodada Vazia (No Empty Round Rollover)
                        current_score_friendly = det_f
                        current_score_enemy = det_e
                        current_round_start_time = t
                        round_dead_times.clear()
                        round_has_first_kill = False
                        if rounds:
                            rounds[-1]["score_after"] = f"{det_f}-{det_e}"
                            rounds[-1]["winner"] = winner
                    else:
                        if r_inc >= 2:
                            split_recs = split_round_on_score_jump(
                                current_round_num,
                                current_round_start_time,
                                t,
                                (current_score_friendly, current_score_enemy),
                                (det_f, det_e),
                                current_round_kills,
                            )
                            rounds.extend(split_recs)
                            current_round_num += len(split_recs)
                        else:
                            rounds.append(
                                create_round_record(
                                    current_round_num,
                                    format_time(current_round_start_time),
                                    time_str,
                                    winner,
                                    det_f,
                                    det_e,
                                    current_round_kills,
                                )
                            )
                            current_round_num += 1

                        current_score_friendly = det_f
                        current_score_enemy = det_e
                        current_round_kills = []
                        round_has_first_kill = False
                        round_dead_times.clear()
                        current_round_start_time = t

                    if is_match_decided(det_f, det_e, rounds_to_win=rounds_to_win, overtime_mode=overtime_mode):
                        break

        # Processa leituras do Killfeed
        kf_reads = [r for r in time_reads if r.get("region") == "killfeed"]
        if kf_reads:
            # Agrupa por linha vertical (row_height ~35px)
            row_height = 35
            items_by_row: dict[int, list[tuple[float, str, dict]]] = {}
            for item in kf_reads:
                txt = item.get("text", "").strip()
                if not txt or len(txt) < 2:
                    continue
                box = item.get("box", [[0, 0], [0, 0], [0, 0], [0, 0]])
                cy = (box[0][1] + box[2][1]) / 2.0
                cx = (box[0][0] + box[2][0]) / 2.0
                r_idx = int(cy // row_height)
                if 0 <= r_idx < 4:
                    if r_idx not in items_by_row:
                        items_by_row[r_idx] = []
                    items_by_row[r_idx].append((cx, txt, item))

            hs_reads = [r for r in time_reads if r.get("region") == "killfeed_headshot"]
            best_hs_conf = max((float(r.get("confidence", 0.0)) for r in hs_reads), default=0.0)
            is_headshot = best_hs_conf > hs_threshold

            for _, row_items in items_by_row.items():
                row_items.sort(key=lambda x: x[0])
                if len(row_items) >= 2:
                    raw_k = row_items[0][1]
                    raw_v = row_items[-1][1]
                elif len(row_items) == 1:
                    if row_items[0][0] < 180:
                        raw_k = row_items[0][1]
                        raw_v = ""
                    else:
                        raw_k = ""
                        raw_v = row_items[0][1]
                else:
                    continue

                # Determina time com base em team_hint ou resolução preliminar
                team_hint = row_items[0][2].get("team_hint")
                if team_hint in ("friendly", "enemy"):
                    killer_team = team_hint
                    victim_team = "enemy" if killer_team == "friendly" else "friendly"
                else:
                    # Dedução pelo roster prévio
                    norm_k = normalize_nick(raw_k)
                    norm_v = normalize_nick(raw_v)
                    if norm_k in roster:
                        killer_team = roster[norm_k]["team"]
                        victim_team = "enemy" if killer_team == "friendly" else "friendly"
                    elif norm_v in roster:
                        victim_team = roster[norm_v]["team"]
                        killer_team = "enemy" if victim_team == "friendly" else "friendly"
                    else:
                        killer_team = "friendly"
                        victim_team = "enemy"

                killer_nick, killer_agent = resolve_player(
                    raw_k, killer_team, roster, min_ratio=similarity_threshold, min_margin=margin_threshold
                )
                victim_nick, victim_agent = resolve_player(
                    raw_v, victim_team, roster, min_ratio=similarity_threshold, min_margin=margin_threshold
                )

                if not is_duplicate_kill(recent_kills, killer_nick, victim_nick, t, window_sec=2.8):
                    if not can_record_death_in_round(victim_nick, round_dead_times, t, victim_team, roster, max_team_deaths=None):
                        if should_trigger_implicit_round_rollover(
                            current_round_kills=current_round_kills,
                            current_round_start_time=current_round_start_time,
                            current_time_sec=t,
                            candidate_killer=killer_nick,
                            candidate_victim=victim_nick,
                            round_dead_times=round_dead_times,
                            victim_team=victim_team,
                            roster=roster,
                        ):
                            rounds, current_round_num, current_round_start_time, current_round_kills, current_score_friendly, current_score_enemy = perform_implicit_round_rollover(
                                rounds=rounds,
                                current_round_num=current_round_num,
                                current_round_start_time=current_round_start_time,
                                current_round_kills=current_round_kills,
                                current_score_friendly=current_score_friendly,
                                current_score_enemy=current_score_enemy,
                                current_time_sec=t,
                            )
                            round_dead_times.clear()
                            round_has_first_kill = False
                        else:
                            continue

                    recent_kills.append((killer_nick, victim_nick, t))
                    norm_v = normalize_nick(victim_nick)
                    round_dead_times.setdefault(norm_v, []).append(t)

                    is_fk = not round_has_first_kill
                    if is_fk:
                        round_has_first_kill = True

                    kill_ev = build_kill_event(
                        current_round_num,
                        time_str,
                        t,
                        killer_nick,
                        killer_agent,
                        victim_nick,
                        victim_agent,
                        killer_team,
                        victim_team,
                        is_headshot,
                        is_fk,
                    )
                    current_round_kills.append(kill_ev)


    # 3. Encerramento da rodada final
    wrap_duration = max(duration_sec, last_processed_time)
    wrap_up_final_round(
        rounds,
        current_round_num,
        current_round_start_time,
        wrap_duration,
        current_score_friendly,
        current_score_enemy,
        current_round_kills,
        rounds_to_win=rounds_to_win,
        overtime_mode=overtime_mode,
        quality_warnings=discard_warnings,
    )

    rounds = reconcile_match_rounds_cardinality(
        rounds=rounds,
        official_friendly_score=current_score_friendly,
        official_enemy_score=current_score_enemy,
    )

    all_kills = [k for r in rounds for k in r.get("kills", [])]
    players_stats = consolidate_players_stats(all_kills, roster)

    tactical_summary = compute_tactical_metrics(
        rounds=rounds,
        roster=roster,
        scoreboard_players=players_stats,
    )
    all_kills = [k for r in rounds for k in r.get("kills", [])]

    final_score = {
        "friendly": current_score_friendly,
        "enemy": current_score_enemy,
    }
    warnings = discard_warnings + generate_quality_warnings(
        rounds, final_score, roster, players_stats, is_truncated=is_truncated
    )

    return {
        "rounds": rounds,
        "rounds_count": len(rounds),
        "all_kills": all_kills,
        "players_stats": players_stats,
        "final_score": final_score,
        "roster": roster,
        "tactical_summary": tactical_summary,
        "quality": {
            "warnings": warnings,
        },
    }

