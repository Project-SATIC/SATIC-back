/** Modelo de grade em aulas de 50 min (src/shared/grade.ts). */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
    AULAS_POR_TURNO, RELOGIO_AULAS, aulasDoHorario, blocosDoHorario, contarAulas, formatoDoHorario,
    montarHorarioSigaa, turnosPermitidos, verificarFormatoHorario,
} from "../src/shared/grade.ts";
import { expandirParaSlotsAtomicos } from "../src/shared/horario-sigaa.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { diagnosticarViolacoes } from "../src/shared/validador.ts";
import { disciplina, sala, turma } from "./helpers.ts";

describe("Grade em aulas de 50 minutos", () => {
    test("relógio: 6 aulas de manhã e de tarde, 4 à noite, todas de 50 min", () => {
        assert.deepEqual(AULAS_POR_TURNO, { M: 6, T: 6, N: 4 });
        assert.equal(RELOGIO_AULAS.length, 16);
        const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
        for (const a of RELOGIO_AULAS) assert.equal(minutos(a.fim) - minutos(a.inicio), 50, a.id);
        assert.deepEqual(RELOGIO_AULAS.filter((a) => a.turno === "N").map((a) => `${a.inicio}-${a.fim}`),
            ["19:00-19:50", "19:50-20:40", "20:50-21:40", "21:40-22:30"]);
    });

    test("montarHorarioSigaa devolve as mesmas aulas para os 95 horários reais", () => {
        for (const t of carregarBase2026_2().turmas) {
            const aulas = expandirParaSlotsAtomicos(t.horarioSigaa);
            const montado = montarHorarioSigaa(aulas);
            assert.deepEqual(new Set(expandirParaSlotsAtomicos(montado)), new Set(aulas), `${t.horarioSigaa} -> ${montado}`);
        }
    });

    test("montarHorarioSigaa agrupa dias com o mesmo bloco e ordena", () => {
        assert.equal(montarHorarioSigaa(["QUI-M4", "TER-M3", "QUI-M3", "TER-M4"]), "35M34");
        assert.equal(montarHorarioSigaa(["SEX-T1", "SEG-T5", "SEX-T2", "SEG-T6"]), "2T56 6T12");
        assert.equal(montarHorarioSigaa(["SEX-M3", "SEX-M4", "SEX-M5", "SEX-M6"]), "6M3456");
        assert.equal(montarHorarioSigaa(["QUA-N1", "QUA-N2", "QUA-N3", "QUA-N4"]), "4N1234");
        assert.equal(montarHorarioSigaa(["SAB-M4", "SAB-M5"]), "7M45");
        assert.equal(montarHorarioSigaa([]), "");
    });

    test("blocos e formato", () => {
        assert.deepEqual(blocosDoHorario("2T56 6T12").map((b) => `${b.dia}-${b.turno}${b.inicio}..${b.fim}`), ["SEG-T5..6", "SEX-T1..2"]);
        assert.deepEqual(formatoDoHorario("35M34"), [2, 2]);
        assert.deepEqual(formatoDoHorario("5M12 6M3456"), [4, 2]);
        assert.deepEqual(formatoDoHorario("2345M3456"), [4, 4, 4, 4]);
        assert.equal(contarAulas("2345M3456"), 16);
        assert.equal(contarAulas(""), 0);
        assert.deepEqual(aulasDoHorario(""), []);
    });

    test("turnos por curso: CC/EC manhã e tarde, IA noite, conjunta CC+EC manhã e tarde", () => {
        assert.deepEqual(turnosPermitidos({ cursosOfertados: "CC" }), ["M", "T"]);
        assert.deepEqual(turnosPermitidos({ cursosOfertados: "CC, EC" }), ["M", "T"]);
        assert.deepEqual(turnosPermitidos({ cursosOfertados: "IA" }), ["N"]);
        assert.deepEqual(turnosPermitidos({ cursosOfertados: "XYZ" }), ["M", "T", "N"]);
    });

    test("regras de formato: nº de aulas, um bloco por dia e turno do curso", () => {
        const cc = { cursosOfertados: "CC", aulasSemanais: 4 };
        assert.deepEqual(verificarFormatoHorario(cc, "35M34"), []);
        assert.deepEqual(verificarFormatoHorario(cc, "6M3456"), [], "4 aulas num dia só é um bloco válido");
        assert.deepEqual(verificarFormatoHorario(cc, "35M3").map((p) => p.regra), ["FORMATO"], "perdeu aulas");
        assert.deepEqual(verificarFormatoHorario(cc, "3M24 5M34").map((p) => p.regra), ["FORMATO"], "buraco na terça");
        assert.deepEqual(verificarFormatoHorario(cc, "3M12 3T12").map((p) => p.regra), ["FORMATO"], "dois turnos no mesmo dia");
        assert.deepEqual(verificarFormatoHorario(cc, "35N12").map((p) => p.regra), ["TURNO"], "CC à noite");
        assert.deepEqual(verificarFormatoHorario({ cursosOfertados: "IA", aulasSemanais: 4 }, "35M34").map((p) => p.regra), ["TURNO"]);
        assert.deepEqual(verificarFormatoHorario({ cursosOfertados: "IA", aulasSemanais: 4 }, "4N1234"), []);
        assert.deepEqual(verificarFormatoHorario(cc, ""), [], "sem horário: é pendência, não erro de formato");
        assert.deepEqual(verificarFormatoHorario({ cursosOfertados: "CC" }, "35M3"), [], "sem aulasSemanais cadastrado, não cobra a contagem");
    });

    test("a oferta real 2026.2 já cumpre o formato (com IART tratada como IA)", () => {
        for (const t of carregarBase2026_2().turmas) {
            const cursos = t.disciplina.codigo.startsWith("IART") ? "IA" : t.cursosOfertados;
            const problemas = verificarFormatoHorario({ cursosOfertados: cursos, aulasSemanais: contarAulas(t.horarioSigaa) }, t.horarioSigaa);
            assert.deepEqual(problemas, [], `${t.disciplina.codigo}-${t.codigoTurma} ${t.horarioSigaa}`);
        }
    });

    test("diagnosticarViolacoes inclui FORMATO e TURNO ao validar um movimento", () => {
        const t = turma(1, disciplina("COMP1", "X", 60, false), "01", "2026.2", "CC", "35M34", 30, 30, true);
        t.aulasSemanais = 4;
        const s = sala(1, "Sala 02 IC", 60, "Sala", "IC", true);
        assert.deepEqual(diagnosticarViolacoes(t, s, [], "35M34"), []);
        // 4 aulas, um bloco por dia, mas a quinta cai à noite (CC não tem aula à noite)
        assert.deepEqual(diagnosticarViolacoes(t, s, [], "3M34 5N12").map((v) => v.regra), ["TURNO"]);
        assert.deepEqual(diagnosticarViolacoes(t, s, [], "3M34").map((v) => v.regra), ["FORMATO"]);
    });
});
