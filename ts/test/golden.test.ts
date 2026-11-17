/**
 * Equivalência com o motor Java: compara o resultado do porte TypeScript, campo a campo,
 * com gabaritos gerados por tools/GoldenDump.java na branch lg-back-dev.
 * Compara a ordem das alocações, salas escolhidas, pendências, nós visitados, podas e SIAPEs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { executarCenario } from "../tools/cenario.ts";

const CENARIOS: { arquivo: string; descricao: string; opcoes: string[] }[] = [
    { arquivo: "golden-java-2026-2.json", descricao: "base real 2026.2", opcoes: [] },
    { arquivo: "golden-java-sem-aud-ic.json", descricao: "sem Auditório IC (domínio vazio + recuperação parcial)", opcoes: ["sem=Auditório IC"] },
    { arquivo: "golden-java-indisp-ranilson.json", descricao: "indisponibilidade RN-02 com backtracking", opcoes: ["indisp=2024389:TER:T:34"] },
    { arquivo: "golden-java-combinado.json", descricao: "salas removidas + indisponibilidade", opcoes: ["sem=Sala 04 IC", "sem=Sala 207 BL12", "indisp=1930412:SEX:M:56"] },
    { arquivo: "golden-java-backtrack-39k.json", descricao: "backtracking profundo (39.700 nós)", opcoes: ["sem=Sala 03 IC", "sem=Sala 04 IC", "sem=Sala 206 BL12"] },
    { arquivo: "golden-java-limite-300k.json", descricao: "corte no limite de 300.000 nós", opcoes: ["sem=Sala 02 IC", "sem=Sala 03 IC", "sem=Sala 04 IC"] },
];

function lerGabarito(arquivo: string): unknown {
    return JSON.parse(readFileSync(new URL(`./fixtures/${arquivo}`, import.meta.url), "utf8"));
}

describe("Equivalência TS x Java (gabaritos do GoldenDump)", () => {
    for (const c of CENARIOS) {
        it(c.descricao, () => {
            assert.deepStrictEqual(executarCenario(c.opcoes).resumo, lerGabarito(c.arquivo));
        });
    }

    it("base real: 95 turmas únicas, 86 alocadas, 2 reservas EXTERNA_FIXA, sem pendências", () => {
        const { resumo } = executarCenario();
        assert.equal(resumo.turmas.length, 95);
        assert.equal(resumo.alocacoes.length, 86);
        assert.deepEqual(resumo.reservas, [
            { turma: "FALE0002-03", sala: "Auditório CEPETEC" },
            { turma: "IF0001-05", sala: "Sala 207 BL12" },
        ]);
        assert.equal(resumo.completo, true);
        assert.equal(resumo.turmas.find((t) => t.chave === "CPT0035-01")?.cursos, "CC, EC");
        assert.equal(resumo.turmas.find((t) => t.chave === "COMP382-01")?.siapes.length, 4);
    });
});
