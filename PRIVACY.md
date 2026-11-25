# Privacy & Code Signing Policy — Kring VLR

*Last updated: November 25, 2026*

## 1. Data & Privacy Policy

**Kring VLR** is a 100% offline-first desktop application designed for competitive Valorant players and coaches. Your videos, match statistics, lineups, tactical gameplans, and review notes belong strictly to you.

### What Kring VLR Does NOT Collect
- **No telemetry or analytics:** The application contains no tracking pixels, crash-reporting beacons, or usage analytics.
- **No cloud uploads:** Local video recordings (`.mp4`, `.mkv`, etc.) and extracted match data are processed exclusively on your computer using **OpenCV** and **RapidOCR (ONNX Runtime / DirectML)**. No video frames, player nicknames, or tactical notes are ever uploaded to external servers.
- **No accounts or personal data storage:** Kring VLR does not require registration, login credentials, or remote databases.

### Local Storage
All user-created data (VOD library metadata, lineups, tactics, gameplans, training plans, and preferences) is stored locally on your machine under your Windows user profile (`%APPDATA%\kring-vlr\kring-vlr-data.json` and local rotation backups). You can export, import, or delete your local library at any time inside the app.

### Network Connections
Kring VLR only makes outbound HTTPS requests when:
1. Checking for or downloading official application updates from **GitHub Releases** (`https://github.com/gabrielphilipus/kring-vlr/releases`) via `electron-updater` (on startup or when you click the **Atualizar** button).
2. Opening an external URL explicitly clicked by the user (such as a YouTube VOD link you added to your library).

---

## 2. Code Signing Policy

- Official Windows release binaries and installers for **Kring VLR** are built exclusively through automated **GitHub Actions** workflows from the public repository [`gabrielphilipus/kring-vlr`](https://github.com/gabrielphilipus/kring-vlr) and published under GitHub Releases.
- Free code signing for official Windows releases is provided by **SignPath.io**, using a certificate provided by the **SignPath Foundation** *(pending approval / active integration)*.
- **Committers and Reviewers:** All source code changes are authored, reviewed, and approved by the repository owner and sole maintainer (`gabrielphilipus`).
- The software will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it (limited strictly to the GitHub Releases update mechanism and user-initiated external links described above).

---

## Resumo em Português

- **100% Offline e Privado:** Vídeos, abates, estatísticas, anotações e táticos são processados e salvos exclusivamente no seu PC (`%APPDATA%\kring-vlr`). Nenhuma telemetria ou arquivo de treino é enviado para fora.
- **Conexões de Rede:** Apenas consulta/download de atualizações oficiais no **GitHub Releases** (`electron-updater`) e links externos abertos manualmente por você.
- **Política de Assinatura de Código:** Os instaladores oficiais de release são gerados via GitHub Actions a partir deste repositório público e mantidos exclusivamente por `gabrielphilipus`, com assinatura gratuita via SignPath.io / SignPath Foundation.
