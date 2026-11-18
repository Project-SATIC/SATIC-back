import { Router, type Request, type Response } from "express";
import { testConnection } from "../../db/connection.ts";

export const healthRouter = Router();

healthRouter.get("/", async (_req: Request, res: Response) => {
    const dbTest = await testConnection();
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        database: {
            conectado: dbTest.ok,
            mensagem: dbTest.message,
        },
    });
});
