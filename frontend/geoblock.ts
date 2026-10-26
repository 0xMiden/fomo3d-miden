/**
 * Jurisdictions the production site refuses with HTTP 451. The game is an unlicensed pay-to-play
 * game with a prize pool, which these places either sanction outright or license strictly.
 * Edit the sets, redeploy, done. Preview deployments are never blocked (see middleware.ts).
 */

/** Comprehensive sanctions programmes. */
export const SANCTIONED = new Set(["CU", "IR", "KP", "SY", "RU", "BY", "MM"]);

/** Strict gambling regimes that act against unlicensed online offerings. */
export const STRICT = new Set([
  "US", "CA", // every state / province; a few make even playing an offence
  "GB", "DE", "AT", "CH", "NL", "FR", "ES", "IT", "PT", "PL",
  "AU", "SG", "CN", "KR", "TR",
  "IN", // Promotion and Regulation of Online Gaming Act 2025: online money games banned outright
]);

export type BlockReason = "sanctioned" | "restricted";

/** Why a visitor from `country` (ISO 3166-1 alpha-2) is refused, or null when welcome. */
export function blockReason(country: string | null | undefined): BlockReason | null {
  const code = (country ?? "").toUpperCase();
  if (SANCTIONED.has(code)) return "sanctioned";
  if (STRICT.has(code)) return "restricted";
  return null;
}
