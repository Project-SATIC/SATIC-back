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

// -------------------------------------------------------------------------------------------------
// Rotas reservadas (ainda não implementadas). Hoje o front faz isso só na sessão do navegador.
//
// POST   /api/turmas                 cadastro de turma da pré-grade (disciplina, código, cursos, vagas,
//                                    horário SIGAA, aulas por semana, docentes)
// PUT    /api/turmas/:id             edição dos dados da turma (cursos, vagas, matriculados, aulas por semana)
// PUT    /api/turmas/:id/professores troca/inclusão/remoção de docentes (turma sem docente = pendente)
// PATCH  /api/turmas/:id/motor       { permitirMudarFormato: boolean }
//   Configuração por turma (19/11/2026): deixa o motor de sugestões trocar o formato dos blocos
//   (ex.: 2+2 -> 4 num dia). Exige coluna na tabela turma.
// -------------------------------------------------------------------------------------------------
