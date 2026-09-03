# 03: Schema, job table, and a first status command

**What to build:** The relational model the whole system stands on, made demoable by a status
slash command that reports counts grouped by state. Running it in an empty system says so;
running it later reports real work.

The status command is scheduled last in the plan and is the single feature most at risk of
being cut — and if it is cut, the founder's entire stated requirement goes unmet. Building a
crude version here removes that risk, and doubles as the observability every later ticket
needs while the pipeline is being built.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Batches are recorded with an incrementing integer identifier assigned at upload time
- [ ] A separate pointer records the latest delivered batch, distinct from the highest batch identifier
- [ ] Images are recorded with no status column on them
- [ ] Decision state is modelled as membership in an approved relation and a discarded relation — approved means present in one, discarded means present in the other, pending means present in neither
- [ ] An append-only event relation records every action with the acting user and a timestamp, and nothing operational reads it
- [ ] A job relation carries per-image pipeline state, distinct from decision state
- [ ] A status slash command returns counts grouped by state and behaves correctly on an empty system
- [ ] Schema changes are applied by a repeatable migration, not by hand
