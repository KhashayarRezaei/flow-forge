export interface AppConfig {
  port: number;
  apiKey: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    synchronize: boolean;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  engine: {
    stepMaxAttempts: number;
    stepBackoffMs: number;
    concurrency: number;
  };
  llm: {
    apiKey?: string;
    model: string;
    baseUrl: string;
  };
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export default (): AppConfig => ({
  port: toInt(process.env.PORT, 3000),
  apiKey: process.env.API_KEY || 'dev-secret-key',
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: toInt(process.env.DATABASE_PORT, 5432),
    user: process.env.DATABASE_USER || 'flowforge',
    password: process.env.DATABASE_PASSWORD || 'flowforge',
    name: process.env.DATABASE_NAME || 'flowforge',
    synchronize: toBool(process.env.DATABASE_SYNC, true),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  engine: {
    stepMaxAttempts: toInt(process.env.STEP_MAX_ATTEMPTS, 3),
    stepBackoffMs: toInt(process.env.STEP_BACKOFF_MS, 1000),
    concurrency: toInt(process.env.ENGINE_CONCURRENCY, 5),
  },
  llm: {
    apiKey: process.env.GEMINI_API_KEY || undefined,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  },
});
