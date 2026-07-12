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

export function formatOutboundText(
  title: string,
  body: string,
  link?: string,
): string {
  const parts = [
    '*MyAssist — Notifikasi Tiket*',
    '',
    `📌 ${title}`,
    body,
  ];

  if (link) {
    parts.push('', `🔗 Buka tiket: ${link}`);
  }

  parts.push('', '_Pesan otomatis dari MyAssist. Jangan balas ke chat ini._');
  return parts.filter((line) => line !== undefined).join('\n');
}

export function formatTelegramHtml(
  title: string,
  body: string,
  link?: string,
): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const parts = [
    '<b>MyAssist — Notifikasi Tiket</b>',
    '',
    `📌 <b>${escape(title)}</b>`,
    escape(body),
  ];

  if (link) {
    parts.push('', `🔗 <a href="${escape(link)}">Buka tiket di MyAssist</a>`);
  }

  parts.push('', '<i>Pesan otomatis dari MyAssist (Telegram + WhatsApp).</i>');
  return parts.join('\n');
}

export function createTelegramLinkToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
