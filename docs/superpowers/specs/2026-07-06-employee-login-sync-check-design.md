# Employee/Login Sync Check

## Problem

`students` (employee records) and `auth.users`/`user_roles` (login accounts)
are two independent tables with no foreign key or trigger linking them —
they're only ever connected by matching `email` string at query time. The
"Add Employee" flow (`students.index.tsx`) happens to create both together
via `provisionEmployeeUser`, but nothing enforces that they stay in sync
afterward. If a login account is deleted (or never created — e.g. via a
direct DB insert/seed) without the employee record being touched, the
employee still shows up in the Employees list but has no way to log in,
and nothing in the UI reveals this. This is exactly what happened to two
employees (Hruthik aluri, Kenny Pothuraju): their `students` rows were
intact but their `auth.users` accounts were gone, and there was no page
that could have shown that before their next login attempt failed.

Separately, `provisionEmployeeUser` generates a random password and
discards it without showing it anywhere — so even a freshly (re-)created
account is unusable until an admin manually resets the password out of
band (as was done by hand for both affected employees this session).

## Goals

1. A dedicated page that lists every current mismatch between employee
   records and login accounts, in both directions.
2. A one-click fix for each mismatch that results in an actually-usable
   outcome (not another silently-discarded password).
3. Fix `provisionEmployeeUser` so the temp password it generates is
   surfaced to the admin instead of thrown away — benefits both this new
   page and the existing "Add Employee" flow that already calls it.

## Non-goals

- No foreign key or DB-level constraint tying `students` to `auth.users` —
  that would require a schema change touching existing RLS policies and
  every query that currently joins the two tables by email; out of scope
  here. This is a detection/remediation tool, not a schema redesign.
- No self-service "change my password" or "forgot password" flow for
  employees — a real gap found this session, but a separate feature with
  its own design.
- No automatic/scheduled reconciliation (e.g. a cron job). This is an
  admin-visited page, checked on demand.
- Accounts with roles other than `employee` (super_admin, hr_admin,
  founder, finance) are never flagged for missing an employee record —
  that's expected for staff/leadership logins that aren't attendance-
  tracked employees.
- No audit-log entry for account deletion — that's the second, separately
  scoped piece of work agreed on before this spec, not included here.

## Design

### A) Backend — `getSyncStatus` server function

New function in `src/lib/users.functions.ts`, following the existing
`assertSuperAdmin` gate already used by `listUsersWithRoles`/`setUserRole`
in the same file:

1. Fetch all `students` rows (`id, student_id, name, email`).
2. Fetch all `auth.users` via `supabaseAdmin.auth.admin.listUsers` (same
   call `listUsersWithRoles` already makes) and all `user_roles`.
3. Build a lowercase-email set from each side, then compute:
   - `missingLogin`: students whose email has no matching auth user.
   - `missingEmployee`: auth users whose resolved role is `employee`
     (same role-priority logic already in `listUsersWithRoles`) and whose
     email has no matching student.
4. Return `{ missingLogin: StudentRow[], missingEmployee: { id, email,
   created_at }[] }`.

Email comparisons are case-insensitive (`lower(email)`), matching how
`current_user_email()` / RLS policies already compare emails elsewhere in
this codebase.

### B) Backend — fix `provisionEmployeeUser`

Currently returns `{ id }` and discards the generated password. Change
the return type to `{ id: string, tempPassword: string }`. The one
existing caller (`students.index.tsx`'s employee-upsert mutation) needs no
behavior change to keep working (extra field is simply unused there for
now) — but see Open Questions on whether to surface it there too.

### C) Backend — new `provisionEmployeeRecord` server function

For the `missingEmployee` direction: takes `{ email: string, name: string
}` (both required — `students.name` is `NOT NULL`), validated with zod
same as sibling functions, gated by `assertSuperAdmin`. Inserts a
`students` row (mirrors the inline insert `createUserWithRole` already
does at line ~151 of `users.functions.ts`). No `user_id` is stored since
`students` has no such column — the link remains purely by email, same as
everywhere else in this schema.

### D) Frontend — `/users/sync-check` route

New authenticated route, admin-only (same `RoleGuard` pattern as
`users.tsx`). Linked from the existing Users & Roles page header via a
small button, e.g. "Sync Check" — shown with a count badge when
`missingLogin.length + missingEmployee.length > 0`, so admins notice
without having to visit the page proactively.

Two tables, each empty-state "Nothing to fix here" when its list is empty:

**Employees with no login** — Name, Employee ID, Email, and a **Create
Login** button per row. On click: calls the fixed `provisionEmployeeUser`,
then opens a dismissible dialog showing the returned temp password once
with a copy-to-clipboard button (mirrors the existing password-reveal
styling already used in `users.tsx`'s "Add User" form). Row is removed
from the list on success (refetch or optimistic removal).

**Logins with no employee record** — Email, Created date, an inline Name
text input, and a **Create Employee Record** button (disabled until Name
is non-empty). On click: calls `provisionEmployeeRecord`, removes the row
from the list on success.

### E) Error handling

Both actions go through the same thrown-`Error` → toast pattern used by
every other mutation in this codebase (e.g. `students.index.tsx`'s
existing `provisionEmployeeUser` call site) — no new error-handling
pattern introduced.

### F) Testing

No existing automated test setup for this app's server functions (all
verification in this codebase so far has been manual, live). Verification
plan:

1. Create a throwaway `students` row with no matching auth user (service
   role, direct insert) → confirm it appears under "Employees with no
   login" → click Create Login → confirm the dialog shows a password →
   confirm that email/password combination actually authenticates via the
   real password-grant flow → confirm the row disappears.
2. Create a throwaway auth user with role `employee` and no matching
   student (service role) → confirm it appears under "Logins with no
   employee record" → fill in a name, click Create Employee Record →
   confirm a `students` row now exists with that email/name → confirm the
   row disappears.
3. Confirm an admin/hr_admin/founder/finance-role account with no student
   record does *not* appear in either list.
4. Delete all throwaway test data (student row, auth user) after
   verification, same cleanup discipline used throughout this session.

## Open questions

- Should `students.index.tsx`'s existing "Add Employee" flow start
  showing the temp password returned by the now-fixed
  `provisionEmployeeUser` too (currently it only shows a warning toast on
  *failure*, never the password on success)? Leaning yes, since silently
  handing back an unusable account is the same bug in a different place —
  but leaving as an explicit open question rather than deciding
  unilaterally, since it changes an existing, already-shipped flow rather
  than only adding a new page.
