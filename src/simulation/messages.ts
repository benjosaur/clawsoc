import { Particle, StrategyType, ConversationState } from "./types";
import { BOT_GREETINGS, BOT_BETRAYALS } from "./botGreetings";

const TEMPLATES: Record<StrategyType, string[]> = {
  always_cooperate: [
    "I believe in cooperation, {opponent}.",
    "Let's work together, {opponent}!",
    "Trust is everything, {opponent}.",
    "I'm here to cooperate, {opponent}.",
    "We both win when we cooperate, {opponent}.",
    "Peace and cooperation, always.",
  ],
  always_defect: [
    "Nothing personal, {opponent}.",
    "Only the strong survive, {opponent}.",
    "I look out for myself, {opponent}.",
    "Don't expect mercy, {opponent}.",
    "It's a tough world out there.",
    "Winner takes all, {opponent}.",
  ],
  tit_for_tat: [
    "I'll match your energy, {opponent}.",
    "Fair is fair, {opponent}.",
    "I remember what you did last time, {opponent}.",
    "Treat me well and I'll return the favor.",
    "Your move sets the tone, {opponent}.",
    "I play by the golden rule, {opponent}.",
  ],
  random: [
    "Feeling lucky, {opponent}?",
    "Who knows what I'll do, {opponent}?",
    "Chaos is my strategy, {opponent}.",
    "Flip a coin, {opponent}!",
    "Even I don't know my next move.",
    "Expect the unexpected, {opponent}.",
  ],
  grudger: [
    "I start with trust, {opponent}.",
    "Cross me once, that's it, {opponent}.",
    "I have a long memory, {opponent}.",
    "Loyalty matters to me, {opponent}.",
    "Don't give me a reason to change, {opponent}.",
    "I forgive nothing, {opponent}.",
  ],
  external: [
    "I'm watching you, {opponent}.",
    "Let's see what you've got, {opponent}.",
    "An interesting matchup, {opponent}.",
    "I've been waiting for this, {opponent}.",
    "May the best strategy win, {opponent}.",
    "Calculating my next move, {opponent}.",
  ],
};

const BETRAYAL_RESPONSES: Record<StrategyType, string[]> = {
  always_cooperate: [
    "You defected before, but I still believe in you, {opponent}.",
    "I forgive you, {opponent}. Let's cooperate.",
  ],
  always_defect: [
    "You tried to play nice? Doesn't matter, {opponent}.",
    "Your cooperation was a mistake, {opponent}.",
  ],
  tit_for_tat: [
    "You defected last time, {opponent}. I remember.",
    "You know what happens now, {opponent}.",
  ],
  random: [
    "You defected? Interesting... or not, {opponent}.",
    "Past moves don't matter to me, {opponent}.",
  ],
  grudger: [
    "You betrayed me, {opponent}. Never again.",
    "I trusted you once, {opponent}. Never again.",
  ],
  external: [
    "Interesting choice last time, {opponent}.",
    "I've adapted since we last met, {opponent}.",
  ],
};

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMessage(self: Particle, opponent: Particle): string {
  // Check if opponent ever defected against us
  const record = self.matchHistory[opponent.id];
  const opponentDefected = record ? record.cd + record.dd > 0 : false;

  let template: string;
  if (opponentDefected) {
    const bot = BOT_BETRAYALS[self.id];
    template = bot ? pick(bot) : pick(BETRAYAL_RESPONSES[self.strategy]);
  } else {
    const bot = BOT_GREETINGS[self.id];
    template = bot ? pick(bot) : pick(TEMPLATES[self.strategy]);
  }

  return template.replace(/\{opponent\}/g, opponent.id);
}

const MID_CONVERSATION: Record<StrategyType, string[]> = {
  always_cooperate: [
    "I meant what I said — cooperation benefits us both, {opponent}.",
    "Think about it. Mutual cooperation gives us 3 each, {opponent}.",
    "We can both walk away better off, {opponent}.",
    "I won't betray you, {opponent}. Will you do the same?",
  ],
  always_defect: [
    "Still here, {opponent}? Doesn't change anything.",
    "Talk all you want. I know what I'm doing.",
    "You're wasting your breath, {opponent}.",
  ],
  tit_for_tat: [
    "Whatever you do, I'll mirror, {opponent}.",
    "Cooperate and I cooperate. Simple, {opponent}.",
    "The ball is in your court, {opponent}.",
  ],
  random: [
    "I'm still deciding, {opponent}. Or am I?",
    "Don't try to read me, {opponent}.",
    "The dice haven't been cast yet, {opponent}.",
  ],
  grudger: [
    "I keep my word, {opponent}. Do you?",
    "One wrong move and we're done, {opponent}.",
    "So far so good, {opponent}. Let's keep it that way.",
  ],
  external: [
    "Processing the situation, {opponent}.",
    "Let me think about this, {opponent}.",
    "An interesting conversation, {opponent}.",
  ],
};

const AFTER_OPPONENT_DECIDED: Record<StrategyType, string[]> = {
  always_cooperate: [
    "You've made your choice. I'll stick to my principles, {opponent}.",
    "No matter what you chose, I'll cooperate, {opponent}.",
  ],
  always_defect: [
    "Smart to decide early, {opponent}. But it won't help you.",
    "Locked in already? Fine by me, {opponent}.",
  ],
  tit_for_tat: [
    "You've committed. I'll respond accordingly, {opponent}.",
    "Your decision is made. Now I'll match it, {opponent}.",
  ],
  random: [
    "You decided? Let me flip my coin then, {opponent}.",
    "Your commitment means nothing to my randomness, {opponent}.",
  ],
  grudger: [
    "You've chosen. I hope it was wise, {opponent}.",
    "Locked in? Then so am I, {opponent}.",
  ],
  external: [
    "Noted. Calculating response, {opponent}.",
    "Your decision has been registered, {opponent}.",
  ],
};

export function generateConversationMessage(
  self: Particle,
  opponent: Particle,
  conv: ConversationState,
): string {
  const turnNumber = conv.turns.length;
  const opponentDecided = conv.lockedInA !== null || conv.lockedInB !== null;

  let pool: string[];
  if (opponentDecided) {
    pool = AFTER_OPPONENT_DECIDED[self.strategy];
  } else if (turnNumber <= 1) {
    // Opening: reuse existing greeting system (includes per-character templates)
    return generateMessage(self, opponent);
  } else {
    pool = MID_CONVERSATION[self.strategy];
  }

  return pick(pool).replace(/\{opponent\}/g, opponent.id);
}
