import { closePool, comTransacao, formatarErro, testConnection } from "../db/connection.ts";
import {
    AlocacaoRepository,
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { chaveTurma } from "../shared/tipos.ts";
import { carregarBase2026_2 } from "./seeder.ts";

export async function executarSeed(): Promise<{
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
    const alocRepo = new AlocacaoRepository();

    console.log("[SATIC-SEED] Carregando dados de 2026.2 em memória...");
    const base = carregarBase2026_2();

    const reservasExternas = await comTransacao(async (client) => {
        console.log(`[SATIC-SEED] Inserindo ${base.salas.length} salas...`);
        const salasPersistidas = await salaRepo.inserirMuitas(base.salas, client);

        console.log(`[SATIC-SEED] Inserindo ${base.disciplinas.length} disciplinas...`);
        await discRepo.inserirMuitas(base.disciplinas, client);

        console.log(`[SATIC-SEED] Inserindo ${base.professores.length} professores...`);
        await profRepo.inserirMuitos(base.professores, client);

        // Indisponibilidade documentada da oferta (Ranilson Oscar Araujo Paiva - RN-02)
        const profRanilson = base.professores.find((p) => p.nome.includes("RANILSON"));
        if (profRanilson) {
            console.log(`[SATIC-SEED] Registrando restrição de horário para ${profRanilson.nome} (SEX-T-56)...`);
            await profRepo.adicionarRestricao(profRanilson.matriculaSiape, "SEX-T-56", client);
        }

        console.log(`[SATIC-SEED] Inserindo ${base.turmas.length} turmas e vínculos docentes...`);
        await turmaRepo.inserirMuitas(base.turmas, client);

        // Reservas fixas de turmas externas que ocupam salas do pool do IC (ex: IF0001-05, FALE0002-03)
        const salaPorNome = new Map(salasPersistidas.map((s) => [s.nome, s]));
        let totalReservas = 0;

        for (const turma of base.turmas) {
            if (turma.requerAlocacaoIc) continue;
            const nomeSala = base.gabaritoSigaa.get(chaveTurma(turma));
            const sala = nomeSala != null ? salaPorNome.get(nomeSala) : undefined;
            if (sala && sala.alocavelIc) {
                await alocRepo.upsertExternaFixa(
                    {
                        turma,
                        sala,
                        horarioCodigo: turma.horarioSigaa,
                        status: "EXTERNA_FIXA",
                    },
                    client
                );
                totalReservas++;
            }
        }

        console.log(`[SATIC-SEED] Registradas ${totalReservas} reservas externas fixas (EXTERNA_FIXA).`);
        return totalReservas;
    });

    return {
        salas: base.salas.length,
        disciplinas: base.disciplinas.length,
        professores: base.professores.length,
        turmas: base.turmas.length,
        reservasExternas,
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
        const resumo = await executarSeed();
        console.log("\n[SATIC-SEED] Seed concluído com sucesso!");
        console.log(`  - Salas: ${resumo.salas}`);
        console.log(`  - Disciplinas: ${resumo.disciplinas}`);
        console.log(`  - Professores: ${resumo.professores}`);
        console.log(`  - Turmas: ${resumo.turmas}`);
        console.log(`  - Reservas EXTERNA_FIXA: ${resumo.reservasExternas}`);
    } catch (err: unknown) {
        console.error("[SATIC-SEED] Erro durante o seed:", formatarErro(err));
        process.exit(1);
    } finally {
        await closePool();
    }
}

if (process.argv[1]?.endsWith("db-seeder.ts")) {
    main();
}
