import { closePool, formatarErro, testConnection } from "./connection.ts";
import { executarMigrations, resetarBanco } from "./migrator.ts";

async function main(): Promise<void> {
    const isReset = process.argv.includes("--reset");

    console.log("[SATIC-DB] Testando conexão com PostgreSQL...");
    const conn = await testConnection();
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
        console.error("[SATIC-DB] Erro fatal durante a execução das migrations:", formatarErro(err));
        process.exit(1);
    } finally {
        await closePool();
    }
}

main();
