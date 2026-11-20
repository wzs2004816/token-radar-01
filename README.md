# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wzs2004816/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wzs2004816/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by implied value — what a protocol's token would be worth if its record stayed as it is — and gives every ranked protocol a concrete farm plan with costs and times. It reads a sealed DefiLlama snapshot (758 protocols, 2026-11-14), covers all 40 watchlist protocols, adds every rankable pre-token protocol below the $50M floor (186 early rows), and scores each one with model radar-2: TVL × 0.28, bent by 7-day growth, matured by age with no token, and widened by chain breadth. Each row also carries a computed risk score and five launch-readiness checks. The dashboard is a static offline page: sortable/filterable board, top-signal cards, category chart, live-token view set aside, and a detail view per protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zy5dg92r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
