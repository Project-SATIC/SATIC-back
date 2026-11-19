/** Motor de sugestões (horário + sala) sobre a base real 2026.2 com conflitos provocados. */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { montarProblema } from "../src/motor/montar-problema.ts";
import { StateSpaceSearch } from "../src/motor/state-space-search.ts";
import { gerarHorariosCandidatos, sugerirResolucoes, type Sugestao } from "../src/motor/sugestoes.ts";
import { chaveTurma } from "../src/shared/tipos.ts";
import type { Alocacao } from "../src/shared/tipos.ts";
import { blocosDoHorario, contarAulas, formatoDoHorario, verificarFormatoHorario } from "../src/shared/grade.ts";
import { expandirParaSlotsAtomicos } from "../src/shared/horario-sigaa.ts";

/** Base 2026.2 alocada pelo motor de salas, como o banco fica depois do /gerar. */
function gradeReal() {
    const base = carregarBase2026_2();
    for (const t of base.turmas) {
        t.aulasSemanais = contarAulas(t.horarioSigaa);
        if (t.disciplina.codigo.startsWith("IART")) t.cursosOfertados = "IA";
    }
    const p = montarProblema(base);
    const r = new StateSpaceSearch(p.turmasParaAlocar, p.salasAlocaveis, p.reservasFixasExternas).solve();
    const alocacoes: Alocacao[] = [...p.reservasFixasExternas, ...r.alocacoes].map((a, i) => ({ ...a, id: i + 1 }));
    const porChave = (k: string) => {
        const a = alocacoes.find((x) => chaveTurma(x.turma) === k);
        assert.ok(a, k);
        return a;
    };
    return { base, salas: p.salasAlocaveis, alocacoes, porChave };
}

function aplicar(alocacoes: Alocacao[], s: Sugestao | null, salas: ReturnType<typeof gradeReal>["salas"]): Alocacao[] {
    if (!s) return alocacoes;
    return alocacoes.map((a) => {
        const m = s.mudancas.find((x) => x.turmaId === a.turma.id);
        return m ? { ...a, sala: salas.find((x) => x.id === m.para.salaId)!, horarioCodigo: m.para.horario } : a;
    });
}

describe("Motor de sugestões: horário + sala", () => {
    test("grade sem conflitos: nada a sugerir", () => {
        const { base, salas, alocacoes } = gradeReal();
        const r = sugerirResolucoes(base.turmas, salas, alocacoes);
        assert.deepEqual(r.conflitos, []);
        assert.equal(r.plano, null);
        assert.deepEqual(r.alvos, []);
    });

    test("choque de sala é resolvido só trocando sala (custo 1, horário intacto)", () => {
        const { base, salas, alocacoes } = gradeReal();
        // Duas turmas do IC que já acontecem em horários sobrepostos, em salas diferentes:
        // pôr a segunda na sala da primeira cria só choque de sala (nenhum horário muda)
        const rascunhos = alocacoes.filter((a) => a.status === "RASCUNHO");
        const sobrepoe = (x: Alocacao, y: Alocacao) => expandirParaSlotsAtomicos(x.horarioCodigo).some((s) => expandirParaSlotsAtomicos(y.horarioCodigo).includes(s));
        const [a, b] = (() => {
            for (const x of rascunhos) for (const y of rascunhos) {
                if (x !== y && x.sala.id !== y.sala.id && sobrepoe(x, y) && y.turma.matriculados <= x.sala.capacidade
                    && (!y.turma.disciplina.exigeLaboratorio || x.sala.tipoEspaco === "Laboratório")) return [x, y];
            }
            throw new Error("par não encontrado");
        })();
        b.sala = a.sala;
        const antes = sugerirResolucoes(base.turmas, salas, alocacoes);
        assert.ok(antes.conflitos.every((c) => c.violacoes.every((v) => v.regra === "SALA")), "só choque de sala");
        const r = antes;
        assert.ok(r.plano);
        assert.equal(r.plano.custo.mudancasDeHorario, 0);
        assert.equal(sugerirResolucoes(base.turmas, salas, aplicar(alocacoes, r.plano, salas)).conflitos.length, 0);
    });

    test("choque de docente muda o horário da turma menor e o plano zera os conflitos", () => {
        const { base, salas, alocacoes, porChave } = gradeReal();
        const comp382 = porChave("COMP382-01"); // 16 aulas, 4 docentes
        const docente = comp382.turma.professores[0].matriculaSiape;
        const pequena = alocacoes.find((a) => a !== comp382 && a.status === "RASCUNHO"
            && a.turma.professores.some((p) => p.matriculaSiape === docente))!;
        assert.ok(pequena, "outra turma do mesmo docente");
        pequena.horarioCodigo = "2M34 3M34"; // colide com COMP382 (2345M3456)
        pequena.turma.aulasSemanais = contarAulas(pequena.horarioCodigo);

        const r = sugerirResolucoes(base.turmas, salas, alocacoes);
        assert.ok(r.conflitos.some((c) => c.violacoes.some((v) => v.regra === "RN-01")));
        assert.ok(r.plano);
        assert.ok(!r.plano.mudancas.some((m) => m.turmaId === comp382.turma.id), "não mexe na turma de 16 aulas");
        assert.equal(sugerirResolucoes(base.turmas, salas, aplicar(alocacoes, r.plano, salas)).conflitos.length, 0);
        assert.deepEqual(r.naoResolvidos, []);
    });

    test("vários conflitos juntos: plano válido, sem tocar em DEFINITIVA nem EXTERNA_FIXA, e rápido", () => {
        const { base, salas, alocacoes, porChave } = gradeReal();
        const fixa = porChave("COMP373-02");
        fixa.status = "DEFINITIVA";
        // choque de sala com a confirmada + laboratório em sala teórica + choque de sala com reserva externa
        const invasora = porChave("COMP361-01");
        Object.assign(invasora, { sala: fixa.sala, horarioCodigo: fixa.horarioCodigo });
        invasora.turma.aulasSemanais = contarAulas(fixa.horarioCodigo);
        const lab = alocacoes.find((a) => a.turma.disciplina.exigeLaboratorio && a.status === "RASCUNHO" && a !== invasora)!;
        lab.sala = salas.find((s) => s.tipoEspaco === "Sala" && s.capacidade >= lab.turma.matriculados)!;
        const externa = porChave("IF0001-05");
        const vizinha = alocacoes.find((a) => a.status === "RASCUNHO" && a !== invasora && a !== lab
            && contarAulas(a.horarioCodigo) === contarAulas(externa.horarioCodigo) && a.turma.matriculados <= externa.sala.capacidade)!;
        Object.assign(vizinha, { sala: externa.sala, horarioCodigo: externa.horarioCodigo });

        const inicio = performance.now();
        const r = sugerirResolucoes(base.turmas, salas, alocacoes);
        assert.ok(performance.now() - inicio < 10_000, "abaixo de 10 s");
        assert.ok(r.conflitos.length >= 3);
        assert.ok(r.plano);
        const intocaveis = new Set([fixa.turma.id, externa.turma.id]);
        assert.ok(!r.plano.mudancas.some((m) => intocaveis.has(m.turmaId)), "confirmadas e externas ficam");
        assert.equal(sugerirResolucoes(base.turmas, salas, aplicar(alocacoes, r.plano, salas)).conflitos.length, 0);
        for (const m of r.plano.mudancas) {
            const t = base.turmas.find((x) => x.id === m.turmaId)!;
            assert.deepEqual(verificarFormatoHorario(t, m.para.horario), [], `formato respeitado em ${m.turma}`);
        }
    });

    test("alternativas por turma vêm ordenadas: trocar sala antes de mudar horário", () => {
        const { base, salas, alocacoes, porChave } = gradeReal();
        const a360 = porChave("COMP360-01");
        Object.assign(porChave("COMP361-01"), { sala: a360.sala, horarioCodigo: a360.horarioCodigo });
        const r = sugerirResolucoes(base.turmas, salas, alocacoes);
        for (const alts of Object.values(r.alternativasPorTurma)) {
            assert.ok(alts.length <= 3);
            const pontos = alts.map((s) => s.custo.pontos);
            assert.deepEqual(pontos, [...pontos].sort((x, y) => x - y));
        }
    });

    test("pendente sem docente ou sem horário não é inventado pelo motor", () => {
        const { base, salas, alocacoes } = gradeReal();
        const sem = alocacoes.find((a) => a.status === "RASCUNHO")!;
        const semDocente = base.turmas.find((t) => t.id === sem.turma.id)!;
        semDocente.professores = [];
        const lista = alocacoes.filter((a) => a !== sem);
        const r = sugerirResolucoes(base.turmas, salas, lista);
        assert.ok(r.pendentes.some((p) => p.turmaId === semDocente.id && p.motivo === "sem docente"));
        assert.ok(r.naoResolvidos.some((p) => p.turmaId === semDocente.id));
        assert.ok(!r.plano?.mudancas.some((m) => m.turmaId === semDocente.id));
    });
});

describe("Geração de horários candidatos", () => {
    const { base } = gradeReal();
    const turma = (k: string) => base.turmas.find((t) => chaveTurma(t) === k)!;

    test("mantém formato, nº de aulas, um bloco por dia e turnos do curso", () => {
        for (const k of ["COMP360-01", "COMP359-01", "ECOM036-01", "COMP382-01"]) {
            const t = turma(k);
            const cands = gerarHorariosCandidatos(t, t.horarioSigaa);
            assert.ok(cands.length > 0, k);
            for (const h of cands.slice(0, 300)) {
                assert.deepEqual(formatoDoHorario(h), formatoDoHorario(t.horarioSigaa), `${k}: ${h}`);
                assert.equal(expandirParaSlotsAtomicos(h).length, t.aulasSemanais);
                assert.deepEqual(verificarFormatoHorario(t, h), [], `${k}: ${h}`);
                assert.ok(blocosDoHorario(h).every((b) => b.turno !== "N" && b.dia !== "SAB"));
            }
            assert.ok(!cands.includes(t.horarioSigaa), "o horário atual não é candidato");
        }
    });

    test("o mais parecido vem primeiro (mesmos dias e turno antes de mudar tudo)", () => {
        const t = turma("COMP360-01"); // 24M34
        const primeiro = gerarHorariosCandidatos(t, "24M34")[0];
        const aulas = new Set(expandirParaSlotsAtomicos("24M34"));
        assert.ok(expandirParaSlotsAtomicos(primeiro).some((a) => aulas.has(a)), primeiro);
    });

    test("IA só recebe horários noturnos", () => {
        const t = turma("IART001-01");
        const cands = gerarHorariosCandidatos(t, t.horarioSigaa);
        assert.ok(cands.length > 0);
        assert.ok(cands.every((h) => blocosDoHorario(h).every((b) => b.turno === "N" && b.tamanho <= 4)));
    });

    test("permitir mudar formato abre mais opções (4 num dia, 2+2, 3+1, 1+1+1+1)", () => {
        const t = turma("COMP360-01");
        const mesmo = gerarHorariosCandidatos(t, "24M34");
        const livre = gerarHorariosCandidatos(t, "24M34", true);
        assert.ok(livre.length > mesmo.length);
        const formatos = new Set(livre.map((h) => formatoDoHorario(h).join("+")));
        for (const f of ["4", "2+2", "3+1", "1+1+1+1"]) assert.ok(formatos.has(f), f);
    });
});
