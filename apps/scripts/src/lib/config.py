import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    # 'dev', 'staging', or 'production'
    environment: str
    tag: str
    dump_dir: Path
    public_html_dir: Path
    otr_web_dir: Path
    db_port: int
    db_container: str
    db_user: str
    db_name: str
    db_password: str
    gcs_test_bucket: str
    gcs_dev_bucket: str
    gcs_public_bucket: str
    gcs_prod_bucket: str
    gcs_sa_json_path: Path
    template_db_container: str
    template_db_port: int
    template_db_user: str
    template_db_password: str
    # node-exporter's textfile directory, or None to record no runs
    metrics_dir: Path | None = None


def _env_or_throw(key: str) -> str:
    var = os.getenv(key)
    if not var:
        raise OSError(f"Expected environment var '{key}' to be set")

    return var


def _env_or_default(key: str, default: str) -> str:
    return os.getenv(key) or default


def _path_or_none(key: str) -> Path | None:
    var = os.getenv(key)
    return Path(var).expanduser() if var else None


def init() -> Config:
    # Only apps/scripts/.env. Without a path, python-dotenv searches each
    # parent directory and would load otr's root .env instead.
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not load_dotenv(env_file):
        raise FileNotFoundError(f"Missing {env_file}")

    return Config(
        _env_or_throw("ENVIRONMENT"),
        _env_or_throw("TAG"),
        Path(_env_or_throw("DUMP_DIR")).expanduser(),
        Path(_env_or_throw("PUBLIC_HTML_DIR")).expanduser(),
        Path(_env_or_throw("OTR_WEB_DIR")).expanduser(),
        int(_env_or_throw("DB_PORT")),
        _env_or_throw("DB_CONTAINER"),
        _env_or_throw("DB_USER"),
        _env_or_throw("DB_NAME"),
        _env_or_throw("DB_PASSWORD"),
        _env_or_throw("GCS_TEST_BUCKET"),
        _env_or_throw("GCS_DEV_BUCKET"),
        _env_or_throw("GCS_PUBLIC_BUCKET"),
        _env_or_throw("GCS_PROD_BUCKET"),
        Path(_env_or_throw("GCS_SA_JSON_PATH")).expanduser(),
        _env_or_default("TEMPLATE_DB_CONTAINER", "otr-template-db"),
        int(_env_or_default("TEMPLATE_DB_PORT", "5434")),
        _env_or_default("TEMPLATE_DB_USER", "postgres"),
        _env_or_default("TEMPLATE_DB_PASSWORD", "postgres"),
        _path_or_none("METRICS_DIR"),
    )


config = init()
