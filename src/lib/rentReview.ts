/**
 * The rent to put back when an applied increase is undone (or deleted). If the rent is still the one this
 * increase set, it goes back to the rent stored before it. If the rent changed since (a later increase,
 * a correction by hand), only this increase is taken out: the rent is divided by 1 + its percentage, the
 * same way the balances price the months before an increase. The page shows this amount in the confirmation.
 */
export function rentBeforeReview(
  review: { rate: number; rentBefore: number | null; rentAfter: number | null },
  currentRent: number,
): number {
  if (review.rentBefore !== null && review.rentAfter !== null && Math.round(currentRent) === Math.round(review.rentAfter)) {
    return review.rentBefore;
  }
  return Math.round(currentRent / (1 + review.rate));
}
