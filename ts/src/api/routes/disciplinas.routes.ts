import { Router, type Request, type Response } from "express";
import { DisciplinaRepository } from "../../db/repositories/index.ts";
import { ErroNaoEncontrado } from "../../erros.ts";

export type RepoDisciplinasRota = Pick<DisciplinaRepository, "listarTodas" | "buscarPorCodigo">;

export function criarDisciplinasRouter(repo: RepoDisciplinasRota = new DisciplinaRepository()): Router {
    const router = Router();

    router.get("/", async (_req: Request, res: Response) => {
        res.json(await repo.listarTodas());
    });

    router.get("/:codigo", async (req: Request, res: Response) => {
        const codigo = String(req.params.codigo).trim().toUpperCase();
        const disciplina = await repo.buscarPorCodigo(codigo);
        if (!disciplina) throw new ErroNaoEncontrado(`Disciplina '${codigo}' não encontrada`);
        res.json(disciplina);
    });

    return router;
}

export const disciplinasRouter = criarDisciplinasRouter();
