/** Repository-originated text is data, never markup or terminal instructions. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose of this pattern; they are escaped, never rendered.
const UNSAFE_FORMAT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u2215\u2044\uff0f\uff3c]/gu;
const MAX_DISPLAY_CODEPOINTS = 240;

export function sanitizeRepositoryDisplay(value: string, limit = MAX_DISPLAY_CODEPOINTS): string {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 4096 ? limit : MAX_DISPLAY_CODEPOINTS;
  const normalized = value.replace(UNSAFE_FORMAT, (character) => `\\u{${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}}`);
  const points = Array.from(normalized);
  return points.length > safeLimit ? `${points.slice(0, safeLimit).join("")}…` : normalized;
}
