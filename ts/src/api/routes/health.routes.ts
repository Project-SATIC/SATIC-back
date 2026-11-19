import { Router, type Request, type Response } from "express";
import { testConnection } from "../../db/connection.ts";

export const healthRouter = Router();

/** 200 quando o banco responde; 503 quando a API está no ar mas o PostgreSQL não (mesmo corpo). */
healthRouter.get("/", async (_req: Request, res: Response) => {
    const dbTest = await testConnection();
    res.status(dbTest.ok ? 200 : 503).json({
        status: dbTest.ok ? "ok" : "degradado",
        timestamp: new Date().toISOString(),
        database: {
            conectado: dbTest.ok,
            mensagem: dbTest.message,
        },
    });
});
