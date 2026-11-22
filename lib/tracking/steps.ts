/**
 * Optional follow-up sequence in a campaign's follow-up message. Lets a
 * campaign send several timed messages after the reveal, without a schema
 * change. Each step starts with a `[steg]` line, then settings, then the text
 * (which may end with a `[kort]` card block):
 *
 *   [steg]
 *   efter: 60                  minutes after the previous message
 *   tyst: 22-07                never send between these hours (local time)
 *   hoppa-om: <campaignId> 90  skip if this person used that campaign in 90 days
 *   ja-knapp: Ja!              send the text with a button ...
 *   Vill du ha analysen?
 *   [svar]                     ... and send this when the button is tapped
 *   Varsågod!
 *
 * A follow-up message without `[steg]` is the plain single follow-up.
 */
export type QuietHours = { from: number; to: number };

export type FollowUpStep = {
  delayMinutes: number;
  quiet: QuietHours | null;
  skipIf: { automationIds: string[]; days: number } | null;
  buttonTitle: string | null;
  message: string;
  reply: string | null;
};

const STEP_LINE = /^\s*\[steg\]\s*$/i;
const REPLY_LINE = /^\s*\[svar\]\s*$/i;
const HEADER = /^\s*(efter|tyst|hoppa-om|ja-knapp)\s*:\s*(.+?)\s*$/i;

export const QUIET_HOURS_TZ = process.env.QUIET_HOURS_TZ || "Europe/Stockholm";

function parseDelay(value: string): number {
  const match = /^(\d+(?:[.,]\d+)?)\s*(min|m|h|tim|timmar)?/i.exec(value);
  if (!match) return 0;
  const amount = Number(match[1].replace(",", "."));
  const hours = /^(h|tim)/i.test(match[2] ?? "");
  return Math.max(0, Math.round(hours ? amount * 60 : amount));
}

function parseQuiet(value: string): QuietHours | null {
  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(value);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from > 23 || to > 23 || from === to) return null;
  return { from, to };
}

function parseSkip(value: string): FollowUpStep["skipIf"] {
  const parts = value.split(/[\s,]+/).filter(Boolean);
  const days = Number(parts[parts.length - 1]);
  const ids = parts.slice(0, -1);
  if (!Number.isFinite(days) || days <= 0 || ids.length === 0) return null;
  return { automationIds: ids, days };
}

export function parseSteps(message: string | null | undefined): FollowUpStep[] | null {
  if (!message) return null;
  const lines = message.split(/\r?\n/);
  if (!lines.some((line) => STEP_LINE.test(line))) return null;

  const blocks: string[][] = [];
  for (const line of lines) {
    if (STEP_LINE.test(line)) blocks.push([]);
    else if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }

  const steps: FollowUpStep[] = [];
  for (const block of blocks) {
    const step: FollowUpStep = {
      delayMinutes: 0,
      quiet: null,
      skipIf: null,
      buttonTitle: null,
      message: "",
      reply: null,
    };
    let i = 0;
    for (; i < block.length; i++) {
      if (!block[i].trim()) continue;
      const header = HEADER.exec(block[i]);
      if (!header) break;
      const key = header[1].toLowerCase();
      if (key === "efter") step.delayMinutes = parseDelay(header[2]);
      else if (key === "tyst") step.quiet = parseQuiet(header[2]);
      else if (key === "hoppa-om") step.skipIf = parseSkip(header[2]);
      else step.buttonTitle = header[2].slice(0, 20);
    }
    const body = block.slice(i);
    const replyAt = body.findIndex((line) => REPLY_LINE.test(line));
    step.message = (replyAt < 0 ? body : body.slice(0, replyAt)).join("\n").trim();
    step.reply = replyAt < 0 ? null : body.slice(replyAt + 1).join("\n").trim() || null;
    // A button with nothing to send on tap would be a dead end.
    if (!step.reply) step.buttonTitle = null;
    if (!step.buttonTitle) step.reply = null;
    if (step.message) steps.push(step);
  }
  return steps;
}

function minuteOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Milliseconds until `at` is outside the quiet hours; 0 when it already is. */
export function msUntilAllowed(
  at: Date,
  quiet: QuietHours | null,
  timeZone: string = QUIET_HOURS_TZ
): number {
  if (!quiet) return 0;
  const now = minuteOfDay(at, timeZone);
  const from = quiet.from * 60;
  const to = quiet.to * 60;
  const inside = from < to ? now >= from && now < to : now >= from || now < to;
  if (!inside) return 0;
  return ((to - now + 1440) % 1440) * 60_000;
}

/**
 * How long to wait before sending a step, counted from `now`: its own delay,
 * pushed past the quiet hours when it would land inside them. `spreadMs` is
 * added only then, so a night's worth of messages does not all go out on the
 * same minute.
 */
export function stepDelayMs(
  step: Pick<FollowUpStep, "delayMinutes" | "quiet">,
  now: Date,
  spreadMs = 0,
  timeZone: string = QUIET_HOURS_TZ
): number {
  const base = step.delayMinutes * 60_000;
  const wait = msUntilAllowed(new Date(now.getTime() + base), step.quiet, timeZone);
  return wait > 0 ? base + wait + spreadMs : base;
}
