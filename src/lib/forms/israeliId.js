/**
 * israeliId — validation for an Israeli national ID number (תעודת זהות).
 *
 * Used by the Forms feature (ייפוי כוח) where both the authorizer and the
 * authorized representative must supply a valid ת.ז. A wrong ID on a
 * power-of-attorney is the kind of error the licensing clerk rejects on
 * the spot, so we validate the checksum before letting the user export.
 *
 * Algorithm (standard Israeli ID checksum):
 *   • 9 digits (shorter numbers are zero-padded on the left).
 *   • Multiply each digit by 1 or 2 alternately (1,2,1,2,...).
 *   • If a product is > 9, subtract 9 (i.e. sum its digits).
 *   • The total must be divisible by 10.
 */

/** Strip everything but digits. */
export function normalizeId(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * True when `raw` is a structurally valid Israeli ID (1–9 digits that
 * pass the checksum once left-padded to 9). Empty / non-numeric → false.
 */
export function isValidIsraeliId(raw) {
  const digits = normalizeId(raw);
  if (digits.length === 0 || digits.length > 9) return false;
  const id = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let num = Number(id[i]) * ((i % 2) + 1);
    if (num > 9) num -= 9;
    sum += num;
  }
  return sum % 10 === 0;
}

/**
 * Validation helper for form fields. Returns a short Hebrew error string
 * when invalid, or '' when valid. `required` controls whether an empty
 * value is itself an error.
 */
export function idFieldError(raw, { required = true } = {}) {
  const digits = normalizeId(raw);
  if (digits.length === 0) return required ? 'יש להזין מספר ת.ז' : '';
  if (digits.length < 9) return 'מספר ת.ז חייב להיות 9 ספרות';
  if (!isValidIsraeliId(digits)) return 'מספר ת.ז אינו תקין';
  return '';
}
