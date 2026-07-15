import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createMockClient } from '@/integrations/supabase/mock-client'

const MOCK_USER_MAP: Record<string, { id: string; email: string; role: string }> = {
  'admin@mysoclabs.com': { id: 'dev-user-id', email: 'admin@mysoclabs.com', role: 'super_admin' },
  'abebe@mysoclabs.com': { id: 'user-abebe-001', email: 'abebe@mysoclabs.com', role: 'hr_admin' },
  'chaltu@mysoclabs.com': { id: 'user-chaltu-001', email: 'chaltu@mysoclabs.com', role: 'employee' },
  'dawit@mysoclabs.com': { id: 'user-dawit-001', email: 'dawit@mysoclabs.com', role: 'employee' },
  'fatima@mysoclabs.com': { id: 'user-fatima-001', email: 'fatima@mysoclabs.com', role: 'employee' },
};

function resolveUser(userId: string | null, email: string | null) {
  if (email && MOCK_USER_MAP[email.toLowerCase()]) {
    return MOCK_USER_MAP[email.toLowerCase()];
  }
  if (userId) {
    for (const u of Object.values(MOCK_USER_MAP)) {
      if (u.id === userId) return u;
    }
  }
  return { id: 'dev-user-id', email: 'admin@mysoclabs.com', role: 'super_admin' };
}

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest();
    const userId = request?.headers.get('x-mock-user-id') ?? null;
    const email = request?.headers.get('x-mock-user-email') ?? null;
    const user = resolveUser(userId, email);

    const mockClient = createMockClient();

    return next({
      context: {
        supabase: new Proxy({} as any, {
          get(_, prop) {
            if (prop === 'auth') {
              return {
                getUser: async () => ({ data: { user: { id: user.id, email: user.email } }, error: null }),
                getClaims: async () => ({ data: { claims: { sub: user.id, email: user.email } }, error: null }),
              };
            }
            if (prop === 'from') {
              return mockClient.from;
            }
            return undefined;
          },
        }),
        userId: user.id,
        claims: { sub: user.id, email: user.email },
      },
    });
  },
);
