import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";

export const alocacoesRouter = Router();
const repo = new AlocacaoRepository();

alocacoesRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { semestre } = req.query;

        const alocacoes = typeof semestre === "string" && semestre.trim() !== ""
            ? await repo.listarPorSemestre(semestre.trim())
            : await repo.listarTodas();

        res.json(alocacoes);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao listar alocações", detalhes: msg });
    }
});
