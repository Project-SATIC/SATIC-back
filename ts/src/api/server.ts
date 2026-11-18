import "dotenv/config";
import { criarApp } from "./app.ts";
import { testConnection } from "../db/connection.ts";

const PORT = Number(process.env.PORT || 3001);
const app = criarApp();

async function startServer(): Promise<void> {
    console.log("[SATIC-SERVER] Iniciando servidor Express...");
    const conn = await testConnection();
    if (conn.ok) {
        console.log(`[SATIC-SERVER] PostgreSQL: ${conn.message}`);
    } else {
        console.warn(`[SATIC-SERVER] AVISO PostgreSQL: ${conn.message}`);
        console.warn("[SATIC-SERVER] O servidor responderá requisições, mas operações de banco exigirão PostgreSQL ativo.");
    }

    app.listen(PORT, () => {
        console.log(`[SATIC-SERVER] Servidor rodando em http://localhost:${PORT}`);
        console.log(`[SATIC-SERVER] Health check: http://localhost:${PORT}/api/health`);
    });
}

startServer();
