/**
 * Executa o motor sobre a base real 2026.2 e imprime o resumo em JSON
 * (mesmo formato de tools/GoldenDump.java, para comparação direta).
 *
 *   node tools/rodar-motor.ts [sem=<sala>] [indisp=<siape>:<dia>:<turno>:<idx>] > saida-ts.json
 */
import { executarCenario } from "./cenario.ts";

const { resultado, resumo } = executarCenario(process.argv.slice(2));

console.error(`[SATIC-TS] turmas=${resumo.turmas.length} alocadas=${resultado.alocacoes.length} `
    + `pendentes=${resultado.turmasPendentes.length} reservas=${resumo.reservas.length} completo=${resultado.completo} `
    + `nos=${resultado.nosVisitados} podas=${resultado.podas} tempo=${resultado.tempoMs}ms`);
console.log(JSON.stringify(resumo, null, 2));
