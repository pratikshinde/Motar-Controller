/** `9876543210` or `+91 98765-43210` -> `+919876543210`, matching the backend's `normalize_phone`. */
export function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[\s-]+/g, '');
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  return cleaned;
}

/** Strips the +91 prefix for display in a flag-chip input, e.g. `+919876543210` -> `9876543210`. */
export function displayDigits(phone: string): string {
  return phone.replace(/^\+91/, '');
}
