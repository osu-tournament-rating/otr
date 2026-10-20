# dev and test environments only affect archive creation for now.
# dev archives are for o!TR devs who need the most information possible
# excluding sensitive data.
# test archives are for testing GCP behavior without impacting
# other environments
TEST = "test"
DEV = "dev"
PUBLIC = "public"
PROD = "production"

# Rating run receipts sit in the public bucket beside the replicas, named
# RECEIPT_PREFIX + the run's UTC start time + ".json" (see lib.receipt).
RECEIPT_PREFIX = "otr-rating-receipt_"
