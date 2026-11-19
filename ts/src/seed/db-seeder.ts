import { closePool, testConnection } from "../db/connection.ts";
import {
    AlocacaoRepository,
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { montarProblema } from "../motor/montar-problema.ts";
import type { Sala } from "../shared/tipos.ts";
import { carregarBase2026_2 } from "./seeder.ts";
import { AMOSTRA_2026_2, ofertasDaAmostra } from "./amostra.ts";

export interface OpcoesSeed {
    /** Só as 17 turmas da amostra para testes manuais (src/seed/amostra.ts); as 19 salas continuam. */
    amostra?: boolean;
}

export async function executarSeed(opcoes: OpcoesSeed = {}): Promise<{
    salas: number;
    disciplinas: number;
    professores: number;
    turmas: number;
    reservasExternas: number;
}> {
    const salaRepo = new SalaRepository();
    const discRepo = new DisciplinaRepository();
    const profRepo = new ProfessorRepository();
    const turmaRepo = new TurmaRepository();
    const alocacaoRepo = new AlocacaoRepository();

    console.log(opcoes.amostra
        ? `[SATIC-SEED] Carregando a AMOSTRA de 2026.2 (${AMOSTRA_2026_2.length} turmas reais para testes manuais)...`
        : "[SATIC-SEED] Carregando dados de 2026.2 em memória...");
    const base = opcoes.amostra ? carregarBase2026_2(ofertasDaAmostra()) : carregarBase2026_2();

    console.log(`[SATIC-SEED] Inserindo ${base.salas.length} salas...`);
    // Os ids das salas no PostgreSQL podem diferir dos ids da base em memória: guarda os do banco
    const salasNoBanco = new Map<string, Sala>();
    for (const sala of base.salas) {
        salasNoBanco.set(sala.nome, await salaRepo.inserir(sala));
    }

    console.log(`[SATIC-SEED] Inserindo ${base.disciplinas.length} disciplinas...`);
    await discRepo.inserirMuitas(base.disciplinas);

    console.log(`[SATIC-SEED] Inserindo ${base.professores.length} professores...`);
    await profRepo.inserirMuitos(base.professores);

    // Indisponibilidade documentada da oferta (Ranilson Oscar Araujo Paiva - RN-02)
    const profRanilson = base.professores.find((p) => p.nome.includes("RANILSON"));
    if (profRanilson) {
        console.log(`[SATIC-SEED] Registrando restrição de horário para ${profRanilson.nome} (SEX-T-56)...`);
        await profRepo.adicionarRestricao(profRanilson.matriculaSiape, "SEX-T-56");
    }

    // IART* são do curso de Inteligência Artificial (noturno); a oferta importada do SIGAA/Java
    // as traz como "CC". A base em memória fica como no Java (gabaritos), a correção vale no banco.
    for (const t of base.turmas) {
        if (t.disciplina.codigo.startsWith("IART") && t.cursosOfertados === "CC") t.cursosOfertados = "IA";
    }

    console.log(`[SATIC-SEED] Inserindo ${base.turmas.length} turmas e vínculos docentes...`);
    await turmaRepo.inserirMuitas(base.turmas); // atribui a cada turma o id do banco

    // Reservas EXTERNA_FIXA: turmas de outros institutos que já ocupam sala do pool do IC
    // (ex: IF0001-05 na Sala 207 BL12). Sem elas o motor alocaria turmas do IC por cima.
    const { reservasFixasExternas } = montarProblema(base);
    console.log(`[SATIC-SEED] Registrando ${reservasFixasExternas.length} reserva(s) EXTERNA_FIXA...`);
    for (const reserva of reservasFixasExternas) {
        const sala = salasNoBanco.get(reserva.sala.nome);
        if (!sala?.id || !reserva.turma.id) {
            throw new Error(`Reserva externa sem id de sala/turma: ${reserva.sala.nome}`);
        }
        await alocacaoRepo.registrarReservaExterna(reserva.turma.id, sala.id, reserva.horarioCodigo);
    }

    return {
        salas: base.salas.length,
        disciplinas: base.disciplinas.length,
        professores: base.professores.length,
        turmas: base.turmas.length,
        reservasExternas: reservasFixasExternas.length,
    };
}

async function main(): Promise<void> {
    console.log("[SATIC-SEED] Testando conexão com PostgreSQL...");
    const conn = await testConnection();
    if (!conn.ok) {
        console.error("[SATIC-SEED] Falha ao conectar no PostgreSQL:", conn.message);
        console.error("Certifique-se de que o banco está rodando e as migrations foram executadas ('npm run migrate').");
        process.exit(1);
    }

    try {
        const resumo = await executarSeed({ amostra: process.argv.includes("--amostra") });
        console.log("\n[SATIC-SEED] Seed concluído com sucesso!");
        console.log(`  - Salas: ${resumo.salas}`);
        console.log(`  - Disciplinas: ${resumo.disciplinas}`);
        console.log(`  - Professores: ${resumo.professores}`);
        console.log(`  - Turmas: ${resumo.turmas}`);
        console.log(`  - Reservas EXTERNA_FIXA: ${resumo.reservasExternas}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[SATIC-SEED] Erro durante o seed:", msg);
        process.exit(1);
    } finally {
        await closePool();
    }
}

if (process.argv[1]?.endsWith("db-seeder.ts")) {
    main();
}
