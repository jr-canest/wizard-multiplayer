/**
 * Whether placing `bid` would violate the Canadian rule for the dealer.
 * Returns false on round 1 (single-card round is exempt) and for non-dealers.
 * Pure so the bot simulator can share it with gameFlow.
 */
export function violatesCanadianRule(args: {
  isDealerBid: boolean;
  canadianRule: boolean;
  currentRound: number;
  cardsThisRound: number;
  otherBidsSum: number;
  bid: number;
}): boolean {
  if (!args.canadianRule) return false;
  if (!args.isDealerBid) return false;
  if (args.currentRound === 1) return false;
  return args.otherBidsSum + args.bid === args.cardsThisRound;
}
