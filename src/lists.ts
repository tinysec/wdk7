/**
 * uniqueStrings preserves first-seen order while removing case-insensitive
 * duplicates. URL lists and Windows paths both benefit from stable ordering,
 * because the first value is usually the most intentional one.
 */
export function uniqueStrings(values: string[]): string[] {
  const seen: Set<string> = new Set<string>();
  const result: string[] = [];

  // A manual loop keeps the order and comparison rule visible to future edits.
  for (const value of values) {
    const key: string = value.toLowerCase();

    if (false === seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}
