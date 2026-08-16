import { GROUP_CODE_LENGTH } from "./constants";

// Pure domain logic for group codes: uppercase alphanumeric, collision-checked by the caller,
// case-insensitive on join (02_IMPLEMENTATION_PLAN.md Phase 2 rules). No I/O — collision checking
// against the database happens in the API route, not here.

// Excludes visually ambiguous characters (0/O, 1/I/L) so a spoken or handwritten code round-trips.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGroupCode(): string {
  let code = "";
  for (let i = 0; i < GROUP_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeGroupCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidGroupCodeFormat(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${GROUP_CODE_LENGTH}}$`).test(code);
}
