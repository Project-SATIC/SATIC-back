import { Router, type Request, type Response } from "express";
import { DisciplinaRepository, type AtualizarDisciplinaInput } from "../../db/repositories/disciplina.repository.ts";
import {
    lerBooleanoOpcional,
    lerCorpo,
    lerInteiroObrigatorio,
    lerInteiroOpcional,
    lerTextoObrigatorio,
    lerTextoOpcionalCorpo,
} from "../../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../../erros.ts";

export type RepoDisciplinasRota = Pick<DisciplinaRepository, "listarTodas" | "buscarPorCodigo">
    & Partial<Pick<DisciplinaRepository, "criar" | "atualizar" | "deletar">>;

export function criarDisciplinasRouter(repo: RepoDisciplinasRota = new DisciplinaRepository()): Router {
    const padrao = repo instanceof DisciplinaRepository ? repo : new DisciplinaRepository();
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

    router.post("/", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const dados = {
            codigo: lerTextoObrigatorio(body.codigo, "codigo", 30).toUpperCase(),
            nome: lerTextoObrigatorio(body.nome, "nome", 255),
            cargaHoraria: lerInteiroObrigatorio(body.cargaHoraria, "cargaHoraria", 1, 1000),
            exigeLaboratorio: lerBooleanoOpcional(body.exigeLaboratorio, "exigeLaboratorio") ?? false,
        };
        const criada = await (repo.criar ? repo.criar(dados) : padrao.criar(dados));
        res.status(201).json(criada);
    });

    router.put("/:codigo", async (req: Request, res: Response) => {
        const codigo = lerTextoObrigatorio(req.params.codigo, "codigo", 30).toUpperCase();
        const body = lerCorpo(req.body);
        const dados: AtualizarDisciplinaInput = {};

        const nome = lerTextoOpcionalCorpo(body.nome, "nome", 255);
        if (nome !== undefined) dados.nome = nome;
        const cargaHoraria = lerInteiroOpcional(body.cargaHoraria, "cargaHoraria", 1, 1000);
        if (cargaHoraria !== undefined) dados.cargaHoraria = cargaHoraria;
        const exigeLaboratorio = lerBooleanoOpcional(body.exigeLaboratorio, "exigeLaboratorio");
        if (exigeLaboratorio !== undefined) dados.exigeLaboratorio = exigeLaboratorio;

        if (Object.keys(dados).length === 0) {
            throw new ErroRequisicao("Informe ao menos um campo para atualizar a disciplina");
        }

        const atualizada = await (repo.atualizar ? repo.atualizar(codigo, dados) : padrao.atualizar(codigo, dados));
        if (!atualizada) throw new ErroNaoEncontrado(`Disciplina '${codigo}' não encontrada`);
        res.json(atualizada);
    });

    router.delete("/:codigo", async (req: Request, res: Response) => {
        const codigo = lerTextoObrigatorio(req.params.codigo, "codigo", 30).toUpperCase();
        const removida = await (repo.deletar ? repo.deletar(codigo) : padrao.deletar(codigo));
        if (!removida) throw new ErroNaoEncontrado(`Disciplina '${codigo}' não encontrada`);
        res.status(204).end();
    });

    return router;
}

export const disciplinasRouter = criarDisciplinasRouter();
