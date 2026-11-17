import { fileURLToPath } from "node:url";

/** Raiz do repositório Meraki (pasta que contém motor/, web/, plataforma/ e exemplos/). */
export const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));

export const VERSAO_MOTOR = "0.1.0";
