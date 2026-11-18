import { z } from 'zod';

const environment = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  ORACLE_BASE_URL: z.string().url().default('http://127.0.0.1:3001'),
  ECHO_EXTERNAL_URL: z.string().url().optional(),
  ECHO_EXTERNAL_ACTIONS: z.string().optional(),
}).safeParse(process.env);

if (!environment.success) {
  throw new Error(`Invalid environment configuration: ${environment.error.message}`);
}
export const config = environment.data;
