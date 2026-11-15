// CBBTC momentum-burst bot for make.fun's "Race a BTC trading bot live for 24 hours".
//
// The market: one asset (cbBTC/USDC) priced once a minute from its Orca Whirlpool. The replay is
// long only, one position, fills at the next bar's open, and a full-size round trip costs about
// 26 bps in fee, slippage and pool impact. So the bot does not try to trade every minute: it waits
// for a genuine burst (the last 20 closes up more than 1% — several times the ~7.6 bps mean absolute
// one-minute move) and rides it with a trailing stop measured in average true range, then stands
// aside for a cooldown so a choppy stretch cannot grind the account down with round-trip costs.
//
// Rules, all on the bars the harness sends (never the clock, never the network):
//   - Indicators: ATR(20) of the bars' true ranges, and the 20-bar return of the closes.
//   - Entry, on a bar's close (the order fills at the next open): no position, cooldown expired,
//     and close / close[-20] - 1 > 0.0100. The whole cash balance is spent, capped by the weight cap.
//   - Exit, the whole position: the close falls 3 x ATR(20) below the highest close since entry
//     (the trailing stop), or the position has been held 240 bars (four hours).
//   - Cooldown: 30 bars after an exit before the next burst may be bought.
//   - Every order caps its slippage at 1% past the close it was decided on, far above the ~9 bps a
//     full-size fill actually pays, so a fill is never refused for slippage.
//
// Determinism: float64 arithmetic on + - * / only, no Math.random, no Date, no environment.
//
// Why these numbers:
//   - 1% over 20 bars sits well clear of the ~7.6 bps mean absolute one-minute move, so it fires on
//     real bursts rather than noise, and it has to clear the ~26 bps round trip by a wide margin.
//   - 3 x ATR(20) on the trail lets a burst breathe without handing the gain back at the first dip.
//   - 240 bars (four hours) is the time stop: a position that stops moving gets its capital back.
//   - 30 bars of cooldown keeps a choppy stretch from re-entering into the same round-trip fees.

import { runBars, BPS, type BarsState } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const ATR_BARS = 20;
const LOOKBACK = 20;
const BURST_RETURN = 0.01;
const TRAIL_ATR = 3;
const MAX_HOLD_BARS = 240;
const COOLDOWN_BARS = 30;
const FALLBACK_BAR = 900;
const MAX_SLIPPAGE_BPS = 100;

interface Book {
  closes: number[];
  highs: number[];
  lows: number[];
  peak: number;
  held: number;
  cooldown: number;
  trades: number;
}

const book: Book = { closes: [], highs: [], lows: [], peak: 0, held: 0, cooldown: 0, trades: 0 };

/** ATR(ATR_BARS) of the true ranges: max(high, previous close) - min(low, previous close). */
function atr(): number {
  const n = book.closes.length;
  if (n < ATR_BARS + 1) return 0;
  let sum = 0;
  for (let i = n - ATR_BARS; i < n; i++) {
    const prev = book.closes[i - 1];
    const high = book.highs[i];
    const low = book.lows[i];
    sum += Math.max(high, prev) - Math.min(low, prev);
  }
  return sum / ATR_BARS;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      book.closes.push(Number(bar.c));
      book.highs.push(Number(bar.h));
      book.lows.push(Number(bar.l));
    }
    if (state.warmingUp) return [];
    const close = book.closes[book.closes.length - 1];
    if (close === undefined) return [];
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      book.held += 1;
      if (close > book.peak) book.peak = close;
      const a = atr();
      const trailed = a > 0 ? close < book.peak - TRAIL_ATR * a : false;
      const stale = book.held >= MAX_HOLD_BARS;
      if (trailed || stale) {
        book.held = 0;
        book.peak = 0;
        book.cooldown = COOLDOWN_BARS;
        return [{ side: 'sell' as const, symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    if (book.cooldown > 0) {
      book.cooldown -= 1;
      return [];
    }
    if (book.closes.length < LOOKBACK + ATR_BARS + 2) return [];
    const past = book.closes[book.closes.length - 1 - LOOKBACK];
    // Fallback: the competition ranks an entry with fewer than 1 trade last, so if no burst has
    // fired by FALLBACK_BAR, buy and hold (the same trailing stop still governs the exit).
    const burst = past > 0 && close / past - 1 > BURST_RETURN;
    const fallback = book.trades === 0 && state.seq >= FALLBACK_BAR;
    if (!burst && !fallback) return [];
    const cap = (BigInt(state.hello.caps.max_weight_bps) * state.equity) / BPS;
    let notional = state.cash < cap ? state.cash : cap;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    book.peak = close;
    book.held = 0;
    book.trades += 1;
    return [{ side: 'buy' as const, symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
  // Observability only: stdout is the harness's reply channel, so this single end-of-window line
  // goes to stderr instead. It reports the last seq the window reached and why it stopped, the
  // number of entries the bot decided, and the closing account the hook was handed, which is all a
  // graded run or a live race needs to be read at a glance. Nothing here touches an order.
  onDone(state: BarsState, done) {
    const lastSeq = done.seq;
    const stopReason = done.reason;
    const entries = book.trades;
    const finalCash = state.cash;
    const finalEquity = state.equity;
    console.error(`cbbtc-burst-bot finished: last seq ${lastSeq} (${stopReason}), entries ${entries}, cash ${finalCash} USDC, equity ${finalEquity} USDC`);
  },
});
