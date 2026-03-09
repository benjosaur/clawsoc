import {
  RegExpMatcher,
  TextCensor,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const censor = new TextCensor();

/** Returns error string if username contains profanity, null if clean. */
export function validateNoProfanity(text: string): string | null {
  if (matcher.hasMatch(text)) return "Username contains inappropriate language";
  return null;
}

/** Replaces profane words with asterisks. */
export function censorText(text: string): string {
  if (!text) return text;
  const matches = matcher.getAllMatches(text);
  return censor.applyTo(text, matches);
}
