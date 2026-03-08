import { Particle, StrategyType } from "./types";

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
    template = pick(BETRAYAL_RESPONSES[self.strategy]);
  } else {
    template = pick(TEMPLATES[self.strategy]);
  }

  return template.replace(/\{opponent\}/g, opponent.id);
}
