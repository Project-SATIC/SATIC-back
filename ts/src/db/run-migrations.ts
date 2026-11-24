import "dotenv/config";
import pg from "pg";
import { closePool, testConnection } from "./connection.ts";
import { executarMigrations, resetarBanco } from "./migrator.ts";

const { Client } = pg;

async function tentarCriarBancoSeAusente(): Promise<boolean> {
    if (process.env.DATABASE_URL) return false;
    const dbName = process.env.PGDATABASE || "satic";
    if (!/^[a-zA-Z0-9_]+$/.test(dbName)) return false;

    const admin = new Client({
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "postgres",
        database: "postgres",
        connectionTimeoutMillis: 5000,
    });

    try {
        await admin.connect();
        const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1;", [dbName]);
        if (exists.rowCount === 0) {
            await admin.query(`CREATE DATABASE "${dbName}";`);
            console.log(`[SATIC-DB] Banco '${dbName}' criado automaticamente.`);
            return true;
        }
        return false;
    } catch {
        return false;
    } finally {
        await admin.end().catch(() => {});
    }
}

async function main(): Promise<void> {
    const isReset = process.argv.includes("--reset");

    console.log("[SATIC-DB] Testando conexão com PostgreSQL...");
    let conn = await testConnection();
    if (!conn.ok && conn.message && /não existe o banco de dados|does not exist/i.test(conn.message)) {
        await closePool();
        if (await tentarCriarBancoSeAusente()) {
            conn = await testConnection();
        }
    }

    if (!conn.ok) {
        console.error("[SATIC-DB] Não foi possível conectar ao PostgreSQL:");
        console.error(`          ${conn.message}`);
        console.error("\nCertifique-se de que o PostgreSQL está rodando e as variáveis de ambiente em .env estão corretas.");
        console.error("Dica: você pode subir um banco com 'docker compose up -d' na raiz do projeto.\n");
        process.exit(1);
    }
    console.log(`[SATIC-DB] ${conn.message}`);

    try {
        if (isReset) {
            await resetarBanco();
        }

        console.log("[SATIC-DB] Executando migrations pendentes...");
        const resultados = await executarMigrations();
        const aplicadas = resultados.filter((r) => r.status === "aplicada");
        const jaExecutadas = resultados.filter((r) => r.status === "ja_executada");

        console.log(`[SATIC-DB] Concluído! ${aplicadas.length} migration(s) aplicada(s), ${jaExecutadas.length} já aplicada(s) anteriormente.`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[SATIC-DB] Erro fatal durante a execução das migrations:", msg);
        process.exit(1);
    } finally {
        await closePool();
    }
}

main();
