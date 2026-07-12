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

export interface MessageLinks {
  appUrl?: string;
  ticketUrl?: string;
}

export function resolveMessageLinks(
  frontendUrl?: string | null,
  ticketId?: string,
): MessageLinks {
  const base = frontendUrl?.trim().replace(/\/$/, '');
  if (!base) {
    return {};
  }

  return {
    appUrl: base,
    ticketUrl: ticketId ? `${base}/tickets/${ticketId}` : undefined,
  };
}

export function formatOutboundText(
  title: string,
  body: string,
  links: MessageLinks = {},
): string {
  const parts = [
    '*MyAssist — Notifikasi Tiket*',
    '',
    `📌 ${title}`,
    body,
  ];

  if (links.ticketUrl) {
    parts.push('', `🔗 Buka tiket: ${links.ticketUrl}`);
  }

  if (links.appUrl) {
    parts.push('', `🌐 Web MyAssist: ${links.appUrl}`);
  }

  parts.push('', '_Pesan otomatis dari MyAssist. Jangan balas ke chat ini._');
  return parts.join('\n');
}

export function formatTelegramHtml(
  title: string,
  body: string,
  links: MessageLinks = {},
): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const parts = [
    '<b>MyAssist — Notifikasi Tiket</b>',
    '',
    `<b>${escape(title)}</b>`,
    escape(body),
  ];

  if (links.ticketUrl) {
    parts.push(
      '',
      `<a href="${escape(links.ticketUrl)}">Buka tiket di MyAssist</a>`,
    );
  }

  if (links.appUrl) {
    parts.push('', `<a href="${escape(links.appUrl)}">Buka web MyAssist</a>`);
  }

  parts.push('', '<i>Pesan otomatis dari MyAssist.</i>');
  return parts.join('\n');
}

export function createTelegramLinkToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
