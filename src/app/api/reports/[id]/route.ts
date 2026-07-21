import { NextRequest, NextResponse } from "next/server";
import { readReport, listReports } from "@/lib/localStore";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = readReport(id);
  if (!data) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  return NextResponse.json({ ...data, history: listReports(10) });
}
