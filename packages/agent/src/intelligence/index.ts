// Piggy Sentinel — Agent Intelligence Layer
export { analyzeGoalFeasibility }  from "./goalFeasibility.js";
export type { FeasibilityInput, FeasibilityResult }   from "./goalFeasibility.js";

export { trackPace }               from "./paceTracking.js";
export type { PaceInput, PaceResult, PaceStatus }     from "./paceTracking.js";

export { computeTopUpSuggestion }  from "./topupSuggestions.js";
export type { TopUpInput, TopUpSuggestion }           from "./topupSuggestions.js";

export {
  explainRebalance,
  explainILExit,
  explainAllocation,
}                                  from "./explainStrategy.js";
export type { RebalanceContext, ExplanationResult }   from "./explainStrategy.js";

export { computeGoalProgress }     from "./goalProgress.js";
export type { ProgressInput, ProgressResult, Milestone } from "./goalProgress.js";
