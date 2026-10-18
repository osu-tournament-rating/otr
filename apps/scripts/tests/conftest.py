"""Stub the modules that reach external services at import time.

`lib.config` requires a populated `.env` and `lib.gcs.client` builds a real
storage client, so both are replaced before `lib.scripts.db` is imported.
"""

import sys
import types
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

config_module = types.ModuleType("lib.config")
config_module.config = types.SimpleNamespace(
    environment="staging",
    tag="test",
    dump_dir=Path("/tmp/otr-test-dumps"),
    public_html_dir=Path("/tmp/otr-test-html"),
    otr_web_dir=Path("/tmp/otr-test-web"),
    db_port=5432,
    db_container="otr-test-db",
    db_user="tester",
    db_name="otr_test",
    db_password="test",
    gcs_test_bucket="test",
    gcs_dev_bucket="dev",
    gcs_public_bucket="public",
    gcs_prod_bucket="production",
    gcs_sa_json_path=Path("/tmp/sa.json"),
    template_db_container="otr-template-test-db",
    template_db_port=5434,
    template_db_user="postgres",
    template_db_password="postgres",
    metrics_dir=None,
)
sys.modules.setdefault("lib.config", config_module)

client_module = types.ModuleType("lib.gcs.client")
client_module.storage_client = None
sys.modules.setdefault("lib.gcs.client", client_module)
