#!/usr/bin/env bash

# Decision functions for dev-db.sh.
#
# Journal lists are newline-separated `<when> <sha256>` entries: the drizzle
# journal's `when` and the sha256 of the migration's .sql file, which is what
# drizzle stores in drizzle.__drizzle_migrations.

# Postgres puts key values in DETAIL and CONTEXT, and a failing migration
# prints the URL it dialled.
redact() {
  local line name value
  sed -E -e '/^[[:space:]]*(DETAIL|CONTEXT):/d' \
    -e 's#postgres(ql)?://[^[:space:]"'\'']*#postgresql://redacted#g' \
    -e 's#(^|[^A-Za-z0-9/])~?/[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)*#\1/redacted#g' |
    tail -n "${DEV_DB_LOG_LINES:-20}" |
    while IFS= read -r line || [[ -n "$line" ]]; do
      for name in DOCKER_POSTGRES_PASSWORD OTR_SCRIPTS_DIR; do
        value="${!name:-}"
        if [[ -n "$value" ]]; then
          line="${line//"$value"/redacted}"
        fi
      done
      printf '%s\n' "$line"
    done
}

count_lines() { # count_lines <list>
  if [[ -z "$1" ]]; then
    echo 0
  else
    grep -c '' <<<"$1"
  fi
}

# match | behind | ahead | diverged. behind means applied is a proper prefix
# of expected, and ahead means expected is a proper prefix of applied;
# anything else that is not equal is diverged.
classify_journal() { # classify_journal <applied> <expected>
  local -a applied=() expected=()
  if [[ -n "$1" ]]; then mapfile -t applied <<<"$1"; fi
  if [[ -n "$2" ]]; then mapfile -t expected <<<"$2"; fi

  local i shorter="${#applied[@]}"
  if ((${#expected[@]} < shorter)); then shorter="${#expected[@]}"; fi
  for ((i = 0; i < shorter; i++)); do
    if [[ "${applied[i]}" != "${expected[i]}" ]]; then
      echo diverged
      return
    fi
  done
  if ((${#applied[@]} == ${#expected[@]})); then
    echo match
  elif ((${#applied[@]} < ${#expected[@]})); then
    echo behind
  else
    echo ahead
  fi
}

# share | share-behind | isolate | rebase-required, then a short reason.
# rebase-required: drizzle applies only entries newer than max(created_at).
decide_isolation() { # decide_isolation <base journal> <head journal>
  local -a base=() head=()
  if [[ -n "$1" ]]; then mapfile -t base <<<"$1"; fi
  if [[ -n "$2" ]]; then mapfile -t head <<<"$2"; fi

  local i prefix=0 newest=0 when
  for ((i = 0; i < ${#base[@]}; i++)); do
    when="${base[i]%% *}"
    if ((when > newest)); then newest="$when"; fi
  done
  while ((prefix < ${#base[@]} && prefix < ${#head[@]})) &&
    [[ "${base[prefix]}" == "${head[prefix]}" ]]; do
    prefix=$((prefix + 1))
  done

  if ((prefix == ${#head[@]})); then
    if ((prefix == ${#base[@]})); then
      echo "share the head journal matches the base"
    else
      echo "share-behind the head is $((${#base[@]} - prefix)) entries behind the base"
    fi
    return
  fi

  for ((i = prefix; i < ${#head[@]}; i++)); do
    when="${head[i]%% *}"
    if ((when < newest)); then
      echo "rebase-required migration $when predates the base's newest migration $newest"
      return
    fi
  done

  if ((prefix < ${#base[@]})); then
    echo "isolate the head replaces $((${#base[@]} - prefix)) base entries"
  else
    echo "isolate the head adds $((${#head[@]} - prefix)) migrations"
  fi
}

# create | recreate | reuse | reuse-migrate. Provenance that is missing or
# unparseable yields recreate.
decide_clone_action() { # decide_clone_action <exists> <status> <clone generation> <seed generation> <age> <max age>
  local exists="$1" status="$2" clone_generation="$3" seed_generation="$4" age="$5" max_age="$6"

  if [[ "$exists" != true ]]; then
    echo create
    return
  fi
  if [[ ! "$clone_generation" =~ ^[0-9]+$ || ! "$seed_generation" =~ ^[0-9]+$ ]] ||
    [[ "$clone_generation" != "$seed_generation" ]]; then
    echo recreate
    return
  fi
  if [[ ! "$age" =~ ^-?[0-9]+$ || ! "$max_age" =~ ^[0-9]+$ ]] || ((age > max_age)); then
    echo recreate
    return
  fi
  case "$status" in
    match) echo reuse ;;
    behind) echo reuse-migrate ;;
    *) echo recreate ;;
  esac
}

select_reapable() { # select_reapable <databases> <open pr numbers>
  local open=" ${2//$'\n'/ } " database number
  while IFS= read -r database; do
    [[ "$database" =~ ^otr_pr_([0-9]+)$ ]] || continue
    number="${BASH_REMATCH[1]}"
    case "$open" in
      *" $number "*) ;;
      *) echo "$database" ;;
    esac
  done <<<"$1"
}

# ok | refuse-disk | refuse-cap.
check_capacity() { # check_capacity <free> <seed size> <clones> <max clones> <factor percent> <headroom>
  local value
  for value in "$@"; do
    if [[ ! "$value" =~ ^[0-9]+$ ]]; then
      echo refuse-disk
      return
    fi
  done
  if (($3 >= $4)); then
    echo refuse-cap
    return
  fi
  if (($1 < $2 * $5 / 100 + $6)); then
    echo refuse-disk
    return
  fi
  echo ok
}

provenance_field() { # provenance_field <json> <key>
  if [[ "$1" =~ \"$2\"[[:space:]]*:[[:space:]]*([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
  fi
}
