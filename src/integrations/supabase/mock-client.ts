import type { Database } from './types';

const uuid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

const STUDENT_1 = uuid();
const STUDENT_2 = uuid();
const STUDENT_3 = uuid();
const STUDENT_4 = uuid();
const STUDENT_5 = uuid();

const MOCK_USER_ID = 'dev-user-id';
const MOCK_USER_EMAIL = 'admin@mysoclabs.com';
const USER_2 = 'user-abebe-001';
const USER_3 = 'user-chaltu-001';
const USER_4 = 'user-dawit-001';
const USER_5 = 'user-fatima-001';

const MOCK_AUTH_USERS = [
  { id: MOCK_USER_ID, email: MOCK_USER_EMAIL, created_at: '2024-01-15T08:00:00Z' },
  { id: USER_2, email: 'abebe@mysoclabs.com', created_at: '2024-03-01T08:00:00Z' },
  { id: USER_3, email: 'chaltu@mysoclabs.com', created_at: '2024-06-15T08:00:00Z' },
  { id: USER_4, email: 'dawit@mysoclabs.com', created_at: '2024-09-01T08:00:00Z' },
  { id: USER_5, email: 'fatima@mysoclabs.com', created_at: '2025-01-10T08:00:00Z' },
];

const MOCK_STUDENTS = [
  { id: STUDENT_1, student_id: 'SOC-001', name: 'Tunga Mulugeta', email: 'admin@mysoclabs.com', phone: '+251911000001', department: 'Engineering', designation: 'Lead Developer', joining_date: '2024-01-15', photo_url: null, qr_code: 'SOC-001', batch: 'Batch-1', created_at: '2024-01-15T08:00:00Z' },
  { id: STUDENT_2, student_id: 'SOC-002', name: 'Abebe Kebede', email: 'abebe@mysoclabs.com', phone: '+251911000002', department: 'Design', designation: 'UI/UX Designer', joining_date: '2024-03-01', photo_url: null, qr_code: 'SOC-002', batch: 'Batch-1', created_at: '2024-03-01T08:00:00Z' },
  { id: STUDENT_3, student_id: 'SOC-003', name: 'Chaltu Damera', email: 'chaltu@mysoclabs.com', phone: '+251911000003', department: 'Engineering', designation: 'Frontend Developer', joining_date: '2024-06-15', photo_url: null, qr_code: 'SOC-003', batch: 'Batch-2', created_at: '2024-06-15T08:00:00Z' },
  { id: STUDENT_4, student_id: 'SOC-004', name: 'Dawit Tesfaye', email: 'dawit@mysoclabs.com', phone: '+251911000004', department: 'Engineering', designation: 'Backend Developer', joining_date: '2024-09-01', photo_url: null, qr_code: 'SOC-004', batch: 'Batch-2', created_at: '2024-09-01T08:00:00Z' },
  { id: STUDENT_5, student_id: 'SOC-005', name: 'Fatima Hassan', email: 'fatima@mysoclabs.com', phone: '+251911000005', department: 'Marketing', designation: 'Marketing Intern', joining_date: '2025-01-10', photo_url: null, qr_code: 'SOC-005', batch: 'Batch-3', created_at: '2025-01-10T08:00:00Z' },
];

const SHIFT_1 = uuid();
const SHIFT_2 = uuid();

const MOCK_SHIFTS = [
  { id: SHIFT_1, name: 'Morning Shift', start_time: '09:00:00', end_time: '17:00:00', late_cutoff_minutes: 30, is_default: true, created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
  { id: SHIFT_2, name: 'Evening Shift', start_time: '14:00:00', end_time: '22:00:00', late_cutoff_minutes: 30, is_default: false, created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
];

function makeAttendance(studentId: string, date: string, checkIn: string, status: string, checkOut?: string) {
  return { id: uuid(), student_id: studentId, date, check_in: checkIn, check_out: checkOut ?? null, status, created_at: checkIn };
}

const MOCK_ATTENDANCE = [
  makeAttendance(STUDENT_1, today(), `${today()}T08:55:00Z`, 'present', `${today()}T17:05:00Z`),
  makeAttendance(STUDENT_2, today(), `${today()}T09:05:00Z`, 'present', `${today()}T17:10:00Z`),
  makeAttendance(STUDENT_3, today(), `${today()}T09:45:00Z`, 'late'),
  makeAttendance(STUDENT_4, today(), `${today()}T08:50:00Z`, 'present', `${today()}T16:55:00Z`),
];

const MOCK_LEAVE_REQUESTS = [
  { id: uuid(), employee_id: STUDENT_5, user_id: 'dev-user-id', leave_type: 'casual', start_date: '2026-07-20', end_date: '2026-07-21', reason: 'Family event', status: 'pending', admin_comment: null, reviewed_by: null, reviewed_at: null, created_at: '2026-07-10T08:00:00Z', updated_at: '2026-07-10T08:00:00Z' },
  { id: uuid(), employee_id: STUDENT_3, user_id: null, leave_type: 'sick', start_date: '2026-07-14', end_date: '2026-07-14', reason: 'Feeling unwell', status: 'approved', admin_comment: 'Get well soon', reviewed_by: MOCK_USER_ID, reviewed_at: '2026-07-13T10:00:00Z', created_at: '2026-07-12T08:00:00Z', updated_at: '2026-07-13T10:00:00Z' },
];

const MOCK_HOLIDAYS = [
  { id: uuid(), name: 'Fasika (Ethiopian Easter)', date: '2026-04-12', type: 'public', description: 'Orthodox Easter celebration', created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
  { id: uuid(), name: 'Independence Day', date: '2026-05-28', type: 'public', description: 'Ethiopian Independence Day', created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
  { id: uuid(), name: 'Company Team Building', date: '2026-08-15', type: 'company', description: 'Annual team building event', created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
];

const MOCK_EMPLOYEE_SHIFTS = [
  { id: uuid(), employee_id: STUDENT_1, shift_id: SHIFT_1, effective_from: '2024-01-15', created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
  { id: uuid(), employee_id: STUDENT_2, shift_id: SHIFT_1, effective_from: '2024-03-01', created_at: '2024-03-01T08:00:00Z', updated_at: '2024-03-01T08:00:00Z' },
  { id: uuid(), employee_id: STUDENT_3, shift_id: SHIFT_2, effective_from: '2024-06-15', created_at: '2024-06-15T08:00:00Z', updated_at: '2024-06-15T08:00:00Z' },
  { id: uuid(), employee_id: STUDENT_4, shift_id: SHIFT_1, effective_from: '2024-09-01', created_at: '2024-09-01T08:00:00Z', updated_at: '2024-09-01T08:00:00Z' },
  { id: uuid(), employee_id: STUDENT_5, shift_id: SHIFT_1, effective_from: '2025-01-10', created_at: '2025-01-10T08:00:00Z', updated_at: '2025-01-10T08:00:00Z' },
];

const MOCK_NOTIFICATIONS = [
  { id: uuid(), audience: 'admins', user_id: null, type: 'info', title: 'Welcome to MySocLabs', message: 'The attendance system is now live.', link: null, read: false, created_at: '2026-07-01T08:00:00Z' },
  { id: uuid(), audience: 'all', user_id: null, type: 'reminder', title: 'Monthly Report Due', message: 'Please submit your monthly attendance report by the 5th.', link: '/reports', read: false, created_at: '2026-07-10T08:00:00Z' },
];

const MOCK_AUDIT_LOGS = [
  { id: uuid(), user_id: MOCK_USER_ID, user_name: 'Tunga Mulugeta', action: 'login', entity: 'auth', entity_id: MOCK_USER_ID, details: null, ip_address: '127.0.0.1', created_at: now() },
  { id: uuid(), user_id: MOCK_USER_ID, user_name: 'Tunga Mulugeta', action: 'create', entity: 'students', entity_id: STUDENT_5, details: { name: 'Fatima Hassan' }, ip_address: '127.0.0.1', created_at: '2026-07-10T08:00:00Z' },
];

const MOCK_USER_ROLES = [
  { id: uuid(), user_id: MOCK_USER_ID, role: 'super_admin', created_at: '2024-01-15T08:00:00Z' },
  { id: uuid(), user_id: USER_2, role: 'hr_admin', created_at: '2024-03-01T08:00:00Z' },
  { id: uuid(), user_id: USER_3, role: 'employee', created_at: '2024-06-15T08:00:00Z' },
  { id: uuid(), user_id: USER_4, role: 'employee', created_at: '2024-09-01T08:00:00Z' },
  { id: uuid(), user_id: USER_5, role: 'employee', created_at: '2025-01-10T08:00:00Z' },
];

const MOCK_PAYROLL = [
  { id: uuid(), employee_id: STUDENT_1, employee_name: 'Tunga Mulugeta', employee_type: 'full_time', amount: 25000, period_month: 7, period_year: 2026, status: 'pending', notes: null, paid_at: null, created_at: '2026-07-01T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
  { id: uuid(), employee_id: STUDENT_2, employee_name: 'Abebe Kebede', employee_type: 'full_time', amount: 22000, period_month: 7, period_year: 2026, status: 'pending', notes: null, paid_at: null, created_at: '2026-07-01T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
];

const MOCK_REVENUES = [
  { id: uuid(), source: 'Internship Fees', client_name: 'ABC Corp', amount: 150000, description: 'Batch-2 internship program', revenue_date: '2026-07-01', status: 'received', created_at: '2026-07-01T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
];

const MOCK_EXPENSES = [
  { id: uuid(), category: 'Office Rent', amount: 50000, expense_date: '2026-07-01', notes: 'July office rent', created_by: MOCK_USER_ID, created_at: '2026-07-01T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
];

const MOCK_INVOICES = [
  { id: uuid(), invoice_number: 'INV-2026-001', client_name: 'ABC Corp', amount: 150000, issue_date: '2026-07-01', due_date: '2026-07-31', status: 'paid', notes: 'Internship program fee', created_at: '2026-07-01T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
];

const MOCK_LOGIN_ATTEMPTS: any[] = [];
const MOCK_PASSWORD_RESET_ATTEMPTS: any[] = [];

type TableData = Record<string, any[]>;
const db: TableData = {
  students: MOCK_STUDENTS,
  attendance: MOCK_ATTENDANCE,
  shifts: MOCK_SHIFTS,
  employee_shifts: MOCK_EMPLOYEE_SHIFTS,
  leave_requests: MOCK_LEAVE_REQUESTS,
  holidays: MOCK_HOLIDAYS,
  notifications: MOCK_NOTIFICATIONS,
  audit_logs: MOCK_AUDIT_LOGS,
  user_roles: MOCK_USER_ROLES,
  payroll: MOCK_PAYROLL,
  revenues: MOCK_REVENUES,
  expenses: MOCK_EXPENSES,
  invoices: MOCK_INVOICES,
  login_attempts: MOCK_LOGIN_ATTEMPTS,
  password_reset_attempts: MOCK_PASSWORD_RESET_ATTEMPTS,
  office_settings: [
    { id: 1, office_start_time: '09:00:00', office_end_time: '17:00:00', late_threshold: '09:30:00', grace_period_minutes: 15, working_hours: 8, half_day_threshold: '4:00', created_at: '2024-01-15T08:00:00Z', updated_at: '2024-01-15T08:00:00Z' },
  ],
};

function cloneRows(rows: any[]) {
  return JSON.parse(JSON.stringify(rows));
}

function applyFilter(rows: any[], filters: Array<{ col: string; op: string; val: any }>) {
  return rows.filter((row) => {
    for (const f of filters) {
      const v = row[f.col];
      switch (f.op) {
        case 'eq': if (v !== f.val) return false; break;
        case 'neq': if (v === f.val) return false; break;
        case 'gt': if (!(v > f.val)) return false; break;
        case 'gte': if (!(v >= f.val)) return false; break;
        case 'lt': if (!(v < f.val)) return false; break;
        case 'lte': if (!(v <= f.val)) return false; break;
        case 'in': if (!f.val.includes(v)) return false; break;
        case 'contains': if (typeof v === 'string' && !v.includes(f.val)) return false; break;
        case 'like': {
          const pattern = f.val.replace(/%/g, '.*');
          if (!(new RegExp(`^${pattern}$`).test(v ?? ''))) return false;
          break;
        }
      }
    }
    return true;
  });
}

function applyOrFilter(rows: any[], filterStr: string) {
  const parts = filterStr.split(',');
  return rows.filter((row) => {
    return parts.some((part) => {
      const match = part.trim().match(/^(\w+)\.(eq|neq|gt|gte|lt|lte)\.(.+)$/);
      if (!match) return false;
      const [, col, op, val] = match;
      const v = row[col];
      switch (op) {
        case 'eq': return String(v) === val;
        case 'neq': return String(v) !== val;
        default: return false;
      }
    });
  });
}

class MockQueryBuilder {
  private tableName: string;
  private rows: any[];
  private filters: Array<{ col: string; op: string; val: any }> = [];
  private orFilterStr: string | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private selectCols: string | null = null;
  private countOnly = false;
  private headOnly = false;
  private singleMode = false;
  private maybeSingleMode = false;
  private joinSpec: Record<string, { table: string; localCol: string; foreignCol: string }> = {};
  private opType: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private insertData: any = null;
  private updateData: any = null;
  private returningCols: string | null = null;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.rows = db[tableName] ?? [];
  }

  select(colsOrOpts?: any, opts?: any) {
    this.opType = 'select';
    if (colsOrOpts && typeof colsOrOpts === 'object' && !Array.isArray(colsOrOpts)) {
      if (colsOrOpts.count) this.countOnly = true;
      if (colsOrOpts.head) this.headOnly = true;
      this.selectCols = '*';
    } else {
      this.selectCols = colsOrOpts ?? '*';
    }
    if (typeof colsOrOpts === 'string' && colsOrOpts !== '*') {
      this.parseSelectCols(colsOrOpts);
    }
    return this;
  }

  private parseSelectCols(cols: string) {
    const segments = cols.split(',');
    for (const seg of segments) {
      const joinMatch = seg.trim().match(/^(\w+):(\w+)\((.+)\)$/);
      if (joinMatch) {
        const [, alias, foreignTable, innerCols] = joinMatch;
        this.joinSpec[alias] = { table: foreignTable, localCol: alias, foreignCol: 'id' };
      }
    }
  }

  insert(data: any) {
    this.opType = 'insert';
    this.insertData = Array.isArray(data) ? data : [data];
    return this;
  }

  update(data: any) {
    this.opType = 'update';
    this.updateData = data;
    return this;
  }

  delete() {
    this.opType = 'delete';
    return this;
  }

  eq(col: string, val: any) { this.filters.push({ col, op: 'eq', val }); return this; }
  neq(col: string, val: any) { this.filters.push({ col, op: 'neq', val }); return this; }
  gt(col: string, val: any) { this.filters.push({ col, op: 'gt', val }); return this; }
  gte(col: string, val: any) { this.filters.push({ col, op: 'gte', val }); return this; }
  lt(col: string, val: any) { this.filters.push({ col, op: 'lt', val }); return this; }
  lte(col: string, val: any) { this.filters.push({ col, op: 'lte', val }); return this; }
  in(col: string, vals: any[]) { this.filters.push({ col, op: 'in', val: vals }); return this; }
  like(col: string, val: string) { this.filters.push({ col, op: 'like', val }); return this; }
  contains(col: string, val: string) { this.filters.push({ col, op: 'contains', val }); return this; }
  or(filterStr: string) { this.orFilterStr = filterStr; return this; }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number) { this.limitN = n; return this; }
  single() { this.singleMode = true; return this; }
  maybeSingle() { this.maybeSingleMode = true; return this; }

  async then(resolve: any, reject?: any) {
    try {
      const result = await this.execute();
      resolve(result);
    } catch (err) {
      if (reject) reject(err);
      else resolve({ data: null, error: { message: String(err) } });
    }
  }

  private async execute(): Promise<{ data: any; error: any; count?: number }> {
    if (this.opType === 'insert') return this.executeInsert();
    if (this.opType === 'update') return this.executeUpdate();
    if (this.opType === 'delete') return this.executeDelete();
    return this.executeSelect();
  }

  private applyFiltersToRows(rows: any[]) {
    let result = rows;
    if (this.filters.length > 0) {
      result = applyFilter(result, this.filters);
    }
    if (this.orFilterStr) {
      result = applyOrFilter(result, this.orFilterStr);
    }
    return result;
  }

  private applyOrdering(rows: any[]) {
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows.sort((a: any, b: any) => {
        const av = a[col], bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return asc ? 1 : -1;
        if (bv == null) return asc ? -1 : 1;
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }

  private resolveJoins(rows: any[]) {
    if (Object.keys(this.joinSpec).length === 0) return rows;
    return rows.map((row) => {
      const enriched = { ...row };
      for (const [alias, spec] of Object.entries(this.joinSpec)) {
        const foreignRows = db[spec.table] ?? [];
        const localVal = row[spec.localCol];
        const innerCols = this.selectCols?.match(new RegExp(`${alias}:${spec.table}\\(([^)]+)\\)`))?.[1];

        if (innerCols) {
          const cols = innerCols.split(',').map((c: string) => c.trim());
          const match = foreignRows.find((fr: any) => fr[spec.foreignCol] === localVal);
          if (match) {
            enriched[alias] = Object.fromEntries(cols.filter((c: string) => c !== spec.foreignCol).map((c: string) => [c, match[c]]));
          } else {
            enriched[alias] = null;
          }
        } else {
          const match = foreignRows.find((fr: any) => fr[spec.foreignCol] === localVal);
          enriched[alias] = match ?? null;
        }
      }
      return enriched;
    });
  }

  private executeSelect() {
    let rows = cloneRows(this.rows);
    rows = this.applyFiltersToRows(rows);
    rows = this.applyOrdering(rows);
    rows = this.resolveJoins(rows);

    if (this.countOnly) {
      return Promise.resolve({ data: null, error: null, count: rows.length });
    }

    if (this.limitN !== null) {
      rows = rows.slice(0, this.limitN);
    }

    if (this.headOnly) {
      return Promise.resolve({ data: null, error: null, count: rows.length });
    }

    if (this.singleMode) {
      if (rows.length === 0) return Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
      return Promise.resolve({ data: rows[0], error: null });
    }

    if (this.maybeSingleMode) {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    return Promise.resolve({ data: rows, error: null });
  }

  private executeInsert() {
    const inserted = (this.insertData ?? []).map((row: any) => ({
      id: uuid(),
      created_at: now(),
      ...row,
    }));
    if (!db[this.tableName]) db[this.tableName] = [];
    db[this.tableName].push(...inserted);
    if (this.returningCols || this.selectCols) {
      return Promise.resolve({ data: inserted.length === 1 ? inserted[0] : inserted, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  private executeUpdate() {
    let rows = cloneRows(this.rows);
    rows = this.applyFiltersToRows(rows);
    const updated: any[] = [];
    const tableRows = db[this.tableName] ?? [];
    for (const row of rows) {
      const idx = tableRows.findIndex((r: any) => r.id === row.id);
      if (idx !== -1) {
        tableRows[idx] = { ...tableRows[idx], ...this.updateData };
        updated.push(tableRows[idx]);
      }
    }
    return Promise.resolve({ data: updated, error: null });
  }

  private executeDelete() {
    let rows = this.applyFiltersToRows(this.rows);
    const tableRows = db[this.tableName] ?? [];
    const ids = new Set(rows.map((r: any) => r.id));
    db[this.tableName] = tableRows.filter((r: any) => !ids.has(r.id));
    return Promise.resolve({ data: null, error: null });
  }

  csv() { return this; }
  geojson() { return this; }
}

function mockFrom(table: string) {
  return new MockQueryBuilder(table);
}

let authStateListeners: Array<(event: string, session: any) => void> = [];

function findUserByEmail(email: string) {
  return MOCK_AUTH_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? { id: MOCK_USER_ID, email, created_at: now() };
}

function readSession() {
  if (typeof window === 'undefined') return null;
  const email = localStorage.getItem('mock-session-email');
  if (!email) return null;
  const user = findUserByEmail(email);
  return { user: { id: user.id, email: user.email }, access_token: 'mock-token', refresh_token: 'mock-refresh' };
}

function writeSession(email: string | null) {
  if (typeof window === 'undefined') return;
  if (email) localStorage.setItem('mock-session-email', email);
  else localStorage.removeItem('mock-session-email');
}

function mockAuth() {
  return {
    getSession: async () => ({ data: { session: readSession() }, error: null }),
    getUser: async () => {
      const session = readSession();
      if (session) return { data: { user: session.user }, error: null };
      return { data: { user: null }, error: null };
    },
    setSession: async (session: any) => {
      const email = typeof session?.email === 'string' ? session.email : localStorage.getItem('mock-session-email');
      if (email) writeSession(email);
      const s = readSession();
      authStateListeners.forEach((cb) => cb('SIGNED_IN', s));
      return { data: null, error: null };
    },
    signOut: async () => {
      writeSession(null);
      authStateListeners.forEach((cb) => cb('SIGNED_OUT', null));
      return { data: null, error: null };
    },
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      authStateListeners.push(callback);
      return {
        data: { subscription: { unsubscribe: () => { authStateListeners = authStateListeners.filter((cb) => cb !== callback); } } },
      };
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      if (password.length < 6) return { data: null, error: { message: 'Invalid login credentials' } };
      const user = findUserByEmail(email);
      writeSession(user.email);
      const session = readSession();
      authStateListeners.forEach((cb) => cb('SIGNED_IN', session));
      return { data: { session, user: session!.user }, error: null };
    },
    getClaims: async (token: string) => {
      if (!token) return { data: null, error: { message: 'No token' } };
      const session = readSession();
      if (session) return { data: { claims: { sub: session.user.id, email: session.user.email } }, error: null };
      return { data: { claims: { sub: MOCK_USER_ID, email: MOCK_USER_EMAIL } }, error: null };
    },
    admin: {
      listUsers: async () => ({
        data: { users: cloneRows(MOCK_AUTH_USERS), total: MOCK_AUTH_USERS.length },
        error: null,
      }),
      createUser: async ({ email, password }: any) => {
        const id = uuid();
        return { data: { user: { id, email } }, error: null };
      },
      deleteUser: async (id: string) => ({ data: null, error: null }),
      signOut: async () => ({ data: null, error: null }),
      getUser: async (token: string) => {
        const session = readSession();
        return {
          data: { user: session?.user ?? { id: MOCK_USER_ID, email: MOCK_USER_EMAIL } },
          error: null,
        };
      },
    },
    resetPasswordForEmail: async () => ({ data: null, error: null }),
    verifyOtp: async () => ({ data: { session: readSession() }, error: null }),
    updateUser: async () => ({ data: { user: { id: MOCK_USER_ID, email: MOCK_USER_EMAIL } }, error: null }),
  };
}

function mockStorage() {
  return {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string, expiresIn?: number) => ({
        data: { signedUrl: `https://mock-storage.example.com/${bucket}/${path}` },
        error: null,
      }),
      upload: async (path: string, file: any, opts?: any) => ({
        data: { path: `${bucket}/${path}` },
        error: null,
      }),
    }),
  };
}

const realtimeChannels: Map<string, any> = new Map();

function mockChannel(name: string) {
  const channel = {
    on: (event: string, filter: any, callback?: any) => channel,
    subscribe: () => {
      realtimeChannels.set(name, channel);
      return channel;
    },
  };
  return channel;
}

export function createMockClient() {
  return {
    from: mockFrom,
    auth: mockAuth(),
    storage: mockStorage(),
    channel: mockChannel,
    removeChannel: (ch: any) => {
      realtimeChannels.delete(ch?.topic ?? '');
      return { error: null };
    },
    rpc: async (fn: string, params?: any) => {
      if (fn === 'has_role') {
        return { data: true, error: null };
      }
      if (fn === 'current_user_email') {
        return { data: MOCK_USER_EMAIL, error: null };
      }
      if (fn === 'generate_student_id') {
        return { data: `SOC-${String(db.students.length + 1).padStart(3, '0')}`, error: null };
      }
      return { data: null, error: null };
    },
  };
}
