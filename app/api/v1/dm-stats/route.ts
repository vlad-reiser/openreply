import { prisma } from "@/lib/db/client";
import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError, checkOrigin } from "@/lib/integrations/http";

// Read-only daily DM counts per keyword. No names, user ids or message text.
// GET /api/v1/dm-stats?days=30  (Authorization: Bearer <service key>)
type Row = { datum: string; nyckelord: string; utlosta: number; ja_tryck: number };

export async function GET(request: Request) {
  try {
    checkOrigin(request);
    const context = await authenticateService(request);
    requireScope(context, "campaigns:read");
    const raw = Number(new URL(request.url).searchParams.get("days") ?? "30");
    const days = Number.isInteger(raw) && raw >= 1 && raw <= 365 ? raw : 30;
    const data = await prisma.$queryRaw<Row[]>`
      select to_char((l."createdAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as datum,
             upper(coalesce(a.keywords[1], a.name)) as nyckelord,
             count(*) filter (where l."commentText" <> '(button tap)')::int as utlosta,
             count(*) filter (where l."commentText" = '(button tap)')::int as ja_tryck
      from "DmLog" l join "Automation" a on a.id = l."automationId"
      where l."workspaceId" = ${context.workspaceId}
        and l."createdAt" >= now() - make_interval(days => ${days})
      group by 1, 2 order by 1 desc, 2`;
    return Response.json({ data, tidszon: "Europe/Stockholm", dagar: days }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
