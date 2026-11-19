/**
 * Banco PostgreSQL local sem Docker nem instalação, para desenvolvimento e integração com o front.
 *
 * Sobe um PostgreSQL real (PGlite, PostgreSQL 18 compilado para WebAssembly) com os dados em
 * disco (`ts/.pglite/`, fora do git), exposto numa porta TCP local para o driver `pg`.
 * Na partida aplica as migrations pendentes e, se o banco estiver vazio, roda o seed 2026.2.
 *
 *   npm run local       banco + API Express em http://localhost:3001 (um único terminal)
 *   npm run db:local    só o banco (para usar com `npm start` em outro terminal, com PGPOOL_MAX=1)
 *
 * Opções: --porta=5432 (porta do banco), --dados=.pglite (pasta), --resetar (apaga e recria tudo).
 *
 * Limitações do PGlite (só desenvolvimento, não produção): uma única sessão, por isso o pool
 * da API fica com 1 conexão; e o adaptador TCP fecha a conexão após um erro de SQL, que o pool
 * reabre sozinho.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const RAIZ_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function opcao(nome: string, padrao: string): string {
    const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
    return arg ? arg.slice(nome.length + 3) : padrao;
}

const comApi = process.argv.includes("--com-api");
const resetar = process.argv.includes("--resetar");
const porta = Number(opcao("porta", process.env.PGPORT || "5432"));
const pastaDados = path.resolve(RAIZ_TS, opcao("dados", ".pglite"));

if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
    console.error(`[SATIC-LOCAL] Porta inválida: ${porta}`);
    process.exit(1);
}

// O pool da API e dos scripts aponta para este banco (sobrepõe o .env)
delete process.env.DATABASE_URL;
Object.assign(process.env, {
    PGHOST: "127.0.0.1",
    PGPORT: String(porta),
    PGUSER: "postgres",
    PGPASSWORD: "postgres",
    PGDATABASE: "postgres",
    PGPOOL_MAX: "1",
});

async function main(): Promise<void> {
    if (resetar) {
        console.log(`[SATIC-LOCAL] --resetar: apagando ${pastaDados}`);
        await rm(pastaDados, { recursive: true, force: true });
    }

    console.log(`[SATIC-LOCAL] Abrindo PostgreSQL (PGlite) em ${pastaDados}...`);
    const db = await PGlite.create({ dataDir: pastaDados });
    const servidorBanco = new PGLiteSocketServer({ db, port: porta, host: "127.0.0.1" });
    try {
        await servidorBanco.start();
    } catch (err) {
        const codigo = (err as { code?: string }).code;
        console.error(codigo === "EADDRINUSE"
            ? `[SATIC-LOCAL] A porta ${porta} já está em uso (outro PostgreSQL?). Use --porta=5433.`
            : `[SATIC-LOCAL] Falha ao abrir a porta ${porta}: ${(err as Error).message}`);
        await db.close();
        process.exit(1);
    }
    console.log(`[SATIC-LOCAL] PostgreSQL ouvindo em 127.0.0.1:${porta} (usuário postgres, banco postgres)`);

    // Importados só agora, com o ambiente já apontando para o banco local
    const { closePool, query } = await import("../src/db/connection.ts");
    const { executarMigrations } = await import("../src/db/migrator.ts");
    const { executarSeed } = await import("../src/seed/db-seeder.ts");

    const resultados = await executarMigrations();
    const aplicadas = resultados.filter((r) => r.status === "aplicada").length;
    console.log(`[SATIC-LOCAL] Migrations: ${aplicadas} aplicada(s), ${resultados.length - aplicadas} já existente(s).`);

    const { rows } = await query<{ n: number }>("SELECT COUNT(*)::int AS n FROM turma;");
    if (rows[0].n === 0) {
        console.log("[SATIC-LOCAL] Banco vazio: rodando o seed 2026.2...");
        const r = await executarSeed();
        console.log(`[SATIC-LOCAL] Seed: ${r.turmas} turmas, ${r.salas} salas, ${r.reservasExternas} reservas EXTERNA_FIXA.`);
    } else {
        console.log(`[SATIC-LOCAL] Banco já povoado (${rows[0].n} turmas). Use --resetar para recriar do zero.`);
    }

    let servidorApi: import("node:http").Server | undefined;
    if (comApi) {
        await import("dotenv/config");
        const { criarApp } = await import("../src/api/app.ts");
        const portaApi = Number(process.env.PORT || 3001);
        servidorApi = criarApp().listen(portaApi, () => {
            console.log(`[SATIC-LOCAL] API Express em http://localhost:${portaApi} (health: /api/health)`);
        });
        servidorApi.on("error", (err: NodeJS.ErrnoException) => {
            console.error(err.code === "EADDRINUSE"
                ? `[SATIC-LOCAL] A porta ${portaApi} da API já está em uso (defina PORT).`
                : `[SATIC-LOCAL] Falha ao iniciar a API: ${err.message}`);
            void encerrar("erro");
        });
    } else {
        console.log("[SATIC-LOCAL] Só o banco está no ar. Em outro terminal: $env:PGPORT=" + porta + "; $env:PGPOOL_MAX=1; npm start");
    }
    console.log("[SATIC-LOCAL] Ctrl+C para encerrar.");

    let encerrando = false;
    async function encerrar(sinal: string): Promise<void> {
        if (encerrando) return;
        encerrando = true;
        console.log(`[SATIC-LOCAL] ${sinal}: encerrando e gravando os dados em disco...`);
        if (servidorApi) await new Promise<void>((resolve) => servidorApi!.close(() => resolve()));
        await closePool().catch(() => undefined);
        await servidorBanco.stop().catch(() => undefined);
        await db.close();
        process.exit(sinal === "erro" ? 1 : 0);
    }
    process.on("SIGINT", () => void encerrar("SIGINT"));
    process.on("SIGTERM", () => void encerrar("SIGTERM"));
}

main().catch((err) => {
    console.error("[SATIC-LOCAL] Erro fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
});
