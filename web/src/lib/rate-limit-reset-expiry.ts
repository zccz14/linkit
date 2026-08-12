export type RateLimitResetTimestamp = number | string | null | undefined

export type RateLimitResetCreditExpiry = {
  expires_at?: RateLimitResetTimestamp
}

export type RateLimitResetExpiryStatus =
  | "no-expiry"
  | "expired"
  | "expires-soon"
  | "active"

export function rateLimitResetTimestampSeconds(
  timestamp: RateLimitResetTimestamp
) {
  if (typeof timestamp === "number") return timestamp
  if (typeof timestamp !== "string") return undefined
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

export function sortRateLimitResetCreditsByExpiry<
  T extends RateLimitResetCreditExpiry,
>(credits: readonly T[]) {
  return [...credits].sort(
    (left, right) =>
      (rateLimitResetTimestampSeconds(left.expires_at) ??
        Number.POSITIVE_INFINITY) -
      (rateLimitResetTimestampSeconds(right.expires_at) ??
        Number.POSITIVE_INFINITY)
  )
}

export function rateLimitResetExpiryStatus(
  expiresAt: RateLimitResetTimestamp,
  nowSeconds = Math.floor(Date.now() / 1000)
): RateLimitResetExpiryStatus {
  const expiresAtSeconds = rateLimitResetTimestampSeconds(expiresAt)
  if (expiresAtSeconds === undefined) return "no-expiry"
  if (expiresAtSeconds <= nowSeconds) return "expired"
  return expiresAtSeconds - nowSeconds <= 24 * 60 * 60
    ? "expires-soon"
    : "active"
}
