export class AppError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found`, 404, "NOT_FOUND");
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, 403, "FORBIDDEN");
  }
}
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "VALIDATION", details);
  }
}
/** The requested action is not valid in the record's current state. */
export class StateError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, "INVALID_STATE", details);
  }
}
export class NotConfiguredError extends AppError {
  constructor(message: string) {
    super(message, 501, "NOT_CONFIGURED");
  }
}
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
