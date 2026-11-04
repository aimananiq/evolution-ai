export interface ValidationIssue {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, opts: { code: string; status: number }) {
    super(message);
    this.code = opts.code;
    this.status = opts.status;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { code: "FORBIDDEN", status: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, { code: "NOT_FOUND", status: 404 });
  }
}

export class ValidationError extends AppError {
  readonly issues: ValidationIssue[];
  constructor(message: string, opts: { issues: ValidationIssue[] }) {
    super(message, { code: "VALIDATION", status: 400 });
    this.issues = opts.issues;
  }
}
