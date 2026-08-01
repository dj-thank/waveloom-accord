const SIDES = Object.freeze(['east', 'west']);

function validSides(sides) {
  return Array.isArray(sides) && sides.length === 2 &&
    SIDES.includes(sides[0]) && SIDES.includes(sides[1]) && sides[0] !== sides[1];
}

// Scores belong to teams, while map bias belongs to physical sides.  Preserve
// the side assignment for each completed round so a BO3 round-two swap does
// not get accidentally counted as a team-number advantage.
export function summarizeSideBalance(matches, {
  minDecisiveRounds = 4,
  severeWinRate = 0.75,
} = {}) {
  const sideWins = { east: 0, west: 0 };
  let completedRounds = 0;
  let completedBo3 = 0;
  let observedRoundTwoSwaps = 0;
  let expectedRoundTwoSwaps = 0;

  for (const match of Array.isArray(matches) ? matches : []) {
    const rounds = [...(Array.isArray(match?.rounds) ? match.rounds : [])]
      .sort((a, b) => (a.round || 0) - (b.round || 0));
    if (match?.matchWinner === 0 || match?.matchWinner === 1) completedBo3++;
    for (const round of rounds) {
      if (!validSides(round?.sides) || (round.winner !== 0 && round.winner !== 1)) continue;
      sideWins[round.sides[round.winner]]++;
      completedRounds++;
    }
    const first = rounds.find(round => round.round === 1 && validSides(round.sides));
    const second = rounds.find(round => round.round === 2 && validSides(round.sides));
    if (first && second) {
      expectedRoundTwoSwaps++;
      if (first.sides[0] === second.sides[1] && first.sides[1] === second.sides[0]) {
        observedRoundTwoSwaps++;
      }
    }
  }

  const decisiveRounds = sideWins.east + sideWins.west;
  const eastWinRate = decisiveRounds ? sideWins.east / decisiveRounds : null;
  const westWinRate = decisiveRounds ? sideWins.west / decisiveRounds : null;
  const dominantWinRate = Math.max(eastWinRate || 0, westWinRate || 0);
  const severeBiasDetected = decisiveRounds >= minDecisiveRounds && dominantWinRate >= severeWinRate;
  const verdict = decisiveRounds < minDecisiveRounds
    ? 'insufficient_decisive_rounds'
    : severeBiasDetected
      ? 'severe_side_bias_detected'
      : 'no_severe_side_bias_detected';

  return {
    bo3Matches: Array.isArray(matches) ? matches.length : 0,
    completedBo3,
    completedRounds,
    decisiveRounds,
    sideWins,
    eastWinRate,
    westWinRate,
    roundTwoSwap: {
      expected: expectedRoundTwoSwaps,
      observed: observedRoundTwoSwaps,
      rate: expectedRoundTwoSwaps ? observedRoundTwoSwaps / expectedRoundTwoSwaps : null,
    },
    severeBiasDetected,
    verdict,
  };
}
