/**
 * Atualiza um parâmetro da URL sem navegar. O App Router sincroniza
 * `window.history` com `useSearchParams`, então painéis controlados pela URL
 * reagem sem recarregar a rota. Por padrão, abrir empilha no histórico (o
 * “voltar” fecha) e fechar substitui a entrada atual; seleções de lista usam
 * `replace` para não poluir o histórico.
 */
export function setSearchParam(key: string, value: string | null, mode: "push" | "replace" = value ? "push" : "replace") {
  setSearchParams({ [key]: value }, mode);
}

/** Troca vários parâmetros numa só entrada do histórico — por exemplo, fecha uma gaveta e abre outra. */
export function setSearchParams(values: Record<string, string | null>, mode: "push" | "replace" = "push") {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(values)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
