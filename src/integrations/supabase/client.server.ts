import { createMockClient } from './mock-client';

const mockClient = createMockClient();

export const supabaseAdmin = new Proxy({} as any, {
  get(_, prop, receiver) {
    return Reflect.get(mockClient, prop, receiver);
  },
});
