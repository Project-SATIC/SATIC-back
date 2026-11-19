import { Router, type Request, type Response } from "express";
import { ProfessorRepository } from "../../db/repositories/index.ts";
import { ErroNaoEncontrado } from "../../erros.ts";

export const professoresRouter = Router();
const repo = new ProfessorRepository();

professoresRouter.get("/", async (_req: Request, res: Response) => {
    res.json(await repo.listarTodos());
});

professoresRouter.get("/:siape", async (req: Request, res: Response) => {
    const siape = String(req.params.siape).trim();
    const professor = await repo.buscarPorSiape(siape);
    if (!professor) throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);
    res.json(professor);
});
