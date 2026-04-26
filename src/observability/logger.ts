type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const formatLog = (level: LogLevel, message: string, details?: Record<string, unknown>): string => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...details,
  };
  return JSON.stringify(payload);
};

export const logger = {
  debug: (message: string, details?: Record<string, unknown>): void => {
    console.debug(formatLog('debug', message, details));
  },
  info: (message: string, details?: Record<string, unknown>): void => {
    console.info(formatLog('info', message, details));
  },
  warn: (message: string, details?: Record<string, unknown>): void => {
    console.warn(formatLog('warn', message, details));
  },
  error: (message: string, details?: Record<string, unknown>): void => {
    console.error(formatLog('error', message, details));
  },
};
