const MENTION_USERNAME_REGEX = /@([a-zA-Z0-9._]+)/g;

/**
 * Extract @username mentions. Usernames follow login rules: letters, digits, `.`, `_`.
 */
export function extractMentionUsernames(content: string): string[] {
  const matches = content.matchAll(MENTION_USERNAME_REGEX);
  const usernames = new Set<string>();

  for (const match of matches) {
    const username = match[1];
    const end = (match.index ?? 0) + match[0].length;
    // Skip if this looks like the local part of an email (@local@domain)
    if (content[end] === '@') {
      continue;
    }
    usernames.add(username.toLowerCase());
  }

  return [...usernames];
}
