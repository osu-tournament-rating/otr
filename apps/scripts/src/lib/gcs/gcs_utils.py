import logging
import os
from pathlib import Path

from lib.config import config
from lib.constants import buckets
from lib.gcs.client import storage_client

logger = logging.getLogger(__name__)


def get_bucket_name(bucket: str):
    match bucket:
        case buckets.TEST:
            bucket_name = config.gcs_test_bucket
        case buckets.DEV:
            bucket_name = config.gcs_dev_bucket
        case buckets.PUBLIC:
            bucket_name = config.gcs_public_bucket
        case buckets.PROD:
            bucket_name = config.gcs_prod_bucket
        case _:
            raise ValueError(f"Invalid bucket '{bucket}'")
    return bucket_name


def list_archives(bucket: str):
    bucket_name = get_bucket_name(bucket)
    blobs = storage_client.list_blobs(bucket_name)

    filtered = list(filter(lambda f: f.name.endswith(".gz"), blobs))
    return sorted(filtered, key=lambda b: b.name, reverse=True)


def list_all(bucket: str):
    bucket_name = get_bucket_name(bucket)
    blobs = storage_client.list_blobs(bucket_name)

    return sorted(blobs, key=lambda b: b.name, reverse=True)


def upload(f: Path, bucket: str):
    """Upload a file to a bucket

    Args:
        f (Path): File to upload
        bucket (str): Bucket name
    """
    if not f.is_file():
        raise ValueError(f"Cannot upload non-file {f}")

    bucket_name = get_bucket_name(bucket)

    logger.info(f"Uploading {f}")

    gcs_bucket = storage_client.bucket(bucket_name)
    blob = gcs_bucket.blob(f.name)
    blob.upload_from_filename(str(f))

    logger.info(f"Uploaded {blob} to {gcs_bucket}")


def download_latest(bucket: str, out_dir: Path) -> Path | None:
    out_dir.mkdir(parents=True, exist_ok=True)
    bucket_name = get_bucket_name(bucket)

    logger.info(f"Downloading latest archive from {bucket_name}")

    filtered = list_archives(bucket)
    latest = max(filtered, key=lambda b: b.name, default=None)

    if not latest:
        logger.error("Could not identify latest blob")
        return None

    # Download
    output_loc = out_dir / latest.name
    part = out_dir / f"{latest.name}.{os.getpid()}.part"
    try:
        # Archives hold tokens and API keys, so only the owner may read them.
        with open(part, "wb", opener=lambda p, flags: os.open(p, flags, 0o600)) as f:
            storage_client.download_blob_to_file(latest, f)

        part.replace(output_loc)
        logger.info(f"Downloaded blob {latest} to {output_loc}")
    except Exception:
        logger.exception("Failed to download latest archive")
        return None
    finally:
        part.unlink(missing_ok=True)

    return output_loc
