import { Router, type Request, type Response } from "express";
import { TurmaRepository } from "../../db/repositories/index.ts";
import { lerBooleanoOpcional, lerId, lerSemestre } from "../../entrada.ts";
import { ErroNaoEncontrado } from "../../erros.ts";

export const turmasRouter = Router();
const repo = new TurmaRepository();

turmasRouter.get("/", async (req: Request, res: Response) => {
    const semestre = typeof req.query.semestre === "string" && req.query.semestre.trim() !== ""
        ? lerSemestre(req.query.semestre)
        : undefined;
    const requerIc = lerBooleanoOpcional(req.query.requer_ic, "requer_ic");

    let turmas = semestre ? await repo.listarPorSemestre(semestre) : await repo.listarTodas();
    if (requerIc !== undefined) turmas = turmas.filter((t) => t.requerAlocacaoIc === requerIc);
    res.json(turmas);
});

turmasRouter.get("/:id", async (req: Request, res: Response) => {
    const id = lerId(req.params.id, "id");
    const turma = await repo.buscarPorId(id);
    if (!turma) throw new ErroNaoEncontrado(`Turma de id ${id} não encontrada`);
    res.json(turma);
});
