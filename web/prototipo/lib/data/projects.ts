import type { ProjectId } from "../types";

export type Project = {
  id: ProjectId;
  name: string;
  area: string;
  description: string;
  /** cor categórica fixa — a cor segue o projeto, nunca a posição */
  color: string;
  squad: string;
  lead: string;
  health: number;
  healthDelta: number;
};

export const PROJECTS: Project[] = [
  {
    id: "atlas",
    name: "Atlas",
    area: "Atendimento",
    description: "Plataforma de atendimento omnichannel — chat, WhatsApp e voz",
    color: "var(--color-s1)",
    squad: "Squad Atendimento",
    lead: "Marina Costa",
    health: 68,
    healthDelta: -14,
  },
  {
    id: "orion",
    name: "Orion",
    area: "Crédito",
    description: "Motor de crédito, análise de risco e cobrança",
    color: "var(--color-s2)",
    squad: "Squad Crédito",
    lead: "Rafael Nunes",
    health: 92,
    healthDelta: -2,
  },
  {
    id: "nimbus",
    name: "Nimbus",
    area: "Dados",
    description: "Plataforma de dados, ingestão e analytics",
    color: "var(--color-s3)",
    squad: "Squad Dados",
    lead: "Diego Alves",
    health: 83,
    healthDelta: -6,
  },
  {
    id: "vega",
    name: "Vega",
    area: "E-commerce",
    description: "Loja, carrinho, busca e checkout",
    color: "var(--color-s4)",
    squad: "Squad Commerce",
    lead: "Beatriz Lima",
    health: 86,
    healthDelta: -5,
  },
  {
    id: "lumen",
    name: "Lumen",
    area: "Interno",
    description: "Ferramentas internas, base de conhecimento e inferência própria",
    color: "var(--color-s5)",
    squad: "Squad Plataforma",
    lead: "Ana Ribeiro",
    health: 90,
    healthDelta: 1,
  },
];

export const projectById = (id: string) => PROJECTS.find((p) => p.id === id);
