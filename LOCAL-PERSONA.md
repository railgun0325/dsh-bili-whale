# Local persona continuity fix (2026-10-24)

`lib/scheduler.js` now includes the saved `persona.voice`, not only the identity fields, on each wake. The dedicated persona file keeps its existing precedence and is reread each time. User-facing speech guidance is repeated after workflow instructions for scheduled browsing, private replies, owner commands and comment/live listeners.

The model must still inspect source material and record verification evidence. Public comments and private conversation should use the configured persona instead of turning those internal records into summaries or task reports.

The dedicated persona is editable in 养鱼 → 她是谁 → 她专属的人设. Its file resolves to the Whale workspace's `data/.bili-ai/persona.md`; `AGENTS.md` contains matching local guidance. Accepted old replies are style examples, not reusable video facts.

Regression coverage: `tests/offpeak-scheduler.test.mjs` checks actual scheduler delivery for saved voice, persona-file content, owner commands, background sharing, ordinary interaction, legacy DM replies and hot-edited voice. The full offline suite passed 222 tests. This change does not alter accounts, business quotas, owner-command authorization, model selection, ledgers or existing posts.
