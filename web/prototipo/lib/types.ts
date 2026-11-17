export type Status = "ok" | "warn" | "serious" | "crit" | "maint";
export type ProjectId = "atlas" | "orion" | "nimbus" | "vega" | "lumen";

export const STATUS_RANK: Record<Status, number> = { ok: 0, maint: 1, warn: 2, serious: 3, crit: 4 };

export function worstStatus(list: Status[]): Status {
  return list.reduce<Status>((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), "ok");
}
