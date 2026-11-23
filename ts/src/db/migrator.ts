import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comTransacao, formatarErro, query } from "./connection.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

export interface MigrationResult {
    arquivo: string;
    status: "aplicada" | "ja_executada" | "erro";
    mensagem?: string;
}

export async function listarArquivosMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
    const arquivos = await fs.readdir(dir);
    return arquivos
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));
}

export async function inicializarTabelaMigrations(): Promise<void> {
    await query(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            nome VARCHAR(255) NOT NULL UNIQUE,
            executado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

export async function listarMigrationsExecutadas(): Promise<Set<string>> {
    await inicializarTabelaMigrations();
    const res = await query<{ nome: string }>("SELECT nome FROM _migrations ORDER BY id ASC;");
    return new Set(res.rows.map((r) => r.nome));
}

export async function executarMigrations(): Promise<MigrationResult[]> {
    await inicializarTabelaMigrations();
    const executadas = await listarMigrationsExecutadas();
    const sqlArquivos = await listarArquivosMigrations();

    const resultados: MigrationResult[] = [];

    for (const arquivo of sqlArquivos) {
        if (executadas.has(arquivo)) {
            resultados.push({ arquivo, status: "ja_executada" });
            continue;
        }

        const caminhoArquivo = path.join(MIGRATIONS_DIR, arquivo);
        const conteudoSql = await fs.readFile(caminhoArquivo, "utf-8");

        try {
            await comTransacao(async (client) => {
                await client.query(conteudoSql);
                await client.query("INSERT INTO _migrations (nome) VALUES ($1);", [arquivo]);
            });

            resultados.push({ arquivo, status: "aplicada" });
            console.log(`[Migrations] Aplicada com sucesso: ${arquivo}`);
        } catch (err: unknown) {
            const msg = formatarErro(err);
            console.error(`[Migrations] Falha ao aplicar ${arquivo}:`, msg);
            resultados.push({ arquivo, status: "erro", mensagem: msg });
            throw new Error(`Erro na migration ${arquivo}: ${msg}`);
        }
    }

    return resultados;
}

export const SQL_RESET_BANCO = `
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;

    FOR r IN (
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid
                AND d.deptype = 'e'
          )
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || '(' || r.args || ') CASCADE';
    END LOOP;
END $$;
`;

export async function resetarBanco(): Promise<void> {
    console.log("[Migrations] Limpando todas as tabelas e funções do schema public...");
    await query(SQL_RESET_BANCO);
    console.log("[Migrations] Banco resetado.");
}
