# MySocLabs PIP module

## Goal
Add a PIP workflow to the existing attendance portal without changing its authentication, existing role definitions, employee records, attendance, or sidebar design. The uploaded brief ends during the creation-form section and the reference slides were not available, so the first version will use the requirements present in the brief and the existing portal’s visual patterns.

## Work
1. Add secure PIP data storage for plans, goals, check-ins, employee acknowledgements/responses, and private HR notes. Link plans to existing employee records. Use row-level access rules: Super Admin can manage all records and high-privilege outcomes; HR Admin can manage assigned plans but cannot delete plans or extend/cancel/close/reopen them; employees can view only their own published/history records and submit acknowledgement/responses. Keep private HR notes in a separate admin-only store.
2. Add an admin PIP dashboard and list with live summary counts, search and filters, plan status/progress, next review, CSV export, and a create flow using the fields provided (employee, HR owner, dates/duration, review frequency, focus areas, and concerns). Include goals with measurable KPI/target, weight, progress, rating, shared feedback, and supporting evidence. Add a PIP detail view for check-ins, notes, and permitted status actions.
3. Add employee “My PIP” view for published plans, goals, shared feedback, progress, scheduled reviews, acknowledgement, and responses. Do not expose drafts or internal HR notes.
4. Add only the requested PIP navigation entries, route-level role guards, audit entries for PIP changes, and focused tests for the role and status rules. Preserve all other portal modules and navigation items.

## Technical notes
- Use the existing `students` table as the employee source and link a person’s signed-in account through the existing email match; do not create or alter an employee database or add a Reporting Manager role.
- Use the existing app roles (Super Admin, HR Admin, Employee) without changing role definitions. Apply authorization in database policies and server-side handlers, not only in the interface.
- Keep shared employee-visible feedback separate from private HR notes so row access cannot reveal confidential notes.
- Record the PIP data boundary and access model in the root `AGENTS.md`.