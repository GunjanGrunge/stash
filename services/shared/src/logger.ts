/**
 * Structured JSON logging, one line per event, carrying the correlation id
 * that stitches a request together across handlers.
 *
 * Rule 12: never log credentials or raw AWS configuration. Callers pass
 * only the fields they intend to persist to CloudWatch.
 */
export function logger(correlationId: string): {
  info(msg: string, fields?: Record<string, unknown>): void;
} {
  return {
    info(msg: string, fields?: Record<string, unknown>): void {
      const line = {
        level: "info",
        correlation_id: correlationId,
        msg,
        ...(fields ?? {}),
      };
      console.log(JSON.stringify(line));
    },
  };
}
