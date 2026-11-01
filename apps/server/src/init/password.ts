export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MAX_ADMIN_PASSWORD_LENGTH = 1024;

export function validateAdminPassword(password: string): string | null {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `admin password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`;
  }

  if (password.length > MAX_ADMIN_PASSWORD_LENGTH) {
    return `admin password must be at most ${MAX_ADMIN_PASSWORD_LENGTH} characters`;
  }

  if (password.trim().length < MIN_ADMIN_PASSWORD_LENGTH) {
    return "admin password must not be only whitespace";
  }

  return null;
}
