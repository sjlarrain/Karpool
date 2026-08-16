# API

No routes exist yet. This file is populated starting Phase 3 (`02_IMPLEMENTATION_PLAN.md`), when
the first `/api/trips` routes land — every route added, changed, or removed updates this file in
the same commit (`CLAUDE.md` §3.4).

Per endpoint this will carry: method + path, purpose, auth requirement, request schema, response
shape, error codes, and side effects (does it write to `points_ledger` or `audit_log`?), derived
from the zod validators so docs and code can't drift.

Planned surface: `02_IMPLEMENTATION_PLAN.md` §5.
