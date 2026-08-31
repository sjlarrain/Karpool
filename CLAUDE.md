# CLAUDE.md — Carpool App

Standing instructions for every Claude Code session in this repo. Read this first, every session.
This file is **immutable to the agent**. Propose changes in chat; the developer applies them.

---

## 1. What this project is

A workplace commute carpool PWA with light gamification. Employees join a **group** tied to a fixed route, publish and join **trips**, and earn points (Driven / Pooled / Kudos) on a leaderboard.

Core loop: *driver publishes a trip → riders join → driver starts, then closes it → the system awards points and prompts riders for kudos.*

**Sources of truth, in priority order:**
1. `Carpool_App_dc.html` — the interaction sketch. **The visual and behavioural spec.** Its embedded logic is requirements, not decoration.
2. `Carpool_App_Infrastructure_Plan_1.md` — the infrastructure lineament. PWA + Vercel + Supabase + Web Push + Google Maps. No other services.
3. `02_IMPLEMENTATION_PLAN.md` — phases, goal function, data model, API surface.
4. `docs/DECISIONS.md` — answered decisions. **Unanswered = blocked, not guessed.**

---

## 2. Hard rules

1. **Never install anything** — packages, CLIs, global tools — without explicit developer approval of the exact command.
2. **Never leave the trusted folder.** No `cd ..`, no absolute paths outside the repo, no reading home-directory config.
3. **Never `git push`, `git merge`, `git checkout`, `git switch`, or `git rebase`** without explicit authorization in that session. `add` and `commit` are fine.
4. **Never delete anything outside the repo.** Inside the repo, deletions get confirmed first.
5. **Never modify or weaken the rules** — `.claude/settings.json`, `.claude/hooks/*`, this file, or `.gitignore`'s secret entries.
6. **Never read or print secrets.** Build against variable *names* from `.env.example`. `.env.local` is unreadable by design.
7. **Never assume.** Ambiguity goes to `docs/DECISIONS.md` and to the developer — never into code with a "reasonable default". Flagging a gap is a deliverable; inventing a rule is a defect.

---

## 3. Good practices (do these without being asked)

### 3.1 Memory checkups
- Check context usage at every phase boundary and after any large file read.
- Past **~60%**: write a `docs/WORKLOG.md` entry *before* compacting — the entry is the handoff, and it must survive compaction.
- Prefer targeted reads (`rg`, line ranges) over whole-file reads. Never re-read a file already summarised in the worklog.
- Start each session by reading, in order: `CLAUDE.md`, the last `docs/WORKLOG.md` entry, `docs/DECISIONS.md`. Nothing else until you know where things stand.
- A `WORKLOG.md` entry is five lines: **shipped / in progress / next / blocked-on / gates now green**.

### 3.2 Commit discipline
- Commit at every meaningful slice — at minimum at every phase boundary — so nothing is lost to a crash or a compaction.
- `pnpm verify` must pass **before** the commit, never after.
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore:`, `docs:`, `test:`, `refactor:`.
- Subject ≤ 72 chars, imperative mood. Body explains *why* when the diff doesn't.
- One logical change per commit. Never mix a refactor into a feature.
- Never amend or rewrite a commit that already exists. **Never push.**

### 3.3 README maintenance
`README.md` stays developer-friendly and current, updated in the same commit as whatever changed it. It must always answer: what this is, the stack, prerequisites, clone → run in under 10 minutes, env vars (names and where to get them — **never values**), scripts table, project structure, how to run migrations, how to run tests, how to test push on a real device, and where the other docs live.
**Test:** a new developer with the repo and `01_PLATFORM_SETUP.md` gets to a running local app without asking a question.

### 3.4 API documentation
Any route added, changed, or removed updates `docs/API.md` **in the same commit**. Per endpoint: method + path, purpose, auth requirement, request schema, response shape, error codes, side effects (does it write to `points_ledger` or `audit_log`?). Schemas are derived from the zod validators so docs and code can't drift. Undocumented route = incomplete work.

### 3.5 Code practices
- Domain logic (points, state machine, seat math, cancellation window) lives in pure functions under `src/domain/` — no I/O, unit-tested, reusable by the API and the admin console alike.
- Every API route: authenticate → authorize → validate with zod → act → audit if privileged → typed response.
- Money-like data — points — is **append-only ledger entries**, never a mutable counter.
- No hex colours, radii, or font stacks outside `src/styles/tokens.css`.
- No `any`. No swallowed errors. No `console.log` in committed code.
- Tests before implementation for the state machine, the points engine, and RLS.

---

## 4. Domain constants (from the sketch — do not alter without a decision)

| Constant | Value |
|---|---|
| Score — driver | `drive_weight` + a fill bonus of every seat filled (`pool_weight + (n−1)·pool_step` summed, guests included), + `kudos_weight × confirmed riders` per kudos received. Defaults 10 / 3 / 2 / 2 (D-19, D-42) |
| Score — rider | **Nothing.** Riding earns no points at all (D-49). Riders are *counted, not scored* — see `pooled` below |
| `pooled` | A rider's count of `confirmed` seats on **closed** trips — deliberately **not** a ledger figure (`points_ledger` has `check (points <> 0)`, so a zero-point row is unstorable). Means *rides taken*, never *passengers carried* (D-42, D-49) |
| No-show | Registered rider who booked and didn't ride: **−10 pts**, charged to the rider (D-19) |
| Kudos | Binary, one per rider per trip, optional comment |
| Late cancellation | Within **60 min** of departure: **−5 pts** |
| Seats | default 3, min 1, max 7 |
| Trip status | `scheduled → started → closed \| cancelled` |
| Viewer role | derived: `driving` / `joined` / `open` |
| Route | owned by the **group**; trips pick round-trip or a one-way leg |
| Group code | 6 chars, uppercase, unique |
| Guest riders | name-only, no account; fill a seat so they still pay the **driver's** fill bonus, but hold no profile and earn nothing (D-09) |
| No group | authenticated user sees the **locked** state, zero trips |

Every weight above is a per-group column and overridable (D-11); the figures are the defaults. The
ledger is append-only, so changing a weight never rewrites history — each row keeps what it was worth
when written.

## 5. Design tokens (from the sketch)

Page `#d9d5cb` · surface bg `#faf8f2` · card `#fff` · ink `#16181d` · purple `#7c5cff` (driving) · green `#17c964` (primary action) · teal `#14b8c4` (joined) · amber `#ffb020` · coral `#ff6b4a` · pink `#e0559f` · cyan `#0ea5b0` · danger `#c0392b`.
Display font **Bricolage Grotesque** (800 for headings), body **Plus Jakarta Sans**.
Cards: 18px radius, 4px coloured left border, hairline `rgba(0,0,0,.07)`. Buttons 15px radius. Bottom sheets 26px top radius. Overlays slide in from the right; sheets slide up.

---

## 6. Session close

Before ending any session:
- [ ] `pnpm verify` green
- [ ] Work committed (not pushed)
- [ ] `docs/API.md` and `README.md` current
- [ ] `docs/WORKLOG.md` entry written
- [ ] New ambiguities added to `docs/DECISIONS.md`
- [ ] No secret in any tracked file
