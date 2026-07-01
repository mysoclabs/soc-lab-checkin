-- Update the default "General" shift to the target check-in window:
-- present through 8:39:59, late from 8:40, check-in blocked after 16:30.
-- Employees with a custom employee_shifts assignment are unaffected —
-- resolveEffectiveShift() always prefers their assigned shift over this
-- default.
UPDATE public.shifts
SET start_time = '08:30:00',
    end_time = '16:30:00',
    late_cutoff_minutes = 10,
    updated_at = now()
WHERE is_default = true;

-- ============ verify ============
-- SELECT name, start_time, end_time, late_cutoff_minutes, is_default
-- FROM public.shifts WHERE is_default = true;
