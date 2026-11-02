#!/usr/bin/env python3
"""
Valorant VOD Match Analyzer
Analyzes private scrim VODs to extract:
- Player nicknames and agents played (friendly and enemy rosters)
- Round-by-round score and outcome
- Killfeed events with Player Name + Agent (killer & victim)
- Headshot detection via computer vision template matching
- First Kill / First Death per round
- Consolidated player scoreboard statistics
"""

import argparse
import json
import os
import re
import sys
import time

import cv2
import numpy as np

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

try:
    from rapidocr_onnxruntime import RapidOCR
    RAPID_OCR_AVAILABLE = True
    RAPID_OCR_ERROR = None
except Exception as e:
    RAPID_OCR_AVAILABLE = False
    RAPID_OCR_ERROR = str(e)


def get_base_dir() -> str:
    """Returns the base directory whether running as script or packaged PyInstaller executable."""
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            return sys._MEIPASS
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


try:
    from analyzer.interpret import (
        DEFAULT_KILL_PRUNE_AGE_SEC,
        DEFAULT_KILL_WINDOW_SEC,
        GENERIC_NICKS,
        RESURRECTION_AGENTS,
        apply_kill_merge,
        build_initial_roster,
        build_kill_event,
        can_record_death_in_round,
        compute_tactical_metrics,
        consolidate_players_stats,
        create_round_record,
        discover_closed_roster,
        evict_generic_victim_at_capacity,
        evict_half_generic_kill_for_named,
        find_kill_merge_target,
        format_time,
        generate_quality_warnings,
        get_roster_player_team,
        infer_last_surviving_victim,
        is_duplicate_kill,
        load_roster_file,
        locate_killfeed_plaque_and_hs_window,
        normalize_nick,
        parse_agent_select_bottom_cards,
        parse_ally_roster,
        parse_postmatch_score_banner,
        parse_scoreboard_ocr,
        perform_implicit_round_rollover,
        prune_recent_kills,
        reconcile_match_rounds_cardinality,
        reconcile_players_stats_with_scoreboard,
        resolve_player,
        segment_killfeed_rows_by_slot,
        should_trigger_implicit_round_rollover,
        split_round_on_score_jump,
        validate_score_transition,
        validate_scoreboard_consistency,
        wrap_up_final_round,
    )
except ImportError:
    from interpret import (
        DEFAULT_KILL_PRUNE_AGE_SEC,
        DEFAULT_KILL_WINDOW_SEC,
        GENERIC_NICKS,
        RESURRECTION_AGENTS,
        apply_kill_merge,
        build_initial_roster,
        build_kill_event,
        can_record_death_in_round,
        compute_tactical_metrics,
        consolidate_players_stats,
        create_round_record,
        discover_closed_roster,
        evict_generic_victim_at_capacity,
        evict_half_generic_kill_for_named,
        find_kill_merge_target,
        format_time,
        generate_quality_warnings,
        get_roster_player_team,
        infer_last_surviving_victim,
        is_duplicate_kill,
        load_roster_file,
        locate_killfeed_plaque_and_hs_window,
        normalize_nick,
        parse_agent_select_bottom_cards,
        parse_ally_roster,
        parse_postmatch_score_banner,
        parse_scoreboard_ocr,
        perform_implicit_round_rollover,
        prune_recent_kills,
        reconcile_match_rounds_cardinality,
        reconcile_players_stats_with_scoreboard,
        resolve_player,
        segment_killfeed_rows_by_slot,
        should_trigger_implicit_round_rollover,
        split_round_on_score_jump,
        validate_score_transition,
        validate_scoreboard_consistency,
        wrap_up_final_round,
    )



KNOWN_VALORANT_MAPS = [
    "Abyss", "Ascent", "Bind", "Breeze", "Corrode",
    "Fracture", "Haven", "Icebox", "Lotus", "Pearl",
    "Split", "Summit", "Sunset"
]


class ValorantAnalyzer:
    def __init__(self, templates_dir: str | None = None):
        if templates_dir is None:
            templates_dir = os.path.join(get_base_dir(), "templates")

        self.templates_dir = templates_dir
        self.tmpl_friendly = cv2.imread(os.path.join(templates_dir, "hs_friendly.png"))
        self.tmpl_enemy = cv2.imread(os.path.join(templates_dir, "hs_enemy.png"))
        self.ocr = None
        self.ocr_error = None
        if RAPID_OCR_AVAILABLE:
            # 1. Try DirectML GPU acceleration first
            try:
                test_ocr = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
                # Verify that DirectML actually runs without shader / driver failures
                dummy_img = np.zeros((32, 32, 3), dtype=np.uint8)
                test_ocr(dummy_img)
                self.ocr = test_ocr
            except Exception:
                # 2. Fall back to CPU inference if DirectML fails on this GPU/driver
                try:
                    self.ocr = RapidOCR(det_use_dml=False, cls_use_dml=False, rec_use_dml=False)
                except Exception as cpu_err:
                    self.ocr = None
                    self.ocr_error = str(cpu_err)
        else:
            self.ocr_error = RAPID_OCR_ERROR or "Biblioteca 'rapidocr_onnxruntime' não instalada."

    def discover_roster(
        self,
        cap,
        fps,
        user_nick=None,
        user_agent=None,
        debug_reads: list | None = None,
        roster_override: dict | None = None,
        ally_roster: str | list[str] | dict | None = None,
        fast_mode: bool = False,
    ):
        """
        Scans pre-match screens (agent select, VS loading screen, buy phase)
        to extract the 5 friendly and 5 enemy player nicknames and their agents.
        Also identifies when active gameplay starts.
        """
        gameplay_start_sec = 45.0  # Default safe fallback

        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        scale_x = w / 1280.0
        scale_y = h / 720.0

        # 1. Detect dynamic gameplay start (when Top HUD score 0-0 and round timer appear)
        if self.ocr and not fast_mode:
            hud_y1 = int(0 * scale_y)
            hud_y2 = int(70 * scale_y)
            hud_x1 = int(450 * scale_x)
            hud_x2 = int(830 * scale_x)

            total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or (180 * fps)
            max_scan = min(180, int(total_frames / fps))

            for scan_s in range(0, max_scan, 3):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(scan_s * fps))
                ret, frame = cap.read()
                if not ret:
                    break
                hud_crop = frame[hud_y1:hud_y2, hud_x1:hud_x2]
                res_hud, _ = self.ocr(hud_crop)
                if not res_hud:
                    continue
                texts = [r[1].strip() for r in res_hud]
                has_zero = any(t == "0" for t in texts)
                has_timer = any(":" in t or t in ["45", "42", "40", "30"] for t in texts)
                if has_zero and has_timer:
                    gameplay_start_sec = float(scan_s)
                    print(
                        f"[analyzer] Início de partida detectado dinamicamente aos {format_time(gameplay_start_sec)} ({gameplay_start_sec:.1f}s).",
                        flush=True,
                    )
                    break

        if roster_override and len(roster_override) > 0:
            enemies_in_override = [k for k, v in roster_override.items() if v.get("team") == "enemy"]
            if enemies_in_override:
                return dict(roster_override), gameplay_start_sec
            if not ally_roster:
                ally_roster = [v["canonical_nick"] for v in roster_override.values() if v.get("team") == "friendly"]

        if ally_roster and not parse_ally_roster(ally_roster):
            ally_roster = None

        pre_match_reads = []

        if not self.ocr:
            return build_initial_roster(user_nick, user_agent), gameplay_start_sec

        # Check key frames for player cards: include 20, 30 and the window right before gameplay start
        if fast_mode:
            sample_seconds = [20, 26, 30]
        else:
            sample_candidates = {20, 30}
            window_start = max(15, int(gameplay_start_sec) - 22)
            for s in range(window_start, int(gameplay_start_sec), 2):
                sample_candidates.add(s)
            sample_seconds = sorted(sample_candidates)

        for sec in sample_seconds:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(sec * fps))
            ret, frame = cap.read()
            if not ret:
                continue

            # Left column crop (friendly cards)
            left_crop = frame[int(140 * scale_y):int(680 * scale_y), 0:int(450 * scale_x)]
            if left_crop.shape[0] != 540 or left_crop.shape[1] != 450:
                left_crop = cv2.resize(left_crop, (450, 540))
            res_left, _ = self.ocr(left_crop)

            if res_left:
                for r in res_left:
                    item = {
                        "time_sec": sec,
                        "region": "agent_select_left",
                        "text": r[1],
                        "confidence": float(r[2]) if len(r) > 2 else 1.0,
                        "box": [[float(pt[0]), float(pt[1])] for pt in r[0]],
                    }
                    pre_match_reads.append(item)
                    if debug_reads is not None:
                        debug_reads.append(item)

            # Right column crop (enemy cards in VS screen)
            right_crop = frame[int(180 * scale_y):int(680 * scale_y), int(850 * scale_x):w]
            if right_crop.shape[0] != 500 or right_crop.shape[1] != 430:
                right_crop = cv2.resize(right_crop, (430, 500))
            res_right, _ = self.ocr(right_crop)

            if res_right:
                for r in res_right:
                    item = {
                        "time_sec": sec,
                        "region": "agent_select_right",
                        "text": r[1],
                        "confidence": float(r[2]) if len(r) > 2 else 1.0,
                        "box": [[float(pt[0]), float(pt[1])] for pt in r[0]],
                    }
                    pre_match_reads.append(item)
                    if debug_reads is not None:
                        debug_reads.append(item)

        roster = discover_closed_roster(
            pre_match_reads,
            user_nick=user_nick,
            user_agent=user_agent,
            roster_override=roster_override,
            ally_roster=ally_roster,
        )
        return roster, gameplay_start_sec

    def resolve_player(
        self,
        raw_text: str,
        team: str,
        roster: dict,
        min_ratio: float = 0.65,
        min_margin: float = 0.10,
    ):
        """
        Resolves raw OCR text into (canonical_nickname, agent_name).
        Delegates to pure interpret.resolve_player function without auto-registration.
        """
        return resolve_player(
            raw_text, team, roster, allow_registration=False, min_ratio=min_ratio, min_margin=min_margin
        )

    def detect_map(self, cap: cv2.VideoCapture, fps: float, total_duration: float) -> str | None:
        """
        Detecta o nome do mapa a partir da tela de selecao de agentes (banner superior esquerdo).
        Otimizado com retorno imediato no primeiro frame conclusivo.
        """
        if not self.ocr or total_duration <= 0:
            return None

        import difflib
        from collections import Counter

        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        y1, y2 = int(h * 0.06), int(h * 0.25)
        x1, x2 = int(w * 0.01), int(w * 0.28)

        sample_secs = [10, 8, 15, 5, 20, 25, 30, 3]
        map_votes = []

        for s in sample_secs:
            if s >= total_duration:
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(s * fps))
            ret, frame = cap.read()
            if not ret:
                continue
            crop = np.ascontiguousarray(frame[y1:y2, x1:x2])
            try:
                res, _ = self.ocr(crop)
            except Exception:
                continue
            if not res:
                continue
            for item in res:
                text = item[1].strip().upper()
                if len(text) < 4:
                    continue
                matched_known = None
                for m in KNOWN_VALORANT_MAPS:
                    m_upper = m.upper()
                    if m_upper == text or m_upper in text:
                        return m  # Retorno instantaneo em match exato/substring
                    ratio = difflib.SequenceMatcher(None, text, m_upper).ratio()
                    if ratio >= 0.85:
                        return m  # Retorno instantaneo em alta similaridade
                    if ratio >= 0.75 and not matched_known:
                        matched_known = m
                if matched_known:
                    map_votes.append(matched_known)
                    break

        if not map_votes:
            return None
        return Counter(map_votes).most_common(1)[0][0]

    def detect_roster(
        self,
        video_path: str,
        user_nick: str | None = None,
        user_agent: str | None = None,
        roster_file: str | None = None,
        ally_roster: str | list[str] | dict | None = None,
        scan_scoreboard: bool = True,
    ) -> dict:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Nao foi possivel abrir o video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        total_duration = (total_frames / fps) if fps > 0 else 0.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        scale_x = w / 1280.0
        scale_y = h / 720.0

        roster_override = load_roster_file(roster_file) if roster_file else None

        # 1. Mapa (Retorno imediato no primeiro frame conclusivo)
        detected_map = self.detect_map(cap, fps, total_duration)

        # 2. Elenco Aliado via Cards Inferiores de Agent Select (Instantaneo)
        friendly_slots = []
        if self.ocr and total_duration > 8:
            for sample_s in [10, 15, 8, 20]:
                if sample_s >= total_duration:
                    continue
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(sample_s * fps))
                ret, frame = cap.read()
                if not ret:
                    continue
                bcrop = np.ascontiguousarray(frame[int(540 * scale_y):int(680 * scale_y), int(380 * scale_x):int(840 * scale_x)])
                try:
                    res_b, _ = self.ocr(bcrop)
                except Exception:
                    res_b = None
                parsed = parse_agent_select_bottom_cards(res_b, scale_x=scale_x, scale_y=scale_y)
                if len(parsed) >= 4:
                    friendly_slots = parsed
                    break

        if friendly_slots:
            roster = {}
            for s in friendly_slots:
                canonical = s["nick"]
                roster[normalize_nick(canonical)] = {
                    "canonical_nick": canonical,
                    "agent": s["agent"],
                    "team": "friendly",
                }
            if ally_roster:
                validated_allies = parse_ally_roster(ally_roster)
                if validated_allies:
                    raw_list = [s.strip() for s in ally_roster if s.strip()] if isinstance(ally_roster, (list, tuple)) else []
                    for idx, norm_a in enumerate(validated_allies):
                        orig_a = raw_list[idx] if idx < len(raw_list) else norm_a
                        if idx < len(friendly_slots):
                            old_k = normalize_nick(friendly_slots[idx]["nick"])
                            ag = roster.get(old_k, {}).get("agent", "Agente")
                            roster.pop(old_k, None)
                            roster[norm_a] = {
                                "canonical_nick": orig_a,
                                "agent": ag,
                                "team": "friendly",
                            }
            gameplay_start_sec = 45.0
        else:
            # Fallback para discover_roster rápido
            roster, gameplay_start_sec = self.discover_roster(
                cap,
                fps,
                user_nick=user_nick,
                user_agent=user_agent,
                roster_override=roster_override,
                ally_roster=ally_roster,
                fast_mode=True,
            )

        # 3. Scoreboard no final do video (Instantaneo via fast_mode)
        scoreboard_data = None
        match_score = None
        if scan_scoreboard and self.ocr and total_duration > 30:
            scoreboard_data = self.scan_for_scoreboard(
                cap,
                fps,
                total_duration,
                roster=roster,
                scale_x=scale_x,
                scale_y=scale_y,
                fast_mode=True,
            )

            if getattr(self, "last_scoreboard_score", None):
                f_score = self.last_scoreboard_score.get("friendly", 0)
                e_score = self.last_scoreboard_score.get("enemy", 0)
                outcome = str(self.last_scoreboard_score.get("outcome", "")).upper()
                if "VICTORY" in outcome or "VITORIA" in outcome or "VITÓRIA" in outcome or f_score > e_score:
                    res_label = "Vitória"
                elif "DEFEAT" in outcome or "DERROTA" in outcome or f_score < e_score:
                    res_label = "Derrota"
                else:
                    res_label = "Empate"
                match_score = {
                    "friendly": f_score,
                    "enemy": e_score,
                    "result": res_label,
                    "rounds_count": f_score + e_score,
                }

        cap.release()

        # 4. Construcao estrita de friendly (max 5) e enemy (max 5)
        friendly = []
        enemy = []

        # Aliados: primeiro os do roster/slots
        for info in list(roster.values()):
            if info.get("team") == "friendly":
                nick = info["canonical_nick"]
                item = {
                    "nick": nick,
                    "agent": info.get("agent", "Agente"),
                    "team": "friendly",
                }
                if scoreboard_data and nick in scoreboard_data:
                    sb_p = scoreboard_data[nick]
                    item["kills"] = sb_p.get("kills", 0)
                    item["deaths"] = sb_p.get("deaths", 0)
                    item["assists"] = sb_p.get("assists", 0)
                    item["first_bloods"] = sb_p.get("first_bloods", 0)
                    item["plants"] = sb_p.get("plants", 0)
                    item["defuses"] = sb_p.get("defuses", 0)
                friendly.append(item)

        # Se o scoreboard detectou jogadores aliados adicionais que nao estavam em friendly, anexa ate 5
        if scoreboard_data:
            for sb_nick, sb_stat in scoreboard_data.items():
                if sb_stat.get("team") == "friendly":
                    if not any(f["nick"] == sb_nick for f in friendly) and len(friendly) < 5:
                        friendly.append({
                            "nick": sb_nick,
                            "agent": "Agente",
                            "team": "friendly",
                            "kills": sb_stat.get("kills", 0),
                            "deaths": sb_stat.get("deaths", 0),
                            "assists": sb_stat.get("assists", 0),
                            "first_bloods": sb_stat.get("first_bloods", 0),
                            "plants": sb_stat.get("plants", 0),
                            "defuses": sb_stat.get("defuses", 0),
                        })

        # Inimigos: se o scoreboard detectou inimigos (linhas vermelhas), usa EXCLUSIVAMENTE eles!
        if scoreboard_data:
            for sb_nick, sb_stat in scoreboard_data.items():
                if sb_stat.get("team") == "enemy":
                    if len(enemy) < 5:
                        enemy.append({
                            "nick": sb_nick,
                            "agent": "Agente",
                            "team": "enemy",
                            "kills": sb_stat.get("kills", 0),
                            "deaths": sb_stat.get("deaths", 0),
                            "assists": sb_stat.get("assists", 0),
                            "first_bloods": sb_stat.get("first_bloods", 0),
                            "plants": sb_stat.get("plants", 0),
                            "defuses": sb_stat.get("defuses", 0),
                        })

        # Se nao houve scoreboard ou restaram vagas em enemy, preenche com roster onde team == enemy
        if len(enemy) < 5:
            for info in list(roster.values()):
                if info.get("team") == "enemy":
                    nick = info["canonical_nick"]
                    if not any(e["nick"] == nick for e in enemy) and len(enemy) < 5:
                        enemy.append({
                            "nick": nick,
                            "agent": info.get("agent", "Agente"),
                            "team": "enemy",
                        })

        # Trava absoluta: NUNCA mais de 5 por time!
        friendly = friendly[:5]
        enemy = enemy[:5]

        return {
            "roster": roster,
            "friendly": friendly,
            "enemy": enemy,
            "map": detected_map,
            "match_score": match_score,
            "scoreboard": scoreboard_data,
            "gameplay_start_sec": gameplay_start_sec,
        }

    def scan_for_scoreboard(
        self,
        cap: cv2.VideoCapture,
        fps: float,
        total_duration: float,
        start_sec: float | None = None,
        roster: dict | None = None,
        scale_x: float = 1.0,
        scale_y: float = 1.0,
        step_sec: float = 2.0,
        rounds_count: int | None = None,
        final_score: dict | None = None,
        fast_mode: bool = False,
    ) -> dict[str, dict] | None:
        """
        Varre múltiplos frames finais procurando a tela de Scoreboard/Placar oficial,
        acumula as células de OCR, vota por célula (moda) entre múltiplos frames e
        valida a consistência matemática:
        1. 5 jogadores aliados e 5 inimigos.
        2. Kills do time <= mortes do outro time.
        3. Soma de first bloods em {rounds, rounds-1}.
        4. Placar = rounds.
        Se a consistência falhar em todas as combinações, rejeita os dados e retorna None.
        """
        if not self.ocr:
            return None

        from collections import Counter

        y1, y2 = int(190 * scale_y), int(570 * scale_y)
        x1, x2 = int(220 * scale_x), int(1120 * scale_x)

        if fast_mode:
            check_offsets = [30.0, 45.0, 50.0, 60.0, 20.0, 75.0, 90.0, 15.0, 105.0]
            check_secs = [total_duration - off for off in check_offsets if total_duration - off > 0]
        else:
            effective_start = max(0.0, start_sec if start_sec is not None else (total_duration - 60.0))
            curr_sec = effective_start
            max_sec = total_duration
            check_secs = []
            while curr_sec < max_sec:
                check_secs.append(curr_sec)
                curr_sec += step_sec
            if max_sec - 1.0 not in check_secs:
                check_secs.append(max(0.0, max_sec - 1.0))

        candidate_frames = []

        for s in check_secs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(s * fps))
            ret, frame = cap.read()
            if not ret:
                continue

            crop = np.ascontiguousarray(frame[y1:y2, x1:x2])
            scaled = cv2.resize(crop, (0, 0), fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
            try:
                res, _ = self.ocr(scaled)
            except Exception:
                continue
            if not res:
                continue

            sb_data = parse_scoreboard_ocr(
                res,
                roster,
                scale_y=scale_y,
                frame=frame,
                ocr_engine=self.ocr,
                scale_x=scale_x,
                crop_y_offset=y1,
                crop_x_offset=x1,
            )
            if len(sb_data) >= 8:
                sb_score = parse_postmatch_score_banner(
                    frame,
                    self.ocr,
                    scale_x=scale_x,
                    scale_y=scale_y,
                    scoreboard_data=sb_data,
                )
                candidate_frames.append((s, sb_data, sb_score, frame))
                if fast_mode and (len(sb_data) == 10 or len(candidate_frames) >= 2):
                    break
                elif len(candidate_frames) >= 7:
                    break

        if not candidate_frames:
            for s in check_secs:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(s * fps))
                ret, frame = cap.read()
                if not ret:
                    continue
                crop = frame[y1:y2, x1:x2]
                scaled = cv2.resize(crop, (0, 0), fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
                res, _ = self.ocr(scaled)
                if not res:
                    continue
                sb_data = parse_scoreboard_ocr(
                    res,
                    roster,
                    scale_y=scale_y,
                    frame=frame,
                    ocr_engine=self.ocr,
                    scale_x=scale_x,
                    crop_y_offset=y1,
                    crop_x_offset=x1,
                )
                if len(sb_data) >= 5:
                    sb_score = parse_postmatch_score_banner(
                        frame,
                        self.ocr,
                        scale_x=scale_x,
                        scale_y=scale_y,
                        scoreboard_data=sb_data,
                    )
                    candidate_frames.append((s, sb_data, sb_score, frame))
                    if len(candidate_frames) >= 5:
                        break

        if not candidate_frames:
            self.last_scoreboard_score = None
            self.last_scoreboard_sec = None
            self.scoreboard_verified = False
            self.scoreboard_raw_cells = {}
            self.scoreboard_frames_used = []
            return None

        # Votação por célula entre múltiplos frames
        all_players = set()
        for _, sb, _, _ in candidate_frames:
            all_players.update(sb.keys())

        voted_sb = {}
        raw_cells_summary = {}

        for p in sorted(all_players):
            raw_cells_summary[p] = {
                "kills": [],
                "deaths": [],
                "assists": [],
                "first_bloods": [],
                "plants": [],
                "defuses": [],
            }
            for _s, sb, _, _ in candidate_frames:
                if p in sb:
                    raw_cells_summary[p]["kills"].append(sb[p]["kills"])
                    raw_cells_summary[p]["deaths"].append(sb[p]["deaths"])
                    raw_cells_summary[p]["assists"].append(sb[p]["assists"])
                    raw_cells_summary[p]["first_bloods"].append(sb[p].get("first_bloods", sb[p].get("fb", 0)))
                    raw_cells_summary[p]["plants"].append(sb[p].get("plants", 0))
                    raw_cells_summary[p]["defuses"].append(sb[p].get("defuses", 0))

            first_found_team = next((sb[p].get("team") for _, sb, _, _ in candidate_frames if p in sb and sb[p].get("team")), "friendly")
            voted_sb[p] = {
                "kills": Counter(raw_cells_summary[p]["kills"]).most_common(1)[0][0],
                "deaths": Counter(raw_cells_summary[p]["deaths"]).most_common(1)[0][0],
                "assists": Counter(raw_cells_summary[p]["assists"]).most_common(1)[0][0],
                "first_bloods": Counter(raw_cells_summary[p]["first_bloods"]).most_common(1)[0][0],
                "plants": Counter(raw_cells_summary[p]["plants"]).most_common(1)[0][0],
                "defuses": Counter(raw_cells_summary[p]["defuses"]).most_common(1)[0][0],
                "team": first_found_team,
                "confidence": 1.0,
                "source": "scoreboard_voted",
                "scoreboard_verified": True,
            }

        candidate_scores = [sc for _, _, sc, _ in candidate_frames if sc and sc.get("rounds_count")]
        best_score = candidate_scores[0] if candidate_scores else final_score
        target_rounds = (best_score.get("rounds_count") if best_score else None) or rounds_count
        if not target_rounds:
            target_rounds = sum(p["first_bloods"] for p in voted_sb.values())

        is_valid, consistency_warnings = validate_scoreboard_consistency(
            voted_sb,
            roster=roster,
            final_score=best_score,
            rounds_count=target_rounds,
        )

        self.scoreboard_raw_cells = raw_cells_summary
        self.scoreboard_frames_used = [cf[0] for cf in candidate_frames]
        self.scoreboard_consistency = {"is_valid": is_valid, "warnings": consistency_warnings}

        if is_valid:
            self.last_scoreboard_score = best_score
            self.last_scoreboard_sec = candidate_frames[-1][0]
            self.scoreboard_verified = True
            print(
                f"[analyzer] Scoreboard oficial votado e verificado com sucesso ({len(candidate_frames)} frames: {[f'{s:.1f}s' for s in self.scoreboard_frames_used]})! Sincronizando {len(voted_sb)} jogadores.",
                flush=True,
            )
            return voted_sb

        # Fallback para frames individuais em ordem reversa
        for s, sb, sc, _ in reversed(candidate_frames):
            cand_score = sc if (sc and sc.get("rounds_count")) else best_score
            c_rounds = (cand_score.get("rounds_count") if cand_score else None) or target_rounds
            c_valid, _c_warns = validate_scoreboard_consistency(
                sb,
                roster=roster,
                final_score=cand_score,
                rounds_count=c_rounds,
            )
            if c_valid:
                self.last_scoreboard_score = cand_score
                self.last_scoreboard_sec = s
                self.scoreboard_verified = True
                self.scoreboard_consistency = {"is_valid": True, "warnings": []}
                print(
                    f"[analyzer] Scoreboard oficial verificado no frame {s:.1f}s ({format_time(s)})! Sincronizando {len(sb)} jogadores.",
                    flush=True,
                )
                return sb

        self.last_scoreboard_score = None
        self.last_scoreboard_sec = None
        self.scoreboard_verified = False
        print(
            f"[analyzer] Scoreboard oficial REJEITADO por inconsistência matemática: {'; '.join(consistency_warnings)}",
            flush=True,
        )
        return None

    def record_rejection_candidate(
        self,
        reason: str,
        crop: np.ndarray,
        current_time_sec: float,
        time_str: str,
        round_num: int,
        killer_raw: str,
        victim_raw: str,
        video_path: str,
    ) -> dict:
        vod_name = os.path.splitext(os.path.basename(video_path))[0] if video_path else "vod"
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out_dir = os.path.join(root_dir, "scratch", "rejections", vod_name, reason)
        os.makedirs(out_dir, exist_ok=True)

        if not hasattr(self, "rejections_book"):
            self.rejections_book = []

        idx = len(self.rejections_book) + 1
        safe_k = "".join(c for c in killer_raw if c.isalnum() or c in ("_", "-")) or "vazio"
        safe_v = "".join(c for c in victim_raw if c.isalnum() or c in ("_", "-")) or "vazio"
        crop_filename = f"rej_{idx:04d}_{current_time_sec:.1f}s_r{round_num:02d}_{safe_k}_vs_{safe_v}.png"
        crop_path = os.path.join(out_dir, crop_filename)

        if crop is not None and hasattr(crop, "size") and crop.size > 0:
            cv2.imwrite(crop_path, crop)

        entry = {
            "index": idx,
            "timestamp_sec": round(current_time_sec, 2),
            "time_str": time_str,
            "round_number": round_num,
            "reason": reason,
            "killer_raw": killer_raw,
            "victim_raw": victim_raw,
            "crop_path": os.path.relpath(crop_path, root_dir),
        }
        self.rejections_book.append(entry)
        return entry

    def record_rejected_double_generic(
        self,
        crop: np.ndarray,
        current_time_sec: float,
        time_str: str,
        raw_k: str,
        raw_v: str,
        video_path: str,
        rejected_list: list,
    ) -> None:
        vod_name = os.path.splitext(os.path.basename(video_path))[0] if video_path else "vod"
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out_dir = os.path.join(root_dir, "rejected_double_generic", vod_name)
        os.makedirs(out_dir, exist_ok=True)

        idx = len(rejected_list) + 1
        safe_raw_k = "".join(c for c in raw_k if c.isalnum() or c in ("_", "-")) or "vazio"
        safe_raw_v = "".join(c for c in raw_v if c.isalnum() or c in ("_", "-")) or "vazio"
        crop_filename = f"rej_{idx:03d}_{current_time_sec:.1f}s_{safe_raw_k}_vs_{safe_raw_v}.jpg"
        crop_path = os.path.join(out_dir, crop_filename)

        if crop is not None and crop.size > 0:
            cv2.imwrite(crop_path, crop)

        entry = {
            "index": idx,
            "timestamp_sec": round(current_time_sec, 2),
            "time_str": time_str,
            "killer_raw": raw_k,
            "victim_raw": raw_v,
            "crop_path": os.path.relpath(crop_path, root_dir),
        }
        rejected_list.append(entry)

        log_json = os.path.join(out_dir, f"{vod_name}_rejected.json")
        try:
            with open(log_json, "w", encoding="utf-8") as f:
                json.dump(rejected_list, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    def is_hud_in_buy_phase(
        self,
        frame: np.ndarray,
        scale_x: float,
        scale_y: float,
        elapsed_in_round: float,
        round_in_combat: bool,
    ) -> tuple[bool, bool]:
        """
        Avalia dinamicamente se o frame atual pertence à Fase de Compra (Buy Phase)
        através da leitura do HUD (timer central e rótulos de Buy Phase / compras).
        Retorna (is_buy_phase, round_in_combat).
        """
        if not self.ocr:
            return False, round_in_combat

        # Se a rodada já entrou em combate ou já se passaram mais de 45s, a fase de compra encerrou
        if round_in_combat or elapsed_in_round > 45.0:
            return False, True

        h, w = frame.shape[:2]
        t_crop = frame[int(0.02 * h) : int(0.08 * h), int(0.46 * w) : int(0.54 * w)]
        res_t, _ = self.ocr(t_crop)
        timer_txt = ""
        if res_t:
            for r in res_t:
                txt = r[1].strip()
                if re.match(r"^\d+:\d\d$", txt) or re.match(r"^\d+\.\d+$", txt):
                    timer_txt = txt
                    break

        # Se timer mostra 1:xx -> Garantidamente em combate!
        if timer_txt.startswith("1:"):
            return False, True

        # Se timer mostra 0:xx ou decimal de contagem regressiva
        if timer_txt.startswith("0:") or ("." in timer_txt and len(timer_txt) <= 5):
            c_crop = frame[int(0.10 * h) : int(0.24 * h), int(0.35 * w) : int(0.65 * w)]
            res_c, _ = self.ocr(c_crop)
            c_txts = " ".join(r[1].upper() for r in (res_c or []))
            if any(
                w in c_txts
                for w in [
                    "BUY",
                    "COMPRA",
                    "DEFENDER",
                    "ATTACKER",
                    "ROUND",
                    "BULLDOG",
                    "VANDAL",
                    "PHANTOM",
                    "SHIELD",
                    "ARMOR",
                ]
            ):
                return True, False
            if not round_in_combat:
                return True, False

        # Fallback nos primeiros 20 segundos se ainda não detectou início de combate
        if not round_in_combat and elapsed_in_round < 20.0:
            return True, False

        return False, round_in_combat

    def analyze_vod(
        self,
        video_path: str,
        max_duration_sec: float | None = None,
        sample_interval_sec: float = 1.0,
        user_nick: str | None = None,
        user_agent: str | None = None,
        debug_dump_path: str | None = None,
        rounds_to_win: int = 13,
        overtime_mode: str = "unknown",
        roster_file: str | None = None,
        ally_roster: str | list[str] | dict | None = None,
        min_consensus_reads: int = 2,
        similarity_threshold: float = 0.65,
        margin_threshold: float = 0.10,
        scoreboard_scan: bool = True,
        scoreboard_only: bool = False,
    ):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Nao foi possivel abrir o video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        orig_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        orig_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_duration = total_frames / fps

        is_truncated = bool(max_duration_sec and max_duration_sec < total_duration)
        if is_truncated:
            duration_to_process = max_duration_sec
            frames_to_process = int(duration_to_process * fps)
        else:
            duration_to_process = total_duration
            frames_to_process = total_frames

        # Standard reference coordinates are 1280x720
        scale_x = orig_width / 1280.0
        scale_y = orig_height / 720.0

        # ROIs (in reference 1280x720 coordinates)
        hud_roi = (int(450 * scale_x), int(0 * scale_y), int(380 * scale_x), int(70 * scale_y))
        kf_roi = (int(940 * scale_x), int(35 * scale_y), int(335 * scale_x), int(190 * scale_y))

        # Scaling templates if resolution is different from 720p
        tmpl_f = self.tmpl_friendly
        tmpl_e = self.tmpl_enemy
        if scale_y != 1.0 and tmpl_f is not None:
            new_w = max(4, int(tmpl_f.shape[1] * scale_y))
            new_h = max(4, int(tmpl_f.shape[0] * scale_y))
            tmpl_f = cv2.resize(tmpl_f, (new_w, new_h))
            tmpl_e = cv2.resize(tmpl_e, (new_w, new_h))

        debug_reads = [] if debug_dump_path else None

        # Discover Roster & Match Start
        print(json.dumps({"type": "status", "message": "Identificando jogadores e agentes da partida..."}), flush=True)

        if not self.ocr:
            err_msg = (
                "Motor de OCR não pôde ser iniciado. "
                "Para analisar vídeos locais, instale as dependências executando: "
                "pip install rapidocr-onnxruntime opencv-python onnxruntime"
            )
            if self.ocr_error:
                err_msg += f" (Detalhe: {self.ocr_error})"
            print(json.dumps({"type": "error", "message": err_msg}), flush=True)
            cap.release()
            raise RuntimeError(err_msg)

        roster_override = load_roster_file(roster_file) if roster_file else None

        if scoreboard_only:
            roster = (
                dict(roster_override)
                if roster_override
                else build_initial_roster(user_nick, user_agent)
            )
            scoreboard_data = self.scan_for_scoreboard(
                cap,
                fps=fps,
                total_duration=total_duration,
                start_sec=max(0.0, total_duration - 180.0),
                roster=roster,
                scale_x=scale_x,
                scale_y=scale_y,
            )
            cap.release()

            if scoreboard_data:
                for p_name, p_info in scoreboard_data.items():
                    norm_p = normalize_nick(p_name)
                    if norm_p and norm_p not in roster:
                        roster[norm_p] = {
                            "canonical_nick": p_name,
                            "team": p_info.get("team", "unknown"),
                            "agent": p_info.get("agent", "Agente"),
                        }

            sb_score = getattr(self, "last_scoreboard_score", None)
            if sb_score and sb_score.get("rounds_count"):
                final_score = {
                    "friendly": int(sb_score["friendly"]),
                    "enemy": int(sb_score["enemy"]),
                }
                rounds_count = int(sb_score["rounds_count"])
                outcome_label = sb_score.get("outcome", "")
            else:
                total_fb = sum(
                    int(p.get("first_bloods", p.get("fb", 0)))
                    for p in (scoreboard_data or {}).values()
                )
                final_score = {"friendly": 0, "enemy": 0}
                rounds_count = total_fb
                outcome_label = ""

            players_stats = consolidate_players_stats([], roster)
            players_stats, sb_notes = reconcile_players_stats_with_scoreboard(
                players_stats,
                scoreboard_data or {},
                roster=roster,
                final_score=final_score if (final_score["friendly"] + final_score["enemy"]) > 0 else None,
                rounds_count=rounds_count if rounds_count > 0 else None,
                validate_consistency=True,
            )
            is_consistent, consistency_warnings = validate_scoreboard_consistency(
                scoreboard_data or {},
                roster=roster,
                final_score=final_score if (final_score["friendly"] + final_score["enemy"]) > 0 else None,
                rounds_count=rounds_count if rounds_count > 0 else None,
            )
            is_overtime = bool(
                rounds_count > 24
                or (final_score["friendly"] >= 12 and final_score["enemy"] >= 12 and rounds_count >= 24)
            )
            final_data = {
                "video": os.path.basename(video_path),
                "duration_sec": round(total_duration, 1),
                "is_truncated": False,
                "full_duration_sec": round(total_duration, 1),
                "scoreboard_only": True,
                "rounds_count": rounds_count,
                "is_overtime": is_overtime,
                "outcome": outcome_label,
                "final_score": final_score,
                "rounds": [],
                "all_kills": [],
                "players": players_stats,
                "players_stats": players_stats,
                "scoreboard_data": scoreboard_data,
                "scoreboard_consistency": {
                    "is_valid": is_consistent,
                    "warnings": consistency_warnings,
                },
                "roster_detected": {v["canonical_nick"]: v["agent"] for v in roster.values()},
                "user": {
                    "nick": user_nick or "Voce",
                    "agent": user_agent or "Agente",
                    "stats": None,
                },
                "quality": {
                    "score": 100 if is_consistent else 50,
                    "level": "high" if is_consistent else "low",
                    "warnings": consistency_warnings,
                    "notes": sb_notes,
                    "metrics": {
                        "scoreboard_only": True,
                        "scoreboard_players": len(scoreboard_data or {}),
                        "scoreboard_consistent": is_consistent,
                    },
                },
            }
            return final_data

        roster, gameplay_start_sec = self.discover_roster(
            cap,
            fps,
            user_nick=user_nick,
            user_agent=user_agent,
            debug_reads=debug_reads,
            roster_override=roster_override,
            ally_roster=ally_roster,
        )

        detected_map = self.detect_map(cap, fps, total_duration)

        frame_step = max(1, int(fps * sample_interval_sec))

        rounds = []
        discard_warnings: list[str] = []
        current_round_num = 1
        current_round_kills = []
        round_has_first_kill = False
        current_score_friendly = 0
        current_score_enemy = 0
        last_hud_sync_round_count = 0

        # Deduplication tracker for killfeed: list of (killer, victim, timestamp)
        recent_kills = []
        round_dead_times: dict[str, list[float]] = {}
        round_resurrected_players: set[str] = set()
        round_resurrections: list[dict] = []
        recent_resurrections: list[tuple[str, float]] = []
        team_death_capacity_bonus: dict[str, int] = {"friendly": 0, "enemy": 0}
        rejected_double_generic_events = []
        self.rejections_book = []
        duplicates_filtered_count = 0
        deaths_capacity_exceeded_count = 0

        current_frame_idx = 0
        last_progress_emit = 0
        current_round_start_time = gameplay_start_sec
        round_in_combat = False
        last_hud_gray = None
        last_hud_ocr_time = -999.0
        last_kf_gray = None
        last_banner_check_time = -999.0
        match_finished = False
        match_end_sec = None

        while current_frame_idx < frames_to_process:
            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            current_time_sec = current_frame_idx / fps
            time_str = format_time(current_time_sec)

            # Clean up deduplication cache older than DEFAULT_KILL_PRUNE_AGE_SEC
            recent_kills = prune_recent_kills(recent_kills, current_time_sec, max_age_sec=DEFAULT_KILL_PRUNE_AGE_SEC)

            # 1. Analyze Top HUD (Score & Round) with Smart Pixel Difference Cache
            if current_time_sec >= gameplay_start_sec and self.ocr:
                hx, hy, hw, hh = hud_roi
                hud_crop = frame[hy:hy+hh, hx:hx+hw]
                hud_gray = cv2.cvtColor(hud_crop, cv2.COLOR_BGR2GRAY)
                hud_diff = float(np.mean(cv2.absdiff(hud_gray, last_hud_gray))) if last_hud_gray is not None else 999.0

                # Only run OCR when HUD visibly changes (score update / round end) or periodic heartbeat (15s)
                if hud_diff > 2.0 or (current_time_sec - last_hud_ocr_time > 15.0):
                    last_hud_gray = hud_gray
                    last_hud_ocr_time = current_time_sec

                    hud_res, _ = self.ocr(hud_crop)
                    if hud_res:
                        if debug_reads is not None:
                            for r in hud_res:
                                debug_reads.append({
                                    "time_sec": round(current_time_sec, 2),
                                    "region": "hud_score",
                                    "text": r[1],
                                    "confidence": float(r[2]) if len(r) > 2 else 1.0,
                                    "box": [[float(pt[0]), float(pt[1])] for pt in r[0]],
                                })
                        friendly_digits = []
                        enemy_digits = []
                        for item in hud_res:
                            txt = item[1].strip()
                            if txt.isdigit():
                                val = int(txt)
                                if 0 <= val <= 25:
                                    cx = (item[0][0][0] + item[0][1][0]) / (2.0 * scale_x)
                                    if cx < 140:
                                        friendly_digits.append(val)
                                    elif cx > 240:
                                        enemy_digits.append(val)

                        if friendly_digits and enemy_digits:
                            detected_friendly = friendly_digits[0]
                            detected_enemy = enemy_digits[0]

                            # Sincronização se a soma de rounds for idêntica (ex: após rollover implícito),
                            # mas a distribuição do vencedor precisar de calibração fina com o HUD
                            if (detected_friendly + detected_enemy) == (current_score_friendly + current_score_enemy):
                                if detected_friendly != current_score_friendly or detected_enemy != current_score_enemy:
                                    current_score_friendly = detected_friendly
                                    current_score_enemy = detected_enemy
                                    if rounds:
                                        rounds[-1]["score_after"] = f"{detected_friendly}-{detected_enemy}"
                                        rounds[-1]["winner"] = "friendly" if detected_friendly > detected_enemy else "enemy"

                            is_valid_transition, winner, _f_diff, _e_diff, round_inc = validate_score_transition(
                                detected_friendly, detected_enemy, current_score_friendly, current_score_enemy
                            )

                            elapsed_in_round = current_time_sec - current_round_start_time

                            if is_valid_transition and elapsed_in_round >= 35.0:
                                if len(current_round_kills) == 0:
                                    # REGRA 1: Proibição Absoluta de Rodada Vazia (No Empty Round Rollover)
                                    current_score_friendly = detected_friendly
                                    current_score_enemy = detected_enemy
                                    current_round_start_time = current_time_sec
                                    round_dead_times.clear()
                                    round_resurrected_players.clear()
                                    recent_resurrections.clear()
                                    team_death_capacity_bonus = {"friendly": 0, "enemy": 0}
                                    round_has_first_kill = False
                                    round_in_combat = False
                                    if rounds:
                                        rounds[-1]["score_after"] = f"{detected_friendly}-{detected_enemy}"
                                        rounds[-1]["winner"] = winner
                                    last_hud_sync_round_count = len(rounds)
                                else:
                                    # REGRA 2: Idempotência entre Rollover Implícito e Retro-Split do HUD (Delta score >= 2)
                                    rounds_advanced_by_implicit = len(rounds) - last_hud_sync_round_count
                                    effective_round_inc = round_inc - rounds_advanced_by_implicit

                                    if effective_round_inc >= 2:
                                        split_records = split_round_on_score_jump(
                                            round_number=current_round_num,
                                            start_time_sec=current_round_start_time,
                                            end_time_sec=current_time_sec,
                                            score_before=(current_score_friendly, current_score_enemy),
                                            detected_score=(detected_friendly, detected_enemy),
                                            kills=current_round_kills,
                                            min_round_duration_sec=35.0,
                                            min_kills_per_subround=2,
                                            min_silence_gap_sec=25.0,
                                        )
                                        rounds.extend(split_records)
                                        current_round_num += len(split_records)
                                        print(
                                            f"[analyzer] Reconciliação de salto de placar (+{round_inc}, efetivo +{effective_round_inc}) aos {time_str}: "
                                            f"bloco dividido em {len(split_records)} rodadas distintas com interpolação de placar.",
                                            flush=True,
                                        )
                                    else:
                                        rounds.append(
                                            create_round_record(
                                                current_round_num,
                                                format_time(current_round_start_time),
                                                time_str,
                                                winner,
                                                detected_friendly,
                                                detected_enemy,
                                                current_round_kills,
                                                start_time_sec=current_round_start_time,
                                                end_time_sec=current_time_sec,
                                                buy_phase_start=format_time(current_round_start_time),
                                                score_before=f"{current_score_friendly}-{current_score_enemy}",
                                            )
                                        )
                                        current_round_num += 1

                                    current_score_friendly = detected_friendly
                                    current_score_enemy = detected_enemy
                                    current_round_kills = []
                                    round_has_first_kill = False
                                    round_dead_times.clear()
                                    round_resurrected_players.clear()
                                    recent_resurrections.clear()
                                    team_death_capacity_bonus = {"friendly": 0, "enemy": 0}
                                    current_round_start_time = current_time_sec
                                    round_in_combat = False
                                    last_hud_sync_round_count = len(rounds)

            # 2. Analyze Killfeed (Only after gameplay has started and OUTSIDE Buy Phase!)
            if current_time_sec >= gameplay_start_sec and self.ocr:
                kx, ky, kw, kh = kf_roi
                kf_crop = frame[ky:ky+kh, kx:kx+kw]

                green_mask = (kf_crop[:, :, 1] > 115) & (kf_crop[:, :, 1] > kf_crop[:, :, 2] + 20)
                # Support Red (default), Purple (Protanopia), and Yellow (Deuteranopia/Tritanopia) enemy highlight
                red_mask = (kf_crop[:, :, 2] > 125) & (kf_crop[:, :, 2] > kf_crop[:, :, 1] + 20)
                purple_mask = (kf_crop[:, :, 2] > 120) & (kf_crop[:, :, 0] > 120) & (kf_crop[:, :, 1] < 100)
                yellow_mask = (kf_crop[:, :, 2] > 125) & (kf_crop[:, :, 1] > 125) & (kf_crop[:, :, 0] < 100)
                enemy_mask = red_mask | purple_mask | yellow_mask

                g_sum = int(np.sum(green_mask))
                e_sum = int(np.sum(enemy_mask))
                has_kill_banner = (g_sum > 650) or (e_sum > 650)

                kf_gray = cv2.cvtColor(kf_crop, cv2.COLOR_BGR2GRAY)
                kf_diff = float(np.mean(cv2.absdiff(kf_gray, last_kf_gray))) if last_kf_gray is not None else 999.0
                if last_kf_gray is not None:
                    slot_band_diffs = [
                        float(np.mean(cv2.absdiff(kf_gray[int(y0 * scale_y) : int(y1 * scale_y), :], last_kf_gray[int(y0 * scale_y) : int(y1 * scale_y), :])))
                        for y0, y1 in [(26, 56), (52, 82), (78, 108), (104, 134), (130, 160)]
                        if int(y1 * scale_y) <= kf_gray.shape[0]
                    ]
                    max_slot_diff = max(slot_band_diffs) if slot_band_diffs else kf_diff
                else:
                    max_slot_diff = 999.0

                if has_kill_banner and (kf_diff > 1.5 or max_slot_diff > 3.5 or last_kf_gray is None):
                    # Verifica fase de compra dinamicamente pelo HUD antes de processar o killfeed
                    elapsed_in_round = current_time_sec - current_round_start_time
                    is_buy_phase, round_in_combat = self.is_hud_in_buy_phase(
                        frame=frame,
                        scale_x=scale_x,
                        scale_y=scale_y,
                        elapsed_in_round=elapsed_in_round,
                        round_in_combat=round_in_combat,
                    )
                    if is_buy_phase:
                        self.record_rejection_candidate(
                            reason="fase_de_compra",
                            crop=kf_crop,
                            current_time_sec=current_time_sec,
                            time_str=time_str,
                            round_num=current_round_num,
                            killer_raw="buy_phase_killfeed",
                            victim_raw="buy_phase_killfeed",
                            video_path=video_path,
                        )
                    kf_res = None
                    if not is_buy_phase:
                        last_kf_gray = kf_gray
                        # Single-pass batch OCR over the killfeed on GPU (use_cls=False avoids 180-deg HUD text flips)
                        kf_res, _ = self.ocr(kf_crop, use_cls=False)
                    if kf_res:
                        if debug_reads is not None:
                            for r in kf_res:
                                debug_reads.append({
                                    "time_sec": round(current_time_sec, 2),
                                    "region": "killfeed",
                                    "text": r[1],
                                    "confidence": float(r[2]) if len(r) > 2 else 1.0,
                                    "box": [[float(pt[0]), float(pt[1])] for pt in r[0]],
                                })

                        slot_rows = segment_killfeed_rows_by_slot(kf_res, scale_x=scale_x, scale_y=scale_y)

                        for row_info in slot_rows:
                            slot_idx = row_info["slot_idx"]
                            cy_mean = row_info["cy_mean"]
                            items = row_info["items"]

                            half_h = int(15 * scale_y)
                            y_start = max(0, round(cy_mean - half_h))
                            y_end = min(kh, round(cy_mean + half_h))
                            row_crop = kf_crop[y_start:y_end, :]

                            r_green = (row_crop[:, :, 1] > 110) & (row_crop[:, :, 1] > row_crop[:, :, 2] + 15)
                            r_red = (row_crop[:, :, 2] > 120) & (row_crop[:, :, 2] > row_crop[:, :, 1] + 15)
                            r_purple = (row_crop[:, :, 2] > 110) & (row_crop[:, :, 0] > 110) & (row_crop[:, :, 1] < 100)
                            r_yellow = (row_crop[:, :, 2] > 120) & (row_crop[:, :, 1] > 120) & (row_crop[:, :, 0] < 100)
                            r_enemy = r_red | r_purple | r_yellow

                            # Threshold elevado para 450 px para eliminar falsos positivos do cenário da Haven
                            if np.sum(r_green) < 450 and np.sum(r_enemy) < 450:
                                self.record_rejection_candidate(
                                    reason="outros",
                                    crop=row_crop,
                                    current_time_sec=current_time_sec,
                                    time_str=time_str,
                                    round_num=current_round_num,
                                    killer_raw="low_color_pixels",
                                    victim_raw="low_color_pixels",
                                    video_path=video_path,
                                )
                                continue

                            items.sort(key=lambda x: x[0])
                            killer_box_right = (
                                float(items[0][3][1][0])
                                if (len(items[0]) > 3 and items[0][0] < 180 * scale_x)
                                else None
                            )
                            victim_box_left = (
                                float(items[-1][3][0][0])
                                if (len(items[-1]) > 3 and items[-1][0] > 165 * scale_x)
                                else None
                            )

                            hs_loc = locate_killfeed_plaque_and_hs_window(
                                row_crop,
                                scale_x=scale_x,
                                scale_y=scale_y,
                                killer_box_right=killer_box_right,
                                victim_box_left=victim_box_left,
                            )
                            # Reconhece linhas de ressurreição no killfeed (estrutura monocromática com reviver + revivido)
                            if not hs_loc["has_opposite_plaques"]:
                                is_res = False
                                if len(items) >= 2:
                                    raw_reviver = items[0][2]
                                    raw_revived = items[-1][2]
                                    res_team = hs_loc["killer_team"]
                                    p1_nick, p1_agent = self.resolve_player(raw_reviver, res_team, roster, min_ratio=0.60)
                                    p2_nick, p2_agent = self.resolve_player(raw_revived, res_team, roster, min_ratio=0.60)
                                    is_res = (
                                        str(p1_agent).lower() in RESURRECTION_AGENTS
                                        or str(p2_agent).lower() in RESURRECTION_AGENTS
                                        or normalize_nick(p2_nick) in round_dead_times
                                    ) and (normalize_nick(p1_nick) != normalize_nick(p2_nick))
                                    if is_res:
                                        p2_norm = normalize_nick(p2_nick)
                                        # Deduplicação da ressurreição na janela temporal
                                        is_res_duplicate = any(
                                            r_norm == p2_norm and (current_time_sec - r_t) < DEFAULT_KILL_WINDOW_SEC
                                            for r_norm, r_t in recent_resurrections
                                        )
                                        if not is_res_duplicate:
                                            recent_resurrections.append((p2_norm, current_time_sec))
                                            round_resurrected_players.add(p2_norm)
                                            team_death_capacity_bonus[res_team] = team_death_capacity_bonus.get(res_team, 0) + 1
                                            res_event = {
                                                "type": "resurrection",
                                                "round": current_round_num,
                                                "time": time_str,
                                                "timestamp_sec": current_time_sec,
                                                "reviver": p1_nick,
                                                "reviver_agent": p1_agent,
                                                "revived": p2_nick,
                                                "revived_agent": p2_agent,
                                                "team": res_team,
                                            }
                                            round_resurrections.append(res_event)
                                            print(
                                                f"[analyzer] Ressurreição detectada aos {time_str} ({current_time_sec:.1f}s): "
                                                f"{p1_nick} ({p1_agent}) reviveu {p2_nick} ({p2_agent}) [{res_team}]. "
                                                f"Capacidade de mortes expandida para {5 + team_death_capacity_bonus[res_team]}.",
                                                flush=True,
                                            )
                                if not is_res:
                                    self.record_rejection_candidate(
                                        reason="faixa_cor_unica",
                                        crop=row_crop,
                                        current_time_sec=current_time_sec,
                                        time_str=time_str,
                                        round_num=current_round_num,
                                        killer_raw=items[0][2] if items else "",
                                        victim_raw=items[-1][2] if len(items) > 1 else "",
                                        video_path=video_path,
                                    )
                                continue

                            killer_team = hs_loc["killer_team"]
                            victim_team = hs_loc["victim_team"]
                            boundary_x = hs_loc["boundary_x"]

                            # Check Headshot via Template Matching em escala de cinza ancorado no blob da arma e fronteira das placas
                            mid_w_start = hs_loc["hs_x1"]
                            mid_w_end = hs_loc["hs_x2"]
                            mid_zone = row_crop[:, mid_w_start:mid_w_end]

                            is_headshot = False
                            target_tmpl = tmpl_e if tmpl_e is not None else tmpl_f
                            if target_tmpl is not None and mid_zone.shape[0] >= 15 and mid_zone.shape[1] >= 15:
                                mz_gray = cv2.cvtColor(mid_zone, cv2.COLOR_BGR2GRAY)
                                hs_gray = cv2.cvtColor(target_tmpl, cv2.COLOR_BGR2GRAY) if len(target_tmpl.shape) == 3 else target_tmpl
                                if scale_y != 1.0:
                                    new_th = max(10, int(hs_gray.shape[0] * scale_y))
                                    new_tw = max(10, int(hs_gray.shape[1] * scale_y))
                                    hs_gray_scaled = cv2.resize(hs_gray, (new_tw, new_th))
                                else:
                                    hs_gray_scaled = hs_gray

                                if mz_gray.shape[0] >= hs_gray_scaled.shape[0] and mz_gray.shape[1] >= hs_gray_scaled.shape[1]:
                                    res_hs = cv2.matchTemplate(mz_gray, hs_gray_scaled, cv2.TM_CCOEFF_NORMED)
                                    best_hs_score = float(np.max(res_hs))
                                    if debug_reads is not None:
                                        debug_reads.append({
                                            "time_sec": round(current_time_sec, 2),
                                            "region": "killfeed_headshot",
                                            "text": "[template_match]",
                                            "confidence": round(best_hs_score, 4),
                                            "box": [[float(mid_w_start), float(y_start)], [float(mid_w_end), float(y_end)]],
                                        })
                                    if best_hs_score > 0.65:
                                        is_headshot = True

                            left_items = [it for it in items if it[0] < boundary_x]
                            right_items = [it for it in items if it[0] >= boundary_x]
                            raw_k = " ".join(it[2] for it in left_items).strip()
                            raw_v = " ".join(it[2] for it in right_items).strip()

                            killer_nick, killer_agent = self.resolve_player(
                                raw_k, killer_team, roster, min_ratio=similarity_threshold, min_margin=margin_threshold
                            )
                            if len(left_items) > 1 and normalize_nick(killer_nick) in GENERIC_NICKS:
                                killer_nick, killer_agent = self.resolve_player(
                                    left_items[0][2], killer_team, roster, min_ratio=similarity_threshold, min_margin=margin_threshold
                                )

                            victim_nick, victim_agent = self.resolve_player(
                                raw_v, victim_team, roster, min_ratio=similarity_threshold, min_margin=margin_threshold
                            )
                            if len(right_items) > 1 and normalize_nick(victim_nick) in GENERIC_NICKS:
                                victim_nick, victim_agent = self.resolve_player(
                                    right_items[-1][2], victim_team, roster, min_ratio=similarity_threshold, min_margin=margin_threshold
                                )

                            # Inferência do Último Sobrevivente (Closed Elimination intra-round):
                            # Se o nome da vítima é genérico ou impreciso, mas 4 aliados/inimigos já morreram,
                            # crava o abate no único sobrevivente restante da equipe.
                            if normalize_nick(victim_nick) in GENERIC_NICKS or victim_nick.startswith("jogador ("):
                                last_survivor = infer_last_surviving_victim(
                                    raw_v,
                                    victim_team,
                                    roster,
                                    round_dead_times,
                                    round_resurrected_players,
                                )
                                if last_survivor is not None:
                                    victim_nick, victim_agent = last_survivor

                            # Imutabilidade de Time do Roster
                            k_roster_team = get_roster_player_team(killer_nick, roster)
                            v_roster_team = get_roster_player_team(victim_nick, roster)
                            if k_roster_team is not None:
                                killer_team = k_roster_team
                            if v_roster_team is not None:
                                victim_team = v_roster_team
                            if k_roster_team is not None and v_roster_team is None:
                                victim_team = "enemy" if killer_team == "friendly" else "friendly"
                            elif v_roster_team is not None and k_roster_team is None:
                                killer_team = "enemy" if victim_team == "friendly" else "friendly"

                            k_norm = normalize_nick(killer_nick)
                            v_norm = normalize_nick(victim_nick)

                            # Trava Anti-Clone / Auto-Abate
                            if k_norm and v_norm and k_norm == v_norm and k_norm not in GENERIC_NICKS:
                                self.record_rejection_candidate(
                                    reason="outros",
                                    crop=row_crop,
                                    current_time_sec=current_time_sec,
                                    time_str=time_str,
                                    round_num=current_round_num,
                                    killer_raw=killer_nick,
                                    victim_raw=victim_nick,
                                    video_path=video_path,
                                )
                                continue

                            # Trava Fogo Amigo Inválido (mesma equipe)
                            if killer_team and victim_team and killer_team == victim_team:
                                self.record_rejection_candidate(
                                    reason="outros",
                                    crop=row_crop,
                                    current_time_sec=current_time_sec,
                                    time_str=time_str,
                                    round_num=current_round_num,
                                    killer_raw=killer_nick,
                                    victim_raw=victim_nick,
                                    video_path=video_path,
                                )
                                continue

                            # Trava Intra-Frame: mesma vítima não pode ser aceita duas vezes em menos de 1.0s
                            if v_norm not in GENERIC_NICKS and not v_norm.startswith("jogador ("):
                                prev_v_times = round_dead_times.get(v_norm, [])
                                if prev_v_times and any(abs(current_time_sec - pt) < 1.0 for pt in prev_v_times):
                                    duplicates_filtered_count += 1
                                    self.record_rejection_candidate(
                                        reason="duplicata",
                                        crop=row_crop,
                                        current_time_sec=current_time_sec,
                                        time_str=time_str,
                                        round_num=current_round_num,
                                        killer_raw=killer_nick,
                                        victim_raw=victim_nick,
                                        video_path=video_path,
                                    )
                                    continue

                            # Substituição de Vítima por Confiança (Full-Named Eviction):
                            # Se a vítima já morreu para um assassino genérico e agora surge 100% nomeada,
                            # expulsa o fantasma e promove o abate real.
                            evicted_phantom = evict_half_generic_kill_for_named(
                                current_round_kills,
                                recent_kills,
                                round_dead_times,
                                killer_nick,
                                victim_nick,
                                current_time_sec,
                                victim_team,
                                round_resurrected_players,
                            )
                            if evicted_phantom:
                                print(
                                    f"[analyzer] Promoção de abate completo aos {time_str}: evento semi-genérico anterior "
                                    f"substituído pelo abate 100% nomeado '{killer_nick} -> {victim_nick}'.",
                                    flush=True,
                                )

                            # Rejeita abates fantasma onde nem assassino nem vítima foram identificados no elenco da partida
                            k_is_gen = (not k_norm) or (k_norm in GENERIC_NICKS) or k_norm.startswith("jogador (")
                            v_is_gen = (not v_norm) or (v_norm in GENERIC_NICKS) or v_norm.startswith("jogador (")
                            if k_is_gen and v_is_gen:
                                line_crop = kf_crop[max(0, int(y_start)):min(kf_crop.shape[0], int(y_end)), :] if (y_end > y_start and kf_crop is not None) else kf_crop
                                self.record_rejected_double_generic(
                                    crop=line_crop,
                                    current_time_sec=current_time_sec,
                                    time_str=time_str,
                                    raw_k=raw_k,
                                    raw_v=raw_v,
                                    video_path=video_path,
                                    rejected_list=rejected_double_generic_events,
                                )
                                self.record_rejection_candidate(
                                    reason="dupla_generica",
                                    crop=line_crop,
                                    current_time_sec=current_time_sec,
                                    time_str=time_str,
                                    round_num=current_round_num,
                                    killer_raw=raw_k,
                                    victim_raw=raw_v,
                                    video_path=video_path,
                                )
                                continue

                            merge_target_idx = find_kill_merge_target(
                                recent_kills,
                                killer_nick,
                                victim_nick,
                                current_time_sec,
                                window_sec=DEFAULT_KILL_WINDOW_SEC,
                                slot_idx=slot_idx,
                            )
                            if merge_target_idx is not None:
                                apply_kill_merge(
                                    recent_kills,
                                    merge_target_idx,
                                    killer_nick,
                                    killer_agent,
                                    victim_nick,
                                    victim_agent,
                                    is_headshot,
                                    round_dead_times,
                                    slot_idx=slot_idx,
                                )
                                continue

                            is_duplicate = is_duplicate_kill(
                                recent_kills,
                                killer_nick,
                                victim_nick,
                                current_time_sec,
                                window_sec=DEFAULT_KILL_WINDOW_SEC,
                                slot_idx=slot_idx,
                                is_headshot=is_headshot,
                            )

                            if is_duplicate:
                                duplicates_filtered_count += 1
                                self.record_rejection_candidate(
                                    reason="duplicata",
                                    crop=row_crop,
                                    current_time_sec=current_time_sec,
                                    time_str=time_str,
                                    round_num=current_round_num,
                                    killer_raw=killer_nick,
                                    victim_raw=victim_nick,
                                    video_path=video_path,
                                )
                                continue

                            can_record = can_record_death_in_round(
                                victim_nick,
                                round_dead_times,
                                current_time_sec,
                                victim_team,
                                roster,
                                max_team_deaths=5 + team_death_capacity_bonus.get(victim_team, 0),
                                resurrected_players=round_resurrected_players,
                            )

                            if not can_record:
                                # Evicção de Genéricos no Fechamento:
                                # Se o novo candidato tem vítima nomeada e a lista do round contém uma morte com vítima genérica,
                                # substitui a entrada genérica pela morte real.
                                can_evict_gen = evict_generic_victim_at_capacity(
                                    current_round_kills,
                                    recent_kills,
                                    round_dead_times,
                                    killer_nick,
                                    victim_nick,
                                    victim_team,
                                    effective_max=5 + team_death_capacity_bonus.get(victim_team, 0),
                                )
                                if can_evict_gen:
                                    can_record = True
                                    print(
                                        f"[analyzer] Evicção de genérico aos {time_str}: vaga liberada para o abate nomeado '{killer_nick} -> {victim_nick}'.",
                                        flush=True,
                                    )

                            # 1. Transição Implícita de Rodada em Tempo Real (por Hiato Biológico)
                            # Avalia se ocorreu hiato biológico de silêncio (vinheta + compra) com violação de unicidade/capacidade
                            if should_trigger_implicit_round_rollover(
                                current_round_kills=current_round_kills,
                                current_round_start_time=current_round_start_time,
                                current_time_sec=current_time_sec,
                                candidate_killer=killer_nick,
                                candidate_victim=victim_nick,
                                round_dead_times=round_dead_times,
                                victim_team=victim_team,
                                roster=roster,
                            ):
                                last_k_time = max(
                                    (float(k.get("timestamp_sec", current_round_start_time)) for k in current_round_kills),
                                    default=current_round_start_time,
                                )
                                rounds, current_round_num, current_round_start_time, current_round_kills, current_score_friendly, current_score_enemy = perform_implicit_round_rollover(
                                    rounds=rounds,
                                    current_round_num=current_round_num,
                                    current_round_start_time=current_round_start_time,
                                    current_round_kills=current_round_kills,
                                    current_score_friendly=current_score_friendly,
                                    current_score_enemy=current_score_enemy,
                                    current_time_sec=current_time_sec,
                                    last_accepted_kill_time=last_k_time,
                                )
                                round_dead_times.clear()
                                round_resurrected_players.clear()
                                recent_resurrections.clear()
                                team_death_capacity_bonus = {"friendly": 0, "enemy": 0}
                                round_has_first_kill = False
                                round_in_combat = True
                                last_hud_sync_round_count = len(rounds)

                                print(
                                    f"[analyzer] Transição Implícita de Rodada aos {time_str} ({current_time_sec:.1f}s): "
                                    f"Round {current_round_num - 1} fechado. Aberto Round {current_round_num}.",
                                    flush=True,
                                )

                                # Re-avalia se a vítima pode morrer dentro da nova rodada recém-aberta
                                can_record = can_record_death_in_round(
                                    victim_nick,
                                    round_dead_times,
                                    current_time_sec,
                                    victim_team,
                                    roster,
                                    has_resurrection=False,
                                    max_team_deaths=5,
                                    resurrected_players=round_resurrected_players,
                                )

                            if not can_record:
                                # Capacidade por seleção: ao exceder o teto, avalia se pode descartar um evento menos confiável
                                v_norm_c = normalize_nick(victim_nick)
                                is_gen_c = (not v_norm_c) or (v_norm_c in GENERIC_NICKS) or v_norm_c.startswith("jogador (")
                                prev_times_c = round_dead_times.get(v_norm_c, [])
                                team_kills_in_round = [
                                    k for k in current_round_kills
                                    if k.get("victim_team") == victim_team
                                ]
                                can_evict = False
                                if len(prev_times_c) == 0 or (v_norm_c in round_resurrected_players and len(prev_times_c) == 1):
                                    candidate_score = 100.0 if not is_gen_c else 20.0
                                    least_reliable = None
                                    least_score = 1e9
                                    for ek in team_kills_in_round:
                                        ek_v_norm = normalize_nick(str(ek.get("victim", "")))
                                        ek_k_norm = normalize_nick(str(ek.get("killer", "")))
                                        ek_is_gen = (
                                            (not ek_v_norm)
                                            or (ek_v_norm in GENERIC_NICKS)
                                            or ek_v_norm.startswith("jogador (")
                                            or (not ek_k_norm)
                                            or (ek_k_norm in GENERIC_NICKS)
                                            or ek_k_norm.startswith("jogador (")
                                        )
                                        ek_score = 10.0 if ek_is_gen else 90.0
                                        if ek_score < least_score:
                                            least_score = ek_score
                                            least_reliable = ek

                                    if least_reliable is not None and candidate_score > least_score:
                                        current_round_kills.remove(least_reliable)
                                        recent_kills = [rk for rk in recent_kills if rk[3] != least_reliable]
                                        evicted_v_norm = normalize_nick(str(least_reliable.get("victim", "")))
                                        if round_dead_times.get(evicted_v_norm):
                                            round_dead_times[evicted_v_norm].pop()
                                        print(
                                            f"[analyzer] Capacidade por seleção aos {time_str}: evento menos confiável "
                                            f"'{least_reliable.get('killer')} -> {least_reliable.get('victim')}' descartado "
                                            f"para acomodar abate confiável '{killer_nick} -> {victim_nick}'.",
                                            flush=True,
                                        )
                                        self.record_rejection_candidate(
                                            reason="capacidade_eviccao",
                                            crop=row_crop,
                                            current_time_sec=current_time_sec,
                                            time_str=time_str,
                                            round_num=current_round_num,
                                            killer_raw=str(least_reliable.get("killer", "")),
                                            victim_raw=str(least_reliable.get("victim", "")),
                                            video_path=video_path,
                                        )
                                        can_evict = True

                                if not can_evict:
                                    deaths_capacity_exceeded_count += 1
                                    self.record_rejection_candidate(
                                        reason="capacidade_eviccao",
                                        crop=row_crop,
                                        current_time_sec=current_time_sec,
                                        time_str=time_str,
                                        round_num=current_round_num,
                                        killer_raw=killer_nick,
                                        victim_raw=victim_nick,
                                        video_path=video_path,
                                    )
                                    continue

                            is_first_kill = not round_has_first_kill
                            if is_first_kill:
                                round_has_first_kill = True
                            round_in_combat = True

                            kill_event = build_kill_event(
                                current_round_num,
                                time_str,
                                current_time_sec,
                                killer_nick,
                                killer_agent,
                                victim_nick,
                                victim_agent,
                                killer_team,
                                victim_team,
                                is_headshot,
                                is_first_kill,
                            )
                            recent_kills.append((killer_nick, victim_nick, current_time_sec, kill_event, slot_idx))
                            norm_v = normalize_nick(victim_nick)
                            round_dead_times.setdefault(norm_v, []).append(current_time_sec)
                            current_round_kills.append(kill_event)

                            # Stream event out to stdout
                            print(json.dumps({"type": "kill_event", "event": kill_event}), flush=True)

            # 3. Detect End of Match Screen (Victory / Defeat banner in screen center)
            # Active after round 12 has concluded or total score >= 12
            if (current_score_friendly + current_score_enemy >= 12) and current_time_sec >= gameplay_start_sec and self.ocr:
                if (current_time_sec - last_banner_check_time) >= 2.0:
                    last_banner_check_time = current_time_sec
                    cy1, cy2 = int(220 * scale_y), int(460 * scale_y)
                    cx1, cx2 = int(350 * scale_x), int(930 * scale_x)
                    center_crop = frame[cy1:cy2, cx1:cx2]
                    center_res, _ = self.ocr(center_crop)
                    if center_res:
                        match_finished = False
                        for item in center_res:
                            t_norm = normalize_nick(item[1])
                            if any(w in t_norm for w in ["vitoria", "victory", "derrota", "defeat"]):
                                print(
                                    f"[analyzer] Banner de fim de partida detectado na tela ('{item[1]}' aos {time_str}). Finalizando analise de gameplay.",
                                    flush=True,
                                )
                                match_finished = True
                                match_end_sec = current_time_sec
                                break
                        if match_finished:
                            break

            # Emit progress update every 1 second
            if time.time() - last_progress_emit > 1.0:
                percent = int((current_frame_idx / frames_to_process) * 100)
                print(json.dumps({
                    "type": "progress",
                    "percent": percent,
                    "current_time": time_str,
                    "current_round": current_round_num,
                    "score": f"{current_score_friendly}-{current_score_enemy}",
                    "total_kills_found": sum(len(r["kills"]) for r in rounds) + len(current_round_kills),
                }), flush=True)
                last_progress_emit = time.time()

            current_frame_idx += frame_step

        # Wrap up final round
        rounds = wrap_up_final_round(
            rounds,
            current_round_num,
            current_round_start_time,
            duration_to_process,
            current_score_friendly,
            current_score_enemy,
            current_round_kills,
            rounds_to_win=rounds_to_win,
            overtime_mode=overtime_mode,
            quality_warnings=discard_warnings,
        )

        # 3. Reconciliação de Cardinalidade Pós-Jogo (24 Rounds Exatos para 12-12)
        rounds = reconcile_match_rounds_cardinality(
            rounds=rounds,
            official_friendly_score=current_score_friendly,
            official_enemy_score=current_score_enemy,
        )

        # Consolidate Player Stats with Agent and Team
        all_kills = []
        for r in rounds:
            all_kills.extend(r["kills"])

        players_stats = consolidate_players_stats(all_kills, roster)
        final_score = {
            "friendly": current_score_friendly,
            "enemy": current_score_enemy,
        }

        # Enrich roster with all discovered player names from killfeed (e.g. PlayerOne)
        enriched_roster = dict(roster)
        for p_norm, p_data in players_stats.items():
            if p_norm not in enriched_roster:
                enriched_roster[p_norm] = {
                    "canonical_nick": p_data.get("canonical_nick", p_norm),
                    "team": p_data.get("team", "unknown"),
                    "agent": p_data.get("agent", "Agente"),
                }

        # 4. Scan for Final Official Scoreboard (Tab / Match Summary) for 100% precision
        scoreboard_data = None
        if self.ocr and not is_truncated and scoreboard_scan:
            search_start = max(gameplay_start_sec, match_end_sec if match_finished and match_end_sec else (total_duration - 120.0))
            print(
                json.dumps({
                    "type": "status",
                    "message": "Buscando tela de Scoreboard/Placar oficial para reconciliação com 100% de precisão...",
                }),
                flush=True,
            )
            scoreboard_data = self.scan_for_scoreboard(
                cap,
                fps=fps,
                total_duration=total_duration,
                start_sec=search_start,
                roster=enriched_roster,
                scale_x=scale_x,
                scale_y=scale_y,
                rounds_count=len(rounds),
                final_score=final_score,
            )

        cap.release()

        scoreboard_notes = []
        if scoreboard_data:
            players_stats, scoreboard_notes = reconcile_players_stats_with_scoreboard(
                players_stats,
                scoreboard_data,
                roster=enriched_roster,
                final_score=final_score,
                rounds_count=len(rounds),
                validate_consistency=True,
            )
            is_verified = any(s.get("scoreboard_verified") for s in players_stats.values())
            if is_verified:
                print(
                    json.dumps({
                        "type": "scoreboard_sync",
                        "message": f"Scoreboard oficial sincronizado ({len(scoreboard_data)} jogadores verificados).",
                        "data": scoreboard_data,
                    }),
                    flush=True,
                )
            # Calibração estrita da soma do placar pelo total de First Bloods verificados no Scoreboard
            total_fb = sum(p.get("first_bloods", 0) for p in scoreboard_data.values())
            if total_fb > 0:
                score_sum = final_score["friendly"] + final_score["enemy"]
                if score_sum > total_fb:
                    diff = score_sum - total_fb
                    if final_score["friendly"] >= final_score["enemy"]:
                        final_score["friendly"] -= diff
                    else:
                        final_score["enemy"] -= diff

            rounds = reconcile_match_rounds_cardinality(
                rounds=rounds,
                official_friendly_score=final_score["friendly"],
                official_enemy_score=final_score["enemy"],
            )
            all_kills = [k for r in rounds for k in r["kills"]]

        # Sample 20 random crops per reason with fixed seed 42 for revision
        import random
        import shutil
        rng = random.Random(42)
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        vod_name = os.path.splitext(os.path.basename(video_path))[0] if video_path else "vod"
        sample_root = os.path.join(root_dir, "scratch", "rejections_sample_20", vod_name)
        os.makedirs(sample_root, exist_ok=True)

        rejections_by_reason = {}
        rejections_by_round = {}
        sampled_20_by_reason = {}

        for entry in getattr(self, "rejections_book", []):
            r_reason = entry["reason"]
            r_round = entry["round_number"]
            rejections_by_reason[r_reason] = rejections_by_reason.get(r_reason, 0) + 1
            if r_round not in rejections_by_round:
                rejections_by_round[r_round] = {}
            rejections_by_round[r_round][r_reason] = rejections_by_round[r_round].get(r_reason, 0) + 1

        for reason in ["duplicata", "capacidade_eviccao", "dupla_generica", "fase_de_compra", "faixa_cor_unica", "outros"]:
            matching = [e for e in getattr(self, "rejections_book", []) if e["reason"] == reason]
            sample_count = min(20, len(matching))
            sampled = rng.sample(matching, sample_count) if sample_count > 0 else []
            r_sample_dir = os.path.join(sample_root, reason)
            os.makedirs(r_sample_dir, exist_ok=True)
            sampled_paths = []
            for s_entry in sampled:
                src_path = os.path.join(root_dir, s_entry["crop_path"])
                if os.path.exists(src_path):
                    dst_path = os.path.join(r_sample_dir, os.path.basename(src_path))
                    shutil.copy2(src_path, dst_path)
                    sampled_paths.append(os.path.relpath(dst_path, root_dir))
            sampled_20_by_reason[reason] = sampled_paths

        rejections_summary = {
            "vod": vod_name,
            "total_rejections": len(getattr(self, "rejections_book", [])),
            "by_reason": rejections_by_reason,
            "by_round": rejections_by_round,
            "sampled_20_by_reason": sampled_20_by_reason,
        }
        rej_sum_path = os.path.join(root_dir, "scratch", f"rejections_summary_{vod_name}.json")
        try:
            with open(rej_sum_path, "w", encoding="utf-8") as rf:
                json.dump(rejections_summary, rf, indent=2, ensure_ascii=False)
        except Exception:
            pass

        tactical_summary = compute_tactical_metrics(
            rounds=rounds,
            roster=enriched_roster,
            scoreboard_players=scoreboard_data or players_stats,
        )
        all_kills = [k for r in rounds for k in r.get("kills", [])]

        for p_can, p_data in players_stats.items():
            tact = tactical_summary.get("player_tactical_stats", {}).get(p_can)
            if tact and isinstance(p_data, dict):
                p_data["trade_kills"] = tact["trade_kills"]
                p_data["traded_deaths"] = tact["traded_deaths"]
                p_data["untraded_deaths"] = tact["untraded_deaths"]
                p_data["clutches_won"] = tact["clutches_won"]
                p_data["clutches_detail"] = tact["clutches_detail"]
                p_data["kast_pct"] = tact["kast_pct"]
                p_data["kst_rounds"] = tact["kst_rounds"]

        warnings = discard_warnings + scoreboard_notes + generate_quality_warnings(
            rounds, final_score, roster, players_stats, is_truncated=is_truncated
        )

        final_data = {
            "video_path": video_path,
            "map": detected_map,
            "duration": format_time(duration_to_process),
            "final_score": final_score,
            "rounds_count": len(rounds),
            "rounds": rounds,
            "all_kills": all_kills,
            "players_stats": players_stats,
            "scoreboard_data": scoreboard_data,
            "tactical_summary": tactical_summary,
            "scoreboard_verified": getattr(self, "scoreboard_verified", False),
            "scoreboard_frames_used": getattr(self, "scoreboard_frames_used", []),
            "scoreboard_raw_cells": getattr(self, "scoreboard_raw_cells", {}),
            "scoreboard_consistency": getattr(self, "scoreboard_consistency", {}),
            "rejected_double_generic_count": len(rejected_double_generic_events),
            "rejected_double_generic_events": rejected_double_generic_events,
            "duplicates_filtered_count": duplicates_filtered_count,
            "deaths_capacity_exceeded_count": deaths_capacity_exceeded_count,
            "rejections_summary": rejections_summary,
            "quality": {
                "warnings": warnings,
            },
            "analyzed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        if debug_dump_path and debug_reads is not None:
            dump_dir = os.path.dirname(os.path.abspath(debug_dump_path))
            if dump_dir:
                os.makedirs(dump_dir, exist_ok=True)
            dump_payload = {
                "dump_version": "1.0",
                "video_metadata": {
                    "fps": round(float(fps), 2),
                    "width": orig_width,
                    "height": orig_height,
                    "total_frames": total_frames,
                    "duration_sec": round(float(total_duration), 2),
                },
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "reads_count": len(debug_reads),
                "reads": debug_reads,
            }
            with open(debug_dump_path, "w", encoding="utf-8") as df:
                json.dump(dump_payload, df, indent=2, ensure_ascii=False)
            print(
                json.dumps({
                    "type": "debug_dump",
                    "file": debug_dump_path,
                    "dump_version": "1.0",
                    "records_count": len(debug_reads),
                    "warning": "Aviso: este arquivo contém leituras brutas de OCR e nomes reais de jogadores",
                }),
                flush=True,
            )

        return final_data


def main():
    parser = argparse.ArgumentParser(description="Analisador de VODs de Treino de Valorant")
    parser.add_argument("--video", required=True, help="Caminho do arquivo de video MP4/MOV/MKV")
    parser.add_argument("--output", help="Caminho do arquivo JSON de saida")
    parser.add_argument("--max-seconds", type=float, default=None, help="Limitar analise aos primeiros N segundos")
    parser.add_argument("--interval", type=float, default=1.0, help="Intervalo de amostragem em segundos (padrao 1.0s)")
    parser.add_argument("--user-nick", default=None, help="Nickname do usuario na partida")
    parser.add_argument("--user-agent", default=None, help="Agente jogado pelo usuario")
    parser.add_argument(
        "--rounds-to-win",
        type=int,
        default=13,
        help="Quantidade de rodadas necessárias para vitória (padrão: 13, com regra de +2 no overtime)",
    )
    parser.add_argument(
        "--overtime-mode",
        choices=["unknown", "win-by-two", "sudden-death"],
        default="unknown",
        help="Regra de prorrogação: win-by-two (+2 rounds), sudden-death (+1 round) ou unknown (padrão: preserva rodadas)",
    )
    parser.add_argument(
        "--roster-file",
        default=None,
        help="Caminho do arquivo JSON com 10 jogadores confirmados (time e agente) para sobrepor a descoberta automática",
    )
    parser.add_argument(
        "--ally-roster",
        default=None,
        help="Elenco aliado pré-definido com 5 apelidos separados por vírgula (ex: 'nick1,nick2,nick3,nick4,nick5')",
    )
    parser.add_argument(
        "--debug-dump",
        default=None,
        help="Caminho do arquivo JSON para gravar leituras brutas de OCR (tempo, regiao, texto, confianca) para testes offline",
    )
    parser.add_argument(
        "--min-consensus-reads",
        type=int,
        default=2,
        help="Quantidade mínima de leituras no killfeed para promover apelido às vagas vazias do elenco (padrão: 2)",
    )
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=0.65,
        help="Limiar de similaridade mínima para matching de jogadores (padrão: 0.65)",
    )
    parser.add_argument(
        "--margin-threshold",
        type=float,
        default=0.10,
        help="Margem de segurança entre melhor e segundo colocado para evitar ambiguidade (padrão: 0.10)",
    )
    parser.add_argument(
        "--detect-roster-only",
        action="store_true",
        help="Apenas extrai o elenco de jogadores a partir do pré-jogo e encerra em poucos segundos",
    )
    parser.add_argument(
        "--no-scoreboard-scan",
        action="store_true",
        help="Desativa a varredura e reconciliação pelo Scoreboard oficial pós-jogo",
    )
    parser.add_argument(
        "--scoreboard-only",
        action="store_true",
        help="Lê apenas a tela final de Scoreboard do vídeo (sem rodar o pipeline do killfeed)",
    )

    args = parser.parse_args()

    analyzer = ValorantAnalyzer()

    if args.detect_roster_only:
        roster_data = analyzer.detect_roster(
            video_path=args.video,
            user_nick=args.user_nick,
            user_agent=args.user_agent,
            roster_file=args.roster_file,
            ally_roster=args.ally_roster,
            scan_scoreboard=not args.no_scoreboard_scan,
        )
        print(json.dumps({"type": "roster_detected", "data": roster_data}, ensure_ascii=False), flush=True)
        return
    result = analyzer.analyze_vod(
        video_path=args.video,
        max_duration_sec=args.max_seconds,
        sample_interval_sec=args.interval,
        user_nick=args.user_nick,
        user_agent=args.user_agent,
        debug_dump_path=args.debug_dump,
        rounds_to_win=args.rounds_to_win,
        overtime_mode=args.overtime_mode,
        roster_file=args.roster_file,
        ally_roster=args.ally_roster,
        min_consensus_reads=args.min_consensus_reads,
        similarity_threshold=args.similarity_threshold,
        margin_threshold=args.margin_threshold,
        scoreboard_scan=not args.no_scoreboard_scan,
        scoreboard_only=args.scoreboard_only,
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(json.dumps({"type": "complete", "output_file": args.output, "data": result}), flush=True)
    else:
        print(json.dumps({"type": "complete", "data": result}), flush=True)


if __name__ == "__main__":
    main()
