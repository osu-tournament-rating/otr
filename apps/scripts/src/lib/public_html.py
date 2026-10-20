import logging
from pathlib import Path

from lib.config import config
from lib.constants import buckets
from lib.gcs import gcs_utils

logger = logging.getLogger(__name__)


def generate_index() -> bool:
    # This will always be done for a public bucket
    bucket = buckets.PUBLIC

    terms_path = (
        Path(__file__).resolve().parent.parent / "public-dump-web" / "terms-of-use.txt"
    )
    terms = terms_path.read_text()

    blobs = gcs_utils.list_all(bucket)
    archives, receipts, misc = [], [], []

    for b in blobs:
        if b.name.startswith(buckets.RECEIPT_PREFIX):
            receipts.append(b)
        elif ".gz" in b.name:
            archives.append(b)
        else:
            misc.append(b)

    # Display misc above archives, each sorted by name descending. Receipts,
    # one a week, get their own list so they never push the replicas down.
    sorted_archives = sorted(archives, key=lambda b: b.name, reverse=True)
    sorted_misc = sorted(misc, key=lambda b: b.name, reverse=True)
    combined = sorted_misc + sorted_archives

    link_template = f"https://storage.googleapis.com/{config.gcs_public_bucket}/{{}}"
    list_item_template = "<li><a href={}>{}</a></li>"

    def list_items(listed) -> str:
        return "\n".join(
            list_item_template.format(link_template.format(b.name), b.name)
            for b in listed
        )

    blob_html = list_items(combined)
    receipt_html = list_items(sorted(receipts, key=lambda b: b.name, reverse=True))

    html = f"""
    <!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Browse: o!TR Public Datasets</title>
        </head>
        <body>
            <h1>Terms of Use</h1>
            <p>{terms}</p>

            <h1>Files in {config.gcs_public_bucket}</h1>
            <ul>
                {blob_html}
            </ul>

            <h1>Rating run receipts</h1>
            <ul>
                {receipt_html}
            </ul>
        </body>
    </html>
    """

    config.public_html_dir.mkdir(parents=True, exist_ok=True)
    index_loc = Path(config.public_html_dir, "index.html")
    index_loc.write_text(html, encoding="utf-8")

    logger.info(f"Wrote new HTML to {index_loc}")
    return True
