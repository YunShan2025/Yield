/** Privacy mode is opt-in; only the explicit setting value `"true"` enables it. */
export function isPrivacyModeEnabled(raw: string | null | undefined): boolean {
  return raw === "true";
}
