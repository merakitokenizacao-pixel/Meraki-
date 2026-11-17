export type Person = { id: string; name: string; role: string };

export const PEOPLE: Record<string, Person> = {
  marina: { id: "marina", name: "Marina Costa", role: "SRE" },
  lucas: { id: "lucas", name: "Lucas Prado", role: "Engenharia de IA" },
  ana: { id: "ana", name: "Ana Ribeiro", role: "Plataforma" },
  diego: { id: "diego", name: "Diego Alves", role: "Dados" },
  beatriz: { id: "beatriz", name: "Beatriz Lima", role: "Commerce" },
  rafael: { id: "rafael", name: "Rafael Nunes", role: "Crédito" },
};

export const ME = PEOPLE.ana;
