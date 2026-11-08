#!/usr/bin/env bash
# One server session on GitHub Actions: a run every 15 minutes (3 min after each M15 candle
# close) for about 5 h 40, publishing the state after each run. The workflow then starts the
# next session, so the AI watches the market and its positions around the clock without
# depending on GitHub's scheduler (which can run late by hours).
set -u
END=$(( $(date +%s) + ${SESSION_MINUTES:-340} * 60 ))

publish() {
  rm -rf publish && mkdir publish && cp state.json memory.json stamp.json publish/ || return 1
  (
    cd publish &&
      git init -q -b aurum-data &&
      git add state.json memory.json stamp.json &&
      git -c user.name="AURUM bot" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit -q -m "AURUM : état du $(date -u +'%Y-%m-%d %H:%M') UTC" &&
      git push -q -f "$PUSH_URL" aurum-data
  )
}

while :; do
  if npx -y tsx@4.19.2 server/main.ts --state state.json; then
    publish || echo "::warning::publication de l'état impossible, nouvel essai au prochain passage"
  else
    echo "::warning::passage en échec, nouvel essai dans 15 min"
  fi
  now=$(date +%s)
  next=$(( ((now - 180) / 900 + 1) * 900 + 180 ))
  [ "$next" -ge "$END" ] && break
  sleep $(( next - now ))
done
echo "Session terminée, la suivante prend le relais."
