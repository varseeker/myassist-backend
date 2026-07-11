const MENTION_EMAIL_REGEX =
  /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export function extractMentionEmails(content: string): string[] {
  const matches = content.matchAll(MENTION_EMAIL_REGEX);
  const emails = new Set<string>();

  for (const match of matches) {
    emails.add(match[1].toLowerCase());
  }

  return [...emails];
}
