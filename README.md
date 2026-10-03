# Minecraft Agent Lab

A reusable Minecraft Java AI agent experiment environment with long-term planning, bounded action selection, reactive safety controls, and optional automatic recording.

Minecraft 1.21.1 → Mineflayer → loopback HTTP environment API → manual, random, or Kev policy. An optional OpenAI-compatible Qwen planner manages ordered subgoals. Models receive structured observations and allowed action candidates rather than executable code.

## Features

- Structured observations, inventory/equipment readback, and JSONL trajectories.
- Collection, crafting, small-house construction, storage, iron mining/smelting, and equipment preparation.
- Qwen planning and pinned official Kev action selection.
- Immediate damage interruption, sword/shield combat, and task resumption after threats clear.
- Public progress messages labeled by model; these are explicit public utterances, not private model reasoning.
- Optional spectator follow camera and OBS task recording.

## Setup

Requires Node.js 22+ and Java 21. Model inference has separate runtime requirements.

```sh
npm ci
cp .env.example .env
node --env-file=.env scripts/prepare-server.mjs
```

Review the [Minecraft EULA](https://www.minecraft.net/eula). Set `eula=true` in the generated `server/minecraft/eula.txt` only if you agree. The EULA acceptance is not included in this repository.

Run in separate terminals from the project root:

```sh
npm run server
npm start
npm run agent -- random 5
# Or interactive manual selection:
npm run agent -- manual 5
```

Join `localhost:25565` with a separately installed Minecraft Java 1.21.1 client to observe `LabBot`. The server uses survival mode and Normal difficulty. It binds to loopback with offline authentication and is intended for local experiments; do not expose this configuration to the internet.

## Models

### Models used in the recorded experiments

| Model | Role | Tested configuration |
|---|---|---|
| **Qwen3.8-27B** | Long-term goals, ordered subgoals, construction/storage planning and public progress statements | Served as `qwen3.8-27b` through an OpenAI-compatible endpoint; [ROCMFP4-COHERENT GGUF variant](https://huggingface.co/hugobugo34/Qwen3.8-27B-ROCmFPX-GGUF), request-level thinking disabled |
| **[jaredpalmer/kev-4b](https://huggingface.co/jaredpalmer/kev-4b)** | Chooses among bounded, state-dependent actions, including combat and retreat candidates | Official Kev-4B adapter/head, BF16, without additional quantization |
| **[Qwen/Qwen3.5-4B-Base](https://huggingface.co/Qwen/Qwen3.5-4B-Base)** | Kev's underlying backbone | Loaded as part of Kev; not a separate long-term planner |

The tested planner GGUF revision was `27b12de0c9cb053f448fdea885713d8802ccbc3b`, using `Qwen3.8-27B-ROCMFP4-COHERENT.gguf`. The tested Kev revision was `6cfce5c2fa4b4bd64026336ab649c5ca78857d52`, with backbone revision `1001bb4d826a52d1f399e183466143f4da7b741b`. These identify the tested model artifacts, not a requirement that every deployment use the same planner.

Qwen defines the plan; Kev selects legal actions; Mineflayer executes and checks their effects. Immediate damage interruption is local safety control and does not wait for either model. Both policies use structured state rather than screenshots in these experiments.

### Observed results with Qwen3.8 + Kev-4B

These are functional observations from development runs in Minecraft Java 1.21.1, not a benchmark or a measured success rate.

| Experiment | Observed result | Scope and limitations |
|---|---|---|
| Collection and crafting | Collected oak logs and crafted planks. A Normal-difficulty night run collected 2 logs, increased planks from 2 to 10, and returned to the closed house without further health loss. | One collection action timed out after obtaining an item; the runner continued using observed inventory. |
| House and shelter | Built a small house; installed a door and four torches; verified return to the interior and a closed entrance. | Preparation included deaths and operator daytime assistance. This is not proof of fully autonomous survival. |
| Chest organization | Crafted/placed a chest, deposited excess items, and read back the stored contents. | Depends on local task state and available materials. |
| Iron equipment | Mined and smelted iron; crafted and verified an iron pickaxe, iron sword, shield, and all four iron armor parts. Actual equipped slots were checked. | Preparation required gear recovery after deaths and operator daytime/nearby-hostile removal assistance. |
| Combat and continuation | In natural nighttime encounters, responded to a spider and two zombies. After the zombies were handled, resumed the interrupted return-home action, closed the door, and ate collected food. | The initial interrupted hunt exposed a completion-detection bug, subsequently fixed. Later creeper damage reduced health to 6.63/20; nighttime survival is not robust. |
| Observation and recording | Recorded real task execution through OBS; verified spectator follow, game chat, model labels and recording start/stop ownership. | Camera occlusion and capture setup remain limitations. Recordings and player identities are private and are not published. |

The published snapshot passes **62 automated tests**. Tests cover contracts and regressions; they do not establish general gameplay competence. No Ender Dragon completion is claimed for this project. Raw development logs and recordings are deliberately excluded for privacy, so the table is a reported validation summary rather than a public evaluation dataset.

Configure `QWEN_BASE_URL`, `QWEN_MODEL`, and optional `QWEN_API_KEY` in your private `.env`. The planner supports an OpenAI-compatible chat endpoint; local or remote hosting is your choice. For an SSH tunnel, substitute your own host and remote endpoint:

```sh
ssh -N -L 127.0.0.1:18080:127.0.0.1:8080 your-model-host
npm run qwen:smoke
```

The Kev policy expects the official [Kev](https://github.com/jaredpalmer/kev) server and [Kev-4B](https://huggingface.co/jaredpalmer/kev-4b). Model weights and vendor source are not bundled. For a Linux shell or WSL, from the project root:

```sh
git clone https://github.com/jaredpalmer/kev .vendor/kev
cd .vendor/kev
git checkout 84847f0a883d900f7de5b7a57eaa341ca7f9a6b4
UV_PROJECT_ENVIRONMENT="$HOME/.local/share/minecraft-agent-lab/kev-venv" uv sync --frozen --extra serve --no-dev
cd ../..
HF_HOME="$HOME/.cache/minecraft-agent-lab/huggingface" "$HOME/.local/share/minecraft-agent-lab/kev-venv/bin/python" scripts/download-kev.py
bash scripts/start-kev.sh
```

The download script records the official model and backbone revisions in ignored runtime metadata. Set `KEV_BASE_URL` if the inference endpoint differs. The provided launch script uses CUDA/BF16; adapt it to your supported inference hardware. Downloaded weights and caches remain local.

## Experiments

```sh
npm run agent -- kev 5
npm run planned -- "Collect two oak logs, then craft eight oak planks" 20
node --env-file=.env scripts/build-agent.mjs "Build a small house"
node --env-file=.env scripts/storage-agent.mjs
node --env-file=.env scripts/equipment-agent.mjs
node --env-file=.env scripts/idle-defense.mjs
npm test
```

Some preparation tasks depend on a previously built house, chest, or saved local experiment state. The environment is an experimental framework, not a general autonomous Minecraft player.

## Observation and recording

Set `MC_OBSERVER` to your own Minecraft username before running `scripts/setup-camera.mjs`. Reload the generated data pack and use `/function lab_camera:start` to enable the external spectator camera; `/function lab_camera:stop` releases it. The camera moves only the observer. Fixed camera offsets can be obstructed by terrain or roofs.

Optional OBS integration uses authenticated obs-websocket and a dedicated Minecraft scene. Configure your own capture through `scripts/setup-obs.mjs`; enable `OBS_RECORD_TASKS=true` only after reviewing the capture and scene. Recordings may include game usernames and chat. Task runners preserve recordings already started by another application and stop only recordings they own. A compatible chat-bubble client mod can display the same game-chat messages; no mod binary is bundled.

## Known limitations

Night tests demonstrated resource collection, crafting, hostile combat, and interrupted return-home resumption. They also exposed significant creeper damage. Safe general nighttime survival is not established. Food reserves, proactive hazard avoidance, pathfinding, and pickup confirmation need further work.

Movement and valid collection targets can resume after defense. Non-idempotent interrupted actions can return `action_needs_replan` rather than blindly repeating crafting or transfers; not every runner automatically replans these cases. Mining may time out after an item was already obtained. A nonfatal protocol parsing error has also been observed on connection.

## Privacy and third-party material

Keep credentials, private hosts, local paths, player identities, worlds, trajectories, screenshots, recordings, and model caches out of Git. `.env.example` contains placeholders and loopback addresses only. This publication excludes machine-specific administration scripts and private experiment reports, and starts with a clean Git history.

See [THIRD_PARTY.md](THIRD_PARTY.md) for references and upstream licenses. Minecraft and model binaries are downloaded separately. This repository does not grant rights to redistribute upstream materials.
