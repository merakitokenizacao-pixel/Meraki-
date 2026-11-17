import { NextResponse } from "next/server";
import { supabase } from "../../../src/lib/supabase";
import { reenviar, type Envio } from "../../../src/lib/queries";

export async function POST(request: Request) {
  const { data: sessao } = await supabase.auth.getUser();
  if (!sessao.user) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const envio = (await request.json()) as Envio;
  const { error } = await reenviar(envio);
  return error ? NextResponse.json({ erro: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
