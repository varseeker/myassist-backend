/**
 * Normalize Indonesian / international phone numbers to WhatsApp JID user part.
 * Examples: 0812... -> 62812..., +62 812 -> 62812
 */
export function normalizePhoneNumber(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  let normalized = digits;
  if (normalized.startsWith('0')) {
    normalized = `62${normalized.slice(1)}`;
  } else if (normalized.startsWith('8') && normalized.length >= 9) {
    normalized = `62${normalized}`;
  }

  if (normalized.length < 10 || normalized.length > 15) {
    return null;
  }

  return normalized;
}

export function toWhatsAppJid(phoneNumber: string): string | null {
  const normalized = normalizePhoneNumber(phoneNumber);
  return normalized ? `${normalized}@s.whatsapp.net` : null;
}

export function formatOutboundText(title: string, body: string, link?: string): string {
  const parts = [`*MyAssist*`, title, body];
  if (link) {
    parts.push(link);
  }
  return parts.filter(Boolean).join('\n');
}

export function createTelegramLinkToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
