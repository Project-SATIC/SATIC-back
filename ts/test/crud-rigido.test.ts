/**
 * Testes unitários e de contrato rígidos para fechar o escopo contra comportamentos inesperados:
 *  - Fronteiras e rejeição de entradas inválidas em `entrada.ts` e `canonicalizarHorarioIndisponivel`
 *  - Exclusão de salas em `"Manutenção"` no validador e nas 3 etapas do motor de sugestões
 *  - Priorização de janelas `"preferencial"` e flag `permitirMudarFormato` persistido na turma
 *  - Validação HTTP 400/404/409 em todos os endpoints CRUD e de publicação
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
    lerEstadoDisponibilidadeObrigatorio,
    lerInteiroObrigatorio,
    lerStatusSalaOpcional,
    lerTextoObrigatorio,
    lerVinculosDocentesOpcional,
} from "../src/entrada.ts";
import { canonicalizarHorarioIndisponivel } from "../src/db/repositories/professor.repository.ts";
import { diagnosticarViolacoes, isAlocacaoValida } from "../src/shared/validador.ts";
import { gerarHorariosCandidatos, sugerirResolucoes } from "../src/motor/sugestoes.ts";
import { criarApp } from "../src/api/app.ts";
import { disciplina, professor, sala, turma } from "./helpers.ts";

describe("Validação estrita de entradas e canonicalização de horários", () => {
    test("canonicalizarHorarioIndisponivel normaliza formatos válidos e ordena/deduplica índices", () => {
        assert.equal(canonicalizarHorarioIndisponivel("  sex:t:655 "), "SEX-T-56");
        assert.equal(canonicalizarHorarioIndisponivel("2m433"), "SEG-M-34");
        assert.equal(canonicalizarHorarioIndisponivel("4N412"), "QUA-N-124");
        assert.equal(canonicalizarHorarioIndisponivel("7-T-1"), "SAB-T-1");
    });

    test("canonicalizarHorarioIndisponivel rejeita entradas malformadas, múltiplos dias ou aulas fora do turno", () => {
        const invalidos = [
            "",
            "   ",
            "DOM-M-1",
            "1M12",
            "8T12",
            "24M12",       // múltiplos dias numa mesma janela individual
            "SEG-X-1",     // turno inexistente
            "SEG-M-0",     // aula 0
            "SEG-M-7",     // manhã só vai até 6
            "SEG-T-8",     // tarde só vai até 6
            "SEG-N-5",     // noite só vai até 4
            "4N12345",     // noite com aula 5
            "SEG-M-1A",    // caractere não numérico
            "SEG-M-",      // sem índice
        ];
        for (const h of invalidos) {
            assert.throws(
                () => canonicalizarHorarioIndisponivel(h),
                { name: "ErroRequisicao" },
                `Deveria rejeitar horário inválido: '${h}'`,
            );
        }
    });

    test("lerVinculosDocentesOpcional deduplica SIAPEs, valida limites de 20 chars e rejeita cargas negativas", () => {
        assert.equal(lerVinculosDocentesOpcional(undefined, "professores"), undefined);
        const lidos = lerVinculosDocentesOpcional(
            [" 2024389 ", { matriculaSiape: "2024389", cargaHoraria: 30 }, { matriculaSiape: "1849201", cargaHoraria: 60 }],
            "professores",
        );
        assert.deepEqual(lidos, [
            { matriculaSiape: "2024389" },
            { matriculaSiape: "1849201", cargaHoraria: 60 },
        ]);

        assert.throws(() => lerVinculosDocentesOpcional("2024389", "professores"), { name: "ErroRequisicao" });
        assert.throws(() => lerVinculosDocentesOpcional([""], "professores"), { name: "ErroRequisicao" });
        assert.throws(() => lerVinculosDocentesOpcional(["123456789012345678901"], "professores"), { name: "ErroRequisicao" });
        assert.throws(() => lerVinculosDocentesOpcional([{ matriculaSiape: "100", cargaHoraria: -1 }], "professores"), { name: "ErroRequisicao" });
        assert.throws(() => lerVinculosDocentesOpcional([123], "professores"), { name: "ErroRequisicao" });
    });

    test("lerStatusSalaOpcional, lerEstadoDisponibilidadeObrigatorio, lerTextoObrigatorio e lerInteiroObrigatorio", () => {
        assert.equal(lerStatusSalaOpcional(undefined), undefined);
        assert.equal(lerStatusSalaOpcional("Disponível"), "Disponível");
        assert.equal(lerStatusSalaOpcional("Manutenção"), "Manutenção");
        assert.throws(() => lerStatusSalaOpcional("Interditada"), { name: "ErroRequisicao" });

        assert.equal(lerEstadoDisponibilidadeObrigatorio("disponivel"), "disponivel");
        assert.equal(lerEstadoDisponibilidadeObrigatorio("preferencial"), "preferencial");
        assert.equal(lerEstadoDisponibilidadeObrigatorio("indisponivel"), "indisponivel");
        assert.throws(() => lerEstadoDisponibilidadeObrigatorio("livre"), { name: "ErroRequisicao" });
        assert.throws(() => lerEstadoDisponibilidadeObrigatorio(undefined), { name: "ErroRequisicao" });

        assert.throws(() => lerTextoObrigatorio("   ", "nome"), { name: "ErroRequisicao" });
        assert.throws(() => lerTextoObrigatorio("abcde", "codigo", 3), { name: "ErroRequisicao" });
        assert.throws(() => lerInteiroObrigatorio(0, "capacidade", 1, 100), { name: "ErroRequisicao" });
        assert.throws(() => lerInteiroObrigatorio(1.5, "capacidade", 1, 100), { name: "ErroRequisicao" });
    });
});

describe("Regras de negócio: sala em manutenção, preferências docentes e permitirMudarFormato", () => {
    test("validador e motor de sugestões rejeitam sala em Manutenção nas etapas A, B e C", () => {
        const sManut = { ...sala(1, "Sala 01 IC", 50, "Sala", "IC", true), status: "Manutenção" as const };
        const sLivre = { ...sala(2, "Sala 02 IC", 50, "Sala", "IC", true), status: "Disponível" as const };
        const t = turma(10, disciplina("COMP360", "LOGICA", 72, false), "01", "2026.2", "CC", "24M34", 40, 40, true, professor("100", "PROF A"));
        t.aulasSemanais = 4;

        // 1. Validador acusa MANUTENCAO
        assert.equal(isAlocacaoValida(t, sManut, []), false);
        const violacoes = diagnosticarViolacoes(t, sManut, []);
        assert.ok(violacoes.some((v) => v.regra === "MANUTENCAO"));

        // 2. Motor de sugestões detecta turma alocada em sala em Manutenção como conflito e a move para sala Disponível
        const res = sugerirResolucoes(
            [t],
            [sManut, sLivre],
            [{ id: 1, turma: t, sala: sManut, horarioCodigo: "24M34", status: "RASCUNHO" }],
        );
        assert.equal(res.conflitos.length, 1);
        assert.ok(res.conflitos[0].violacoes.some((v) => v.regra === "MANUTENCAO"));
        assert.ok(res.plano, "deve sugerir plano tirando a turma da sala em manutenção");
        assert.equal(res.plano.mudancas[0].para.salaId, sLivre.id);
    });

    test("gerarHorariosCandidatos prioriza janelas marcadas como preferenciais pelo docente", () => {
        const prof = professor("200", "PROF PREF");
        prof.preferencias = [{ professorMatricula: "200", diaSemana: "QUA", turno: "M", indiceHorario: "12" }];
        const t = turma(20, disciplina("COMP361", "ETICA", 36, false), "01", "2026.2", "CC", "2M12", 30, 30, true, prof);
        t.aulasSemanais = 2;

        const candidatos = gerarHorariosCandidatos(t, "2M12", false);
        const idxQuaM12 = candidatos.indexOf("4M12");
        const idxQuiM12 = candidatos.indexOf("5M12");
        assert.ok(idxQuaM12 !== -1 && idxQuiM12 !== -1);
        assert.ok(idxQuaM12 < idxQuiM12, `Horário preferencial 4M12 (pos ${idxQuaM12}) deve vir antes de 5M12 (pos ${idxQuiM12})`);
    });

    test("turma.permitirMudarFormato persistido na entidade habilita mudança de formato em sugerirResolucoes", () => {
        const prof = professor("300", "PROF FORMATO");
        const d = disciplina("COMP362", "MD", 72, false);
        const tFixa = turma(1, d, "01", "2026.2", "CC", "24M12", 40, 40, true, prof);
        tFixa.aulasSemanais = 4;
        const tAlvo = turma(2, d, "02", "2026.2", "CC", "24M12", 40, 40, true, prof);
        tAlvo.aulasSemanais = 4;
        tAlvo.permitirMudarFormato = true;

        const candidatos = gerarHorariosCandidatos(tAlvo, "24M12", Boolean(tAlvo.permitirMudarFormato));
        assert.ok(candidatos.some((h) => h === "3M1234" || h === "5M1234"), "deve incluir bloco único de 4 aulas num dia");
    });
});

describe("Contrato HTTP rígido das rotas CRUD (400 em payloads inválidos)", () => {
    let server: Server;
    let base = "";

    before(async () => {
        const app = criarApp();
        await new Promise<void>((resolve) => {
            server = app.listen(0, "127.0.0.1", () => resolve());
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => new Promise<void>((resolve) => server.close(() => resolve())));

    async function req(method: string, path: string, body?: unknown) {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: body !== undefined ? { "content-type": "application/json" } : {},
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json().catch(() => null) };
    }

    test("Salas: rejeita capacidade <= 0, pcs < 0, status inválido e PUT vazio com 400 antes do banco", async () => {
        assert.equal((await req("POST", "/api/salas", { nome: "S1", capacidade: 0, tipoEspaco: "Sala", bloco: "IC" })).status, 400);
        assert.equal((await req("POST", "/api/salas", { nome: "S1", capacidade: 30, pcs: -1, tipoEspaco: "Sala", bloco: "IC" })).status, 400);
        assert.equal((await req("POST", "/api/salas", { nome: "S1", capacidade: 30, status: "Fechada", tipoEspaco: "Sala", bloco: "IC" })).status, 400);
        assert.equal((await req("PUT", "/api/salas/1", {})).status, 400);
        assert.equal((await req("PATCH", "/api/salas/1/status", {})).status, 400);
        assert.equal((await req("PATCH", "/api/salas/1/status", { status: "Invalida" })).status, 400);
    });

    test("Disciplinas: rejeita código > 20 chars, cargaHoraria <= 0 e PUT vazio com 400", async () => {
        assert.equal((await req("POST", "/api/disciplinas", { codigo: "A".repeat(21), nome: "D", cargaHoraria: 60 })).status, 400);
        assert.equal((await req("POST", "/api/disciplinas", { codigo: "COMP999", nome: "D", cargaHoraria: 0 })).status, 400);
        assert.equal((await req("PUT", "/api/disciplinas/COMP360", {})).status, 400);
    });

    test("Professores: rejeita SIAPE > 20 chars, cargaMax < 0, estado inválido e PUT vazio com 400", async () => {
        assert.equal((await req("POST", "/api/professores", { matriculaSiape: "1".repeat(21), nome: "P" })).status, 400);
        assert.equal((await req("PUT", "/api/professores/2024389", { cargaMax: -5 })).status, 400);
        assert.equal((await req("PUT", "/api/professores/2024389", {})).status, 400);
        assert.equal((await req("PUT", "/api/professores/2024389/disponibilidade", { horario: "SEG-M-1", estado: "bloqueado" })).status, 400);
        assert.equal((await req("POST", "/api/professores/2024389/restricoes", { horarioIndisponivel: "SEG-N-5" })).status, 400);
        assert.equal((await req("POST", "/api/professores/2024389/preferencias", { horarioPreferencial: "24M12" })).status, 400);
    });

    test("Turmas: rejeita codigoTurma > 10 chars, semestre inválido, vagas < 0, PATCH /motor sem booleano e PUT vazio com 400", async () => {
        assert.equal((await req("POST", "/api/turmas", {
            disciplinaCodigo: "COMP360", codigoTurma: "01234567890", semestre: "2026.2", cursosOfertados: "CC", vagas: 30,
        })).status, 400);
        assert.equal((await req("POST", "/api/turmas", {
            disciplinaCodigo: "COMP360", codigoTurma: "01", semestre: "2026-2", cursosOfertados: "CC", vagas: 30,
        })).status, 400);
        assert.equal((await req("POST", "/api/turmas", {
            disciplinaCodigo: "COMP360", codigoTurma: "01", semestre: "2026.2", cursosOfertados: "CC", vagas: -1,
        })).status, 400);
        assert.equal((await req("PUT", "/api/turmas/1", {})).status, 400);
        assert.equal((await req("PATCH", "/api/turmas/1/motor", {})).status, 400);
        assert.equal((await req("PATCH", "/api/turmas/1/motor", { permitirMudarFormato: "sim" })).status, 400);
    });
});
