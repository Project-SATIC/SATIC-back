import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { formatarErro } from "../../src/db/connection.ts";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_FILE = path.join(__dirname, "postgres.integration.test.ts");
const TEST_DB = process.env.PGDATABASE_TEST || "satic_test";

function construirUrlComBanco(baseUrl: string, database: string): string {
    const u = new URL(baseUrl);
    u.pathname = `/${encodeURIComponent(database)}`;
    return u.toString();
}

function criarConfigAdmin(): pg.ClientConfig {
    const baseUrl = process.env.SATIC_TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (baseUrl && baseUrl.trim() !== "") {
        return {
            connectionString: construirUrlComBanco(baseUrl.trim(), "postgres"),
            connectionTimeoutMillis: 5000,
        };
    }

    return {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "postgres",
        database: "postgres",
        connectionTimeoutMillis: 5000,
    };
}

async function garantirBancoDeTeste(): Promise<void> {
    if (process.env.SATIC_TEST_DATABASE_URL) {
        return;
    }

    const adminClient = new Client(criarConfigAdmin());
    await adminClient.connect();
    try {
        const res = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1;", [TEST_DB]);
        if (res.rowCount === 0) {
            const safeName = TEST_DB.replace(/"/g, '""');
            await adminClient.query(`CREATE DATABASE "${safeName}";`);
            console.log(`[SATIC-TEST-DB] Banco de teste '${TEST_DB}' criado automaticamente.`);
        }
    } finally {
        await adminClient.end();
    }
}

async function main(): Promise<void> {
    try {
        await garantirBancoDeTeste();
    } catch (err: unknown) {
        console.error("[SATIC-TEST-DB] Não foi possível preparar o banco de teste PostgreSQL:", formatarErro(err));
        console.error("Certifique-se de que o PostgreSQL está rodando ('docker compose up -d').");
        process.exit(1);
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        SATIC_RUN_PG_TESTS: "1",
        PGDATABASE: TEST_DB,
    };

    if (process.env.SATIC_TEST_DATABASE_URL) {
        env.DATABASE_URL = process.env.SATIC_TEST_DATABASE_URL;
    } else if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== "") {
        env.DATABASE_URL = construirUrlComBanco(process.env.DATABASE_URL.trim(), TEST_DB);
    } else {
        // String vazia impede dotenv/config de recarregar DATABASE_URL do .env sobre PGDATABASE=satic_test
        env.DATABASE_URL = "";
    }

    const result = spawnSync(process.execPath, ["--test", TEST_FILE], {
        stdio: "inherit",
        env,
    });

    process.exit(result.status ?? 1);
}

main();
