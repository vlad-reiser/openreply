/**
 * Optional "card" block at the end of a campaign's reveal message. Lets a
 * campaign deliver its link as an Instagram generic template (image, title,
 * subtitle, button) instead of a raw URL, without a schema change:
 *
 *   Varsågod! 🙌
 *   [kort]
 *   bild: https://example.com/og.png
 *   rubrik: Ta reda på din möjlighet
 *   text: Gratis · under 60 sekunder
 *   knapp: Starta analysen
 *   länk: https://example.com/?utm_source=instagram
 */
export type MessageCard = {
  imageUrl: string;
  title: string;
  subtitle?: string;
  buttonTitle: string;
  url: string;
};

const MARKER = /^\s*\[kort\]\s*$/im;
const KEYS: Record<string, keyof MessageCard> = {
  bild: "imageUrl",
  rubrik: "title",
  text: "subtitle",
  knapp: "buttonTitle",
  "länk": "url",
  lank: "url",
};

export function parseCard(message: string): { text: string; card: MessageCard | null } {
  const match = MARKER.exec(message);
  if (!match) return { text: message, card: null };
  const text = message.slice(0, match.index).trim();
  const fields: Partial<MessageCard> = {};
  for (const line of message.slice(match.index + match[0].length).split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 1) continue;
    const key = KEYS[line.slice(0, sep).trim().toLowerCase()];
    const value = line.slice(sep + 1).trim();
    if (key && value) fields[key] = value;
  }
  const { imageUrl, title, url } = fields;
  if (!imageUrl || !title || !url || !/^https:\/\//.test(url) || !/^https:\/\//.test(imageUrl)) {
    return { text: fields.url ? `${text}\n\n${fields.url}`.trim() : text, card: null };
  }
  return {
    text,
    card: { imageUrl, title, url, subtitle: fields.subtitle, buttonTitle: fields.buttonTitle || "Öppna" },
  };
}

/** Plain-text form of a message with a card block: the text, then the bare URL. */
export function flattenCard(message: string): string {
  const { text, card } = parseCard(message);
  return card ? `${text}\n\n${card.url}`.trim() : text;
}
