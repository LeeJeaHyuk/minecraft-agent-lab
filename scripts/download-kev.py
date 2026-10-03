"""Download official adapter + its pinned base; do not load a model or touch remote Qwen."""
import json
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

api = HfApi()
model = 'jaredpalmer/kev-4b'
revision = api.model_info(model, revision='v1.0').sha
adapter = snapshot_download(model, revision=revision, allow_patterns=['*.json', '*.safetensors', '*.pt', '*.txt', '*.jinja'])
config = json.loads((Path(adapter) / 'adapter_config.json').read_text())
base_model = config['base_model_name_or_path']
base_revision = config.get('revision')
if not base_revision:
    import torch
    meta = torch.load(Path(adapter) / 'head.pt', map_location='cpu', weights_only=False)
    base_revision = meta.get('base_revision')
if not base_revision:
    raise RuntimeError('Official base revision missing; refusing unpinned base')
base_revision = api.model_info(base_model, revision=base_revision).sha
base = snapshot_download(base_model, revision=base_revision, allow_patterns=['*.json', '*.safetensors', '*.txt', '*.jinja'])
record = {'model_identifier': model, 'model_revision': revision, 'adapter_cache': adapter,
          'base_identifier': base_model, 'base_revision': base_revision, 'base_cache': base,
          'device': 'cuda', 'dtype': 'bf16', 'quantization': None}
Path('.runtime').mkdir(exist_ok=True)
Path('.runtime/kev-model.json').write_text(json.dumps(record, indent=2))
print(json.dumps(record, indent=2))
