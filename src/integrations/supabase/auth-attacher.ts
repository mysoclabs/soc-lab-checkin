import { createMiddleware } from '@tanstack/react-start'
import { supabase } from './client'

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    return next({
      headers: user
        ? { 'x-mock-user-id': user.id, 'x-mock-user-email': user.email }
        : {},
    });
  },
)
