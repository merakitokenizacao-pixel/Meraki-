import { supabase, supabaseAdmin } from "./supabase";

export interface Envio {
  tenant_id: string;
  contato_id: string;
  canal: string;
  conteudo: string;
}

export async function listarContatos(tenant: string) {
  const { data, error } = await supabase
    .from("contatos")
    .select("id, nome, etiquetas")
    .eq("tenant_id", tenant)
    .order("nome")
    .range(0, 49);
  if (error) throw error;
  return data ?? [];
}

export async function etiquetasDoTenant(tenant: string) {
  const { data } = await supabase.from("etiquetas").select("id, nome, cor").eq("tenant_id", tenant).limit(100);
  return data ?? [];
}

export async function aplicarEtiqueta(tenant: string, contato: string, etiqueta: string) {
  return supabase.rpc("etiqueta_aplicar", { p_tenant: tenant, p_contato: contato, p_etiqueta: etiqueta });
}

export async function registrarEnvio(tenant: string, contato: string, conteudo: string) {
  return supabase.rpc("envio_registrar", { p_tenant: tenant, p_contato: contato, p_conteudo: conteudo });
}

/** Reenvio manual: grava direto em envios em vez de passar por envio_registrar. */
export async function reenviar(envio: Envio) {
  return supabaseAdmin.from("envios").insert({
    tenant_id: envio.tenant_id,
    contato_id: envio.contato_id,
    canal: envio.canal,
    conteudo: envio.conteudo,
  });
}

export async function historicoDeEnvios(tenant: string) {
  const { data } = await supabase.from("envios").select("id, canal, status, criado_em").eq("tenant_id", tenant);
  return data ?? [];
}
