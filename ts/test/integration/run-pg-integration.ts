import "dotenv/config";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;

const TEST_DB = process.env.PGTEST_DATABASE || "satic_test";

async function garantirBancoTeste(): Promise<void> {
    if (!/^[a-zA-Z0-9_]+$/.test(TEST_DB)) {
        throw new Error(`Nome de banco de teste inválido: '${TEST_DB}'`);
    }

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
        const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1;", [TEST_DB]);
        if (exists.rowCount === 0) {
            await admin.query(`CREATE DATABASE "${TEST_DB}";`);
            console.log(`[SATIC-TEST-DB] Banco de teste '${TEST_DB}' criado automaticamente.`);
        }
    } finally {
        await admin.end().catch(() => {});
    }
}

async function main(): Promise<void> {
    try {
        await garantirBancoTeste();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SATIC-TEST-DB] Não foi possível preparar o banco de teste PostgreSQL: ${msg}`);
        console.error("Certifique-se de que o PostgreSQL está rodando ('docker compose up -d').");
        process.exit(1);
    }

    const res = spawnSync(
        process.execPath,
        ["--test", "test/integration/postgres.integration.test.ts"],
        {
            stdio: "inherit",
            env: {
                ...process.env,
                DATABASE_URL: "",
                PGDATABASE: TEST_DB,
                SATIC_RUN_PG_INTEGRATION: "1",
            },
        },
    );

    process.exit(res.status ?? 1);
}

main();
