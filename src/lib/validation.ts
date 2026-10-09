export interface PasswordRule {
  id: 'length' | 'lower' | 'upper' | 'digit';
  label: string;
  test: (pw: string) => boolean;
}

/** Mirrors the Supabase dashboard setting "Lowercase, uppercase letters and digits", min length 8. */
export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'lower', label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'upper', label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'digit', label: 'One number', test: (pw) => /[0-9]/.test(pw) },
];

export const passwordIsValid = (pw: string) => PASSWORD_RULES.every((r) => r.test(pw));

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export function usernameProblem(name: string): string | null {
  if (name.length === 0) return 'Choose a username.';
  if (name.length < 3) return 'At least 3 characters.';
  if (name.length > 16) return '16 characters at most.';
  if (!USERNAME_PATTERN.test(name)) return 'Letters, numbers and underscores only.';
  return null;
}

export function emailIsValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export const OTP_LENGTH = 6;
