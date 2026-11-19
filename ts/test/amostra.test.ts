/** Amostra de 17 turmas reais para testes manuais (src/seed/amostra.ts). */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { AMOSTRA_2026_2, ofertasDaAmostra } from "../src/seed/amostra.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { montarProblema } from "../src/motor/montar-problema.ts";
import { StateSpaceSearch } from "../src/motor/state-space-search.ts";
import { sugerirResolucoes } from "../src/motor/sugestoes.ts";
import { chaveTurma } from "../src/shared/tipos.ts";
import { contarAulas, formatoDoHorario } from "../src/shared/grade.ts";

function baseDaAmostra() {
    const base = carregarBase2026_2(ofertasDaAmostra());
    for (const t of base.turmas) {
        t.aulasSemanais = contarAulas(t.horarioSigaa);
        if (t.disciplina.codigo.startsWith("IART")) t.cursosOfertados = "IA";
    }
    return base;
}

describe("Amostra para testes manuais", () => {
    test("as 17 turmas existem na oferta real, sem repetição", () => {
        const chaves = AMOSTRA_2026_2.map((t) => t.chave);
        assert.equal(chaves.length, 17);
        assert.equal(new Set(chaves).size, 17);
        const base = baseDaAmostra();
        assert.deepEqual(base.turmas.map(chaveTurma).sort(), [...chaves].sort(), "nenhuma chave com erro de digitação");
        assert.equal(base.salas.length, 19, "todas as salas continuam");
    });

    test("cobre as situações planejadas", () => {
        const base = baseDaAmostra();
        const t = (k: string) => base.turmas.find((x) => chaveTurma(x) === k)!;
        assert.equal(t("COMP382-01").professores.length, 4, "co-docência");
        assert.equal(t("ECOM013-01").professores.length, 2);
        assert.equal(t("COMP370-01").professores[0].matriculaSiape, t("COMP373-02").professores[0].matriculaSiape, "mesmo docente (RN-01)");
        assert.ok(t("COMP370-01").professores[0].nome.includes("RANILSON"), "docente com indisponibilidade no seed (RN-02)");
        assert.deepEqual(formatoDoHorario(t("COMP359-01").horarioSigaa), [4]);
        assert.equal(t("ECOM036-01").horarioSigaa, "2T56 6T12");
        assert.ok(t("COMP384-02").horarioSigaa.startsWith("7"), "sábado");
        assert.equal(t("CPT0035-01").cursosOfertados, "CC, EC");
        assert.ok(t("CPT0035-01").matriculados >= 70, "turma grande (RN-03)");
        assert.ok(t("IART001-01").horarioSigaa.includes("N"));
        assert.ok(t("COMP373-02").disciplina.exigeLaboratorio, "laboratório (RN-04)");
        const reservas = montarProblema(base).reservasFixasExternas.map((r) => `${chaveTurma(r.turma)}@${r.sala.nome}`).sort();
        assert.deepEqual(reservas, ["FALE0002-03@Auditório CEPETEC", "IF0001-05@Sala 207 BL12"]);
    });

    test("o motor aloca a amostra inteira e a grade sai sem conflitos", () => {
        const base = baseDaAmostra();
        const p = montarProblema(base);
        const r = new StateSpaceSearch(p.turmasParaAlocar, p.salasAlocaveis, p.reservasFixasExternas).solve();
        assert.equal(r.completo, true);
        assert.equal(r.alocacoes.length, 15);
        const s = sugerirResolucoes(base.turmas, p.salasAlocaveis, [...p.reservasFixasExternas, ...r.alocacoes]);
        assert.deepEqual(s.conflitos, []);
        assert.deepEqual(s.pendentes, []);
    });
});
