import { NextResponse } from "next/server";
import { listarContatos } from "../../../src/lib/queries";

export async function GET(request: Request) {
  const tenant = new URL(request.url).searchParams.get("tenant") ?? "";
  return NextResponse.json(await listarContatos(tenant));
}
