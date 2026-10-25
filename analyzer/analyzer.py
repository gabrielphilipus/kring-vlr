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

import sys
import os
import json
import argparse
import time
import re
import cv2
import numpy as np

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

try:
    from rapidocr_onnxruntime import RapidOCR
    RAPID_OCR_AVAILABLE = True
except ImportError:
    RAPID_OCR_AVAILABLE = False


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


def format_time(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m:02d}:{s:02d}"


def normalize_nick(txt: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\s]", "", txt).strip().lower()


class ValorantAnalyzer:
    def __init__(self, templates_dir: str = None):
        if templates_dir is None:
            templates_dir = os.path.join(os.path.dirname(__file__), "templates")
        
        self.templates_dir = templates_dir
        self.tmpl_friendly = cv2.imread(os.path.join(templates_dir, "hs_friendly.png"))
        self.tmpl_enemy = cv2.imread(os.path.join(templates_dir, "hs_enemy.png"))
        
        if RAPID_OCR_AVAILABLE:
            try:
                # Prioritize DirectML on Windows (e.g. NVIDIA GTX 1650) for fast GPU inference
                self.ocr = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
            except Exception:
                self.ocr = RapidOCR()
        else:
            self.ocr = None

    def discover_roster(self, cap, fps, user_nick=None, user_agent=None):
        """
        Scans pre-match screens (agent select, VS loading screen, buy phase)
        to extract the 5 friendly and 5 enemy player nicknames and their agents.
        Also identifies when active gameplay starts.
        """
        roster = {}
        gameplay_start_sec = 45.0 # Default safe fallback

        if user_nick:
            u_clean = user_nick.strip()
            roster[normalize_nick(u_clean)] = {
                "canonical_nick": u_clean,
                "agent": user_agent or "Agente",
                "team": "friendly"
            }

        if not self.ocr:
            return roster, gameplay_start_sec

        # Check key frames: sec 20 (agent select) and sec 30 (VS screen)
        sample_seconds = [20, 30]
        for sec in sample_seconds:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(sec * fps))
            ret, frame = cap.read()
            if not ret:
                continue

            h, w, _ = frame.shape
            scale_x = w / 1280.0
            scale_y = h / 720.0

            # Left column crop (friendly cards)
            left_crop = frame[int(140 * scale_y):int(680 * scale_y), 0:int(450 * scale_x)]
            res_left, _ = self.ocr(left_crop)

            left_nicks = []
            left_agents = []

            if res_left:
                for r in res_left:
                    txt = r[1].strip()
                    box = r[0]
                    x1 = int(box[0][0] / scale_x)
                    y1 = int(box[0][1] / scale_y)
                    t_low = txt.lower()

                    matched_ag = None
                    for ag in VALORANT_AGENTS:
                        if ag.lower() in t_low:
                            matched_ag = ag
                            break

                    if matched_ag:
                        left_agents.append((y1, matched_ag))
                    elif len(txt) >= 3 and t_low not in IGNORE_WORDS and x1 < 200:
                        left_nicks.append((y1, txt))

                for ny, nick in left_nicks:
                    norm = normalize_nick(nick)
                    if norm not in roster:
                        best_ag = "Agente"
                        for ay, ag in left_agents:
                            if abs(ny - ay) < 55:
                                best_ag = ag
                                break
                        roster[norm] = {"canonical_nick": nick, "agent": best_ag, "team": "friendly"}

            # Right column crop (enemy cards in VS screen at sec 30)
            if sec >= 28:
                right_crop = frame[int(180 * scale_y):int(680 * scale_y), int(850 * scale_x):w]
                res_right, _ = self.ocr(right_crop)
                right_nicks = []
                right_agents = []

                if res_right:
                    for r in res_right:
                        txt = r[1].strip()
                        box = r[0]
                        y1 = int(box[0][1] / scale_y)
                        t_low = txt.lower()

                        matched_ag = None
                        for ag in VALORANT_AGENTS:
                            if ag.lower() in t_low:
                                matched_ag = ag
                                break

                        if matched_ag:
                            right_agents.append((y1, matched_ag))
                        elif len(txt) >= 3 and t_low not in IGNORE_WORDS:
                            right_nicks.append((y1, txt))

                    for ny, nick in right_nicks:
                        norm = normalize_nick(nick)
                        if norm not in roster:
                            best_ag = "Agente"
                            for ay, ag in right_agents:
                                if abs(ny - ay) < 55:
                                    best_ag = ag
                                    break
                            roster[norm] = {"canonical_nick": nick, "agent": best_ag, "team": "enemy"}

        return roster, gameplay_start_sec

    def resolve_player(self, raw_text: str, team: str, roster: dict):
        """
        Resolves raw OCR text into (canonical_nickname, agent_name).
        Handles player nicknames, agent fallbacks, and team correlation.
        """
        if not raw_text:
            return ("Aliado" if team == "friendly" else "Inimigo", "Agente")

        cleaned = raw_text.strip()
        norm = normalize_nick(cleaned)

        # Reject pure numbers, math/ratio strings, or strings without ASCII letters
        has_letters = bool(re.search(r"[a-zA-Z]", cleaned))
        if not has_letters or len(cleaned) < 2 or norm in IGNORE_WORDS:
            return ("Aliado" if team == "friendly" else "Inimigo", "Agente")

        # 1. Exact or substring match against known roster
        for r_norm, info in roster.items():
            if r_norm == norm or (len(r_norm) >= 4 and r_norm in norm) or (len(norm) >= 4 and norm in r_norm):
                return (info["canonical_nick"], info["agent"])

        # 2. Check if raw_text is an agent name (e.g. OCR read 'Fade' or 'Chamber')
        for ag in VALORANT_AGENTS:
            if ag.lower() in norm:
                # Find player on this team playing this agent
                for r_norm, info in roster.items():
                    if info["team"] == team and info["agent"].lower() == ag.lower():
                        return (info["canonical_nick"], info["agent"])
                # Return agent with generic player name
                return (f"Jogador ({ag})", ag)

        # 3. Clean player nickname if not in IGNORE_WORDS and has letters
        if len(norm) >= 3 and norm not in IGNORE_WORDS:
            # Check if there is an existing roster player with very close edit distance (diff <= 1)
            for r_norm, info in roster.items():
                if abs(len(r_norm) - len(norm)) <= 1:
                    diffs = sum(1 for a, b in zip(r_norm, norm) if a != b) + abs(len(r_norm) - len(norm))
                    if diffs <= 1:
                        return (info["canonical_nick"], info["agent"])

            # Register dynamically into roster so future kills have same info
            roster[norm] = {"canonical_nick": cleaned, "agent": "Agente", "team": team}
            return (cleaned, "Agente")

        return ("Aliado" if team == "friendly" else "Inimigo", "Agente")

    def analyze_vod(self, video_path: str, max_duration_sec: float = None, sample_interval_sec: float = 1.0, user_nick: str = None, user_agent: str = None):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Nao foi possivel abrir o video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        orig_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        orig_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_duration = total_frames / fps

        if max_duration_sec and max_duration_sec < total_duration:
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

        # Discover Roster & Match Start
        print(json.dumps({"type": "status", "message": "Identificando jogadores e agentes da partida..."}), flush=True)
        roster, gameplay_start_sec = self.discover_roster(cap, fps, user_nick=user_nick, user_agent=user_agent)

        frame_step = max(1, int(fps * sample_interval_sec))
        
        rounds = []
        current_round_num = 1
        current_round_kills = []
        round_has_first_kill = False
        current_score_friendly = 0
        current_score_enemy = 0
        
        # Deduplication tracker for killfeed: list of (killer, victim, timestamp)
        recent_kills = []
        
        current_frame_idx = 0
        last_progress_emit = 0
        current_round_start_time = gameplay_start_sec
        last_hud_gray = None
        last_hud_ocr_time = -999.0
        last_kf_gray = None

        while current_frame_idx < frames_to_process:
            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            current_time_sec = current_frame_idx / fps
            time_str = format_time(current_time_sec)

            # Clean up deduplication cache older than 5 seconds
            recent_kills = [k for k in recent_kills if current_time_sec - k[2] < 5.0]

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

                            # In Valorant, score increments by exactly +1 for the winning team
                            friendly_scored = (detected_friendly == current_score_friendly + 1 and detected_enemy == current_score_enemy)
                            enemy_scored = (detected_enemy == current_score_enemy + 1 and detected_friendly == current_score_friendly)

                            if friendly_scored or enemy_scored:
                                winner = "friendly" if friendly_scored else "enemy"
                                rounds.append({
                                    "round_number": current_round_num,
                                    "start_time": format_time(current_round_start_time),
                                    "end_time": time_str,
                                    "winner": winner,
                                    "score_after": f"{detected_friendly}-{detected_enemy}",
                                    "kills": current_round_kills,
                                })

                                current_round_num += 1
                                current_score_friendly = detected_friendly
                                current_score_enemy = detected_enemy
                                current_round_kills = []
                                round_has_first_kill = False
                                current_round_start_time = current_time_sec

            # 2. Analyze Killfeed (Only after gameplay has started!)
            if current_time_sec >= gameplay_start_sec and self.ocr:
                kx, ky, kw, kh = kf_roi
                kf_crop = frame[ky:ky+kh, kx:kx+kw]

                green_mask = (kf_crop[:, :, 1] > 115) & (kf_crop[:, :, 1] > kf_crop[:, :, 2] + 25)
                red_mask = (kf_crop[:, :, 2] > 130) & (kf_crop[:, :, 2] > kf_crop[:, :, 1] + 25)
                g_sum = int(np.sum(green_mask))
                r_sum = int(np.sum(red_mask))
                has_kill_banner = (g_sum > 750) or (r_sum > 750)

                kf_gray = cv2.cvtColor(kf_crop, cv2.COLOR_BGR2GRAY)
                kf_diff = float(np.mean(cv2.absdiff(kf_gray, last_kf_gray))) if last_kf_gray is not None else 999.0

                if has_kill_banner and (kf_diff > 3.5 or last_kf_gray is None):
                    last_kf_gray = kf_gray
                    # Single-pass batch OCR over the killfeed on GPU
                    kf_res, _ = self.ocr(kf_crop)
                    if kf_res:
                        row_height = int(35 * scale_y)
                        items_by_row = {}
                        for item in kf_res:
                            box = item[0]
                            txt = item[1].strip()
                            if not txt or len(txt) < 2:
                                continue
                            cy = (box[0][1] + box[2][1]) / 2.0
                            cx = (box[0][0] + box[2][0]) / 2.0
                            r_idx = int(cy // row_height)
                            if 0 <= r_idx < 4:
                                if r_idx not in items_by_row:
                                    items_by_row[r_idx] = []
                                items_by_row[r_idx].append((cx, txt))

                        for r_idx, items in items_by_row.items():
                            y_start = r_idx * row_height
                            y_end = min(kh, (r_idx + 1) * row_height)
                            row_crop = kf_crop[y_start:y_end, :]

                            r_green = (row_crop[:, :, 1] > 110) & (row_crop[:, :, 1] > row_crop[:, :, 2] + 20)
                            r_red = (row_crop[:, :, 2] > 125) & (row_crop[:, :, 2] > row_crop[:, :, 1] + 20)
                            if np.sum(r_green) < 150 and np.sum(r_red) < 150:
                                continue

                            mid_x = row_crop.shape[1] // 2
                            left_green = np.sum(r_green[:, :mid_x])
                            left_red = np.sum(r_red[:, :mid_x])

                            if left_green > left_red:
                                killer_team = "friendly"
                                victim_team = "enemy"
                            else:
                                killer_team = "enemy"
                                victim_team = "friendly"

                            # Check Headshot via Template Matching in middle zone
                            mid_w_start = int(120 * scale_x)
                            mid_w_end = int(230 * scale_x)
                            mid_zone = row_crop[:, mid_w_start:mid_w_end]

                            is_headshot = False
                            if tmpl_f is not None and tmpl_e is not None and mid_zone.shape[0] >= tmpl_f.shape[0] and mid_zone.shape[1] >= tmpl_f.shape[1]:
                                res_f = cv2.matchTemplate(mid_zone, tmpl_f, cv2.TM_CCOEFF_NORMED)
                                res_e = cv2.matchTemplate(mid_zone, tmpl_e, cv2.TM_CCOEFF_NORMED)
                                best_hs_score = max(np.max(res_f), np.max(res_e))
                                if best_hs_score > 0.65:
                                    is_headshot = True

                            items.sort(key=lambda x: x[0])
                            if len(items) >= 2:
                                raw_k = items[0][1]
                                raw_v = items[-1][1]
                            else:
                                if items[0][0] < (180 * scale_x):
                                    raw_k = items[0][1]
                                    raw_v = ""
                                else:
                                    raw_k = ""
                                    raw_v = items[0][1]

                            killer_nick, killer_agent = self.resolve_player(raw_k, killer_team, roster)
                            victim_nick, victim_agent = self.resolve_player(raw_v, victim_team, roster)

                            # Deduplication check: ignore if same killer or victim within 4.5 seconds
                            is_duplicate = False
                            for prev_k, prev_v, prev_t in recent_kills:
                                if (prev_k.lower() == killer_nick.lower() or prev_v.lower() == victim_nick.lower()) and (current_time_sec - prev_t < 4.5):
                                    is_duplicate = True
                                    break

                            if not is_duplicate:
                                recent_kills.append((killer_nick, victim_nick, current_time_sec))

                                is_first_kill = not round_has_first_kill
                                if is_first_kill:
                                    round_has_first_kill = True

                                kill_event = {
                                    "round": current_round_num,
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
                                    "event_label": "First Kill" if (is_first_kill and killer_team == "friendly") else "First Death" if (is_first_kill and killer_team == "enemy") else "Kill",
                                }
                                current_round_kills.append(kill_event)

                                # Stream event out to stdout
                                print(json.dumps({"type": "kill_event", "event": kill_event}), flush=True)

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

        cap.release()

        # Wrap up final round
        if current_round_kills or not rounds:
            rounds.append({
                "round_number": current_round_num,
                "start_time": format_time(current_round_start_time),
                "end_time": format_time(duration_to_process),
                "winner": "friendly" if current_score_friendly > current_score_enemy else "enemy",
                "score_after": f"{current_score_friendly}-{current_score_enemy}",
                "kills": current_round_kills,
            })

        # Consolidate Player Stats with Agent and Team
        all_kills = []
        for r in rounds:
            all_kills.extend(r["kills"])

        players_stats = {}
        for k in all_kills:
            killer = k["killer"]
            victim = k["victim"]

            if killer and killer not in ("Aliado", "Inimigo", "Agente") and not killer.startswith("Jogador ("):
                if killer not in players_stats:
                    players_stats[killer] = {
                        "agent": k.get("killer_agent") or "Agente",
                        "team": k["killer_team"],
                        "kills": 0,
                        "deaths": 0,
                        "headshots": 0,
                        "first_kills": 0,
                        "first_deaths": 0,
                    }
                elif players_stats[killer]["agent"] == "Agente" and k.get("killer_agent"):
                    players_stats[killer]["agent"] = k["killer_agent"]

                players_stats[killer]["kills"] += 1
                if k["headshot"]:
                    players_stats[killer]["headshots"] += 1
                if k["first_kill"]:
                    players_stats[killer]["first_kills"] += 1

            if victim and victim not in ("Aliado", "Inimigo", "Agente") and not victim.startswith("Jogador ("):
                if victim not in players_stats:
                    players_stats[victim] = {
                        "agent": k.get("victim_agent") or "Agente",
                        "team": k["victim_team"],
                        "kills": 0,
                        "deaths": 0,
                        "headshots": 0,
                        "first_kills": 0,
                        "first_deaths": 0,
                    }
                elif players_stats[victim]["agent"] == "Agente" and k.get("victim_agent"):
                    players_stats[victim]["agent"] = k["victim_agent"]

                players_stats[victim]["deaths"] += 1
                if k["first_kill"]:
                    players_stats[victim]["first_deaths"] += 1

        # Populate any roster players who had 0 kills/deaths into scoreboard
        for r_norm, info in roster.items():
            canonical = info["canonical_nick"]
            if canonical not in players_stats and len(canonical) >= 3 and canonical.lower() not in IGNORE_WORDS:
                players_stats[canonical] = {
                    "agent": info["agent"],
                    "team": info["team"],
                    "kills": 0,
                    "deaths": 0,
                    "headshots": 0,
                    "first_kills": 0,
                    "first_deaths": 0,
                    "headshot_rate": 0.0,
                    "kd_ratio": 0.0,
                }

        # Calculate HS% and K/D
        for p, s in players_stats.items():
            s["headshot_rate"] = round((s["headshots"] / s["kills"] * 100), 1) if s["kills"] > 0 else 0.0
            s["kd_ratio"] = round(s["kills"] / s["deaths"], 2) if s["deaths"] > 0 else s["kills"]

        final_data = {
            "video_path": video_path,
            "duration": format_time(duration_to_process),
            "final_score": {
                "friendly": current_score_friendly,
                "enemy": current_score_enemy,
            },
            "rounds_count": len(rounds),
            "rounds": rounds,
            "all_kills": all_kills,
            "players_stats": players_stats,
            "analyzed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        return final_data


def main():
    parser = argparse.ArgumentParser(description="Analisador de VODs de Treino de Valorant")
    parser.add_argument("--video", required=True, help="Caminho do arquivo de video MP4/MOV/MKV")
    parser.add_argument("--output", help="Caminho do arquivo JSON de saida")
    parser.add_argument("--max-seconds", type=float, default=None, help="Limitar analise aos primeiros N segundos")
    parser.add_argument("--interval", type=float, default=1.0, help="Intervalo de amostragem em segundos (padrao 1.0s)")
    parser.add_argument("--user-nick", default=None, help="Nickname do usuario na partida")
    parser.add_argument("--user-agent", default=None, help="Agente jogado pelo usuario")

    args = parser.parse_args()

    analyzer = ValorantAnalyzer()
    result = analyzer.analyze_vod(
        video_path=args.video,
        max_duration_sec=args.max_seconds,
        sample_interval_sec=args.interval,
        user_nick=args.user_nick,
        user_agent=args.user_agent,
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(json.dumps({"type": "complete", "output_file": args.output, "data": result}), flush=True)
    else:
        print(json.dumps({"type": "complete", "data": result}), flush=True)


if __name__ == "__main__":
    main()
