import { Router, type Request, type Response } from "express";
import { ProfessorRepository } from "../../db/repositories/index.ts";

export const professoresRouter = Router();
const repo = new ProfessorRepository();

professoresRouter.get("/", async (_req: Request, res: Response) => {
    try {
        const professores = await repo.listarTodos();
        res.json(professores);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao listar professores", detalhes: msg });
    }
});

professoresRouter.get("/:siape", async (req: Request, res: Response) => {
    try {
        const professor = await repo.buscarPorSiape(req.params.siape);
        if (!professor) {
            res.status(404).json({ erro: `Professor com SIAPE '${req.params.siape}' não encontrado` });
            return;
        }
        res.json(professor);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao buscar professor", detalhes: msg });
    }
});
