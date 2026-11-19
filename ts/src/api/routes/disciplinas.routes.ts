import { Router, type Request, type Response } from "express";
import { DisciplinaRepository } from "../../db/repositories/index.ts";
import { ErroNaoEncontrado } from "../../erros.ts";

export const disciplinasRouter = Router();
const repo = new DisciplinaRepository();

disciplinasRouter.get("/", async (_req: Request, res: Response) => {
    res.json(await repo.listarTodas());
});

disciplinasRouter.get("/:codigo", async (req: Request, res: Response) => {
    const codigo = String(req.params.codigo).trim().toUpperCase();
    const disciplina = await repo.buscarPorCodigo(codigo);
    if (!disciplina) throw new ErroNaoEncontrado(`Disciplina '${codigo}' não encontrada`);
    res.json(disciplina);
});
