import { Router, type Request, type Response } from "express";
import { DisciplinaRepository } from "../../db/repositories/index.ts";

export const disciplinasRouter = Router();
const repo = new DisciplinaRepository();

disciplinasRouter.get("/", async (_req: Request, res: Response) => {
    try {
        const disciplinas = await repo.listarTodas();
        res.json(disciplinas);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao listar disciplinas", detalhes: msg });
    }
});

disciplinasRouter.get("/:codigo", async (req: Request, res: Response) => {
    try {
        const disciplina = await repo.buscarPorCodigo(req.params.codigo);
        if (!disciplina) {
            res.status(404).json({ erro: `Disciplina '${req.params.codigo}' não encontrada` });
            return;
        }
        res.json(disciplina);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao buscar disciplina", detalhes: msg });
    }
});
