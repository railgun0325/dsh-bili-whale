# Local discovery, persona UI and usage (2026-10-24)

## Native settings

- 养鱼 → 智能选片 configures `preferences.discovery`. The default is two AI-focused slots per three candidates, with a remaining long-term-interest slot. A requested owner topic takes precedence.
- The persona editor fills the section width and starts at 280px high, grows with the viewport, and remains vertically resizable. Primary save/inject buttons use an explicit blue background with white text instead of a theme token that may resolve to white.
- Token 与费用 refreshes every five seconds. It reads actual normalized model usage from the dedicated Whale session, separately counting uncached input, cached input, output, retries and request attempts. Today, month and total statistics recover across restart.

## Read-only discovery

The workspace `bili.mjs feed --n 3 --json` routes to `smart-feed.mjs` only while discovery is enabled; disabling it preserves the original selector.

The selector merges the existing OBC profile/history bridge with fresh scored Bilibili rows from OBC's SQLite database. The helper uses SQLite `mode=ro`, `query_only`, allowlisted columns and no OBC ORM initialization. It does not consume recommendation slots, mark content shown or send feedback. The `/api/recommendations` GET is intentionally avoided because that route may top up the UI and mark items shown.

No unrelated popular/rank material is used as filler. OBC exclusions, shown/clicked history, browser view history, own diaries and publication ledgers take precedence over ranking. The SQLite helper checks the bounded candidate IDs against OBC's last 30 days of browser views, including newly searched candidates. Actual positive feedback and favorites provide a small bonus. Scores/reasons, AI focus, and commenter observations remain inspectable in `data/.bili-ai/discovery-last.json`.

The original history bridge's 500-row ceiling was exhausted during acceptance (514 shown rows), which correctly but permanently blocked background sharing. Its bounded ceiling is now 5,000 rows/IDs per category, with the existing 8-second overall deadline, repeated-cursor detection and explicit incomplete-coverage state retained. Full history is matched locally instead of printed into the model prompt. The 514-row case is covered by a regression test and real readback.

The external read budget is at most three search queries and three community probes, each sampling hot and recent comments once. The existing API cache/throttle/risk halt is reused. At least two distinct recent public peers are needed to report observed gathering; one account, stale evidence, unavailable comments and mere title matches are separate states. Names do not establish that an account is an AI bot. No automatic peer-to-peer messaging is introduced.

## Usage and price semantics

`GET /dsh-bili/api/usage` backfills the dedicated session through the Host's paginated log and folds one final usage sample per billed attempt. A retry is separate; a later sample for the same attempt replaces the earlier sample. The numeric-only derived ledger is `DSH_HOME/whale-usage-meter.json`.

Tokens are observed values. Money is an estimate using the recorded model and call time, not a per-plugin settlement bill or an account-balance delta. The card explicitly excludes OBC, Codex, unrelated sessions and auxiliary requests absent from this session log. Unknown models are unpriced, not zero cost; unknown holiday calendars yield a range.

Official sources checked 2026-10-24:

- [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/): CNY per million tokens, cache-aware, with weekday peak hours 09:00–12:00 and 14:00–18:00 Beijing time. The checked Flash rates off peak are 1 / 0.02 / 4 for uncached input / cached input / output; peak rates are double.
- [2026 public holidays](https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html): used with the documented weekend/off-peak rule. Future unknown calendars are not silently treated as complete.

Accounts, persona, owner-command exemptions, daily publication quotas, safety gates, original data and other plugins are retained.
