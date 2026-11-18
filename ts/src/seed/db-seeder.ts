import { closePool, testConnection } from "../db/connection.ts";
import {
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { carregarBase2026_2 } from "./seeder.ts";

export async function executarSeed(): Promise<{
    salas: number;
    disciplinas: number;
    professores: number;
    turmas: number;
}> {
    const salaRepo = new SalaRepository();
    const discRepo = new DisciplinaRepository();
    const profRepo = new ProfessorRepository();
    const turmaRepo = new TurmaRepository();

    console.log("[SATIC-SEED] Carregando dados de 2026.2 em memória...");
    const base = carregarBase2026_2();

    console.log(`[SATIC-SEED] Inserindo ${base.salas.length} salas...`);
    await salaRepo.inserirMuitas(base.salas);

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

    console.log(`[SATIC-SEED] Inserindo ${base.turmas.length} turmas e vínculos docentes...`);
    await turmaRepo.inserirMuitas(base.turmas);

    return {
        salas: base.salas.length,
        disciplinas: base.disciplinas.length,
        professores: base.professores.length,
        turmas: base.turmas.length,
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
