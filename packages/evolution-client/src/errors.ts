export class EvolutionError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, opts: { status: number; body?: unknown }) {
    super(message);
    this.status = opts.status;
    this.body = opts.body;
  }
}

export class EvolutionAuthError extends EvolutionError {}
export class EvolutionNotFoundError extends EvolutionError {}
export class EvolutionRateLimitError extends EvolutionError {}
