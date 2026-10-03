#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export HF_HOME="${HF_HOME:-$HOME/.cache/minecraft-agent-lab/huggingface}"
export KEV_DTYPE=bf16 KEV_BACKEND=torch KEV_CUDA_GRAPHS=0 KEV_PREFIX_CACHE=0
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
revision=$("$HOME/.local/share/minecraft-agent-lab/kev-venv/bin/python" -c 'import json; print(json.load(open(".runtime/kev-model.json"))["model_revision"])')
exec "$HOME/.local/share/minecraft-agent-lab/kev-venv/bin/python" -m kev.serve --run "jaredpalmer/kev-4b@$revision" --host 127.0.0.1 --port 18008
