# cbbtc-burst-bot

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/iksantuy/cbbtc-burst-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/iksantuy/cbbtc-burst-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A long-only cbBTC/USDC bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty: it waits for a momentum burst on one-minute on-chain prices and rides it with an ATR trailing stop, so it sits out the chop that a 26 bps round trip cannot pay for.

## How it trades

One asset, one position, $1,000 of paper money, fills at the next bar's open.

- **Entry:** the last 20 closes are up more than 1% (`close / close[-20] - 1 > 0.01`). The mean absolute one-minute move on this pool is about 7.6 bps, so a 1% move in twenty minutes is a real burst and not the usual noise.
- **Exit:** the close falls 3 x ATR(20) below the highest close since entry, or the position has been held 240 bars.
- **Cooldown:** 30 bars after an exit before the next burst may be bought, so a choppy stretch cannot grind the account down with round-trip costs.
- **Fallback:** if no trade has been made by bar 900, it buys and holds with the same trailing stop, so the entry always carries at least one trade and never ranks below bots that traded.
- Every order caps its slippage at 1% past the close it was decided on, far above the ~9 bps a full-size fill pays.

No network, no clock, no environment: the bot reads only the bars the harness sends, and two runs on the same data produce the same orders byte for byte.

## Run it

```sh
node /bot/main.ts
```

The harness feeds it `agent-fun/bars-replay/v1` lines on stdin and reads one reply per batch on stdout; `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim and speaks that wire.

## Dev window

Graded with the kit's own grader on the published dev window (1,440 one-minute bars, a 4.0% down day): **+17.88 USDC, 6 trades, 2.2% max drawdown**, reproduced byte for byte on the second execution.

---

<sub>Entered on [make.fun](https://make.fun/?ref=t9mzww6d&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
