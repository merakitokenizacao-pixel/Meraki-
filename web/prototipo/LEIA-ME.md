# Protótipo visual (estacionado)

Telas da primeira versão visual do Meraki: métricas de infraestrutura (CPU, latência, custo),
qualidade de agentes de IA (precisão, resolução, alucinação), incidentes, explorador e Copilot.
Todos os dados aqui são fictícios (`lib/data`).

A Fase 1 (motor de estrutura) não produz esses dados, então essas telas saíram da navegação e do build
(`tsconfig.json` e `eslint.config.mjs` ignoram esta pasta). Os arquivos ficam como referência de design
para a fase que trouxer métricas de operação e de agentes.

Cópias de referência: `components/shell/*` e `components/ui/misc.tsx`, `components/charts/flow-diagram.tsx`
e `lib/types.ts` estão aqui na versão do protótipo; as versões em `src/` foram adaptadas à plataforma real.
