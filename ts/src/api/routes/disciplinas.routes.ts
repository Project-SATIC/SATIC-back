import { Router, type Request, type Response } from "express";
import { DisciplinaRepository } from "../../db/repositories/index.ts";
import { responderErroBanco } from "../pg-errors.ts";
import {
    extrairParamString,
    parseBooleanoEstrito,
    parseInteiroPositivoEstrito,
} from "../validation.ts";

export const disciplinasRouter = Router();
const repo = new DisciplinaRepository();

disciplinasRouter.get("/", async (_req: Request, res: Response) => {
    try {
        const disciplinas = await repo.listarTodas();
        res.json(disciplinas);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao listar disciplinas", "leitura");
    }
});

disciplinasRouter.get("/:codigo", async (req: Request, res: Response) => {
    try {
        const codigo = extrairParamString(req.params.codigo).trim().toUpperCase();
        const disciplina = await repo.buscarPorCodigo(codigo);
        if (!disciplina) {
            res.status(404).json({ erro: `Disciplina '${codigo}' não encontrada` });
            return;
        }
        res.json(disciplina);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao buscar disciplina", "leitura");
    }
});

disciplinasRouter.post("/", async (req: Request, res: Response) => {
    try {
        const { codigo, nome, cargaHoraria, exigeLaboratorio } = req.body || {};

        if (typeof codigo !== "string" || codigo.trim() === "") {
            res.status(400).json({ erro: "Campo 'codigo' é obrigatório" });
            return;
        }
        if (typeof nome !== "string" || nome.trim() === "") {
            res.status(400).json({ erro: "Campo 'nome' é obrigatório" });
            return;
        }
        const ch = parseInteiroPositivoEstrito(cargaHoraria);
        if (ch === null) {
            res.status(400).json({ erro: "Campo 'cargaHoraria' deve ser um inteiro positivo" });
            return;
        }
        let exigeLabBool = false;
        if (exigeLaboratorio !== undefined) {
            const parsed = parseBooleanoEstrito(exigeLaboratorio);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'exigeLaboratorio' deve ser booleano" });
                return;
            }
            exigeLabBool = parsed;
        }

        const criada = await repo.criar({
            codigo: codigo.trim().toUpperCase(),
            nome: nome.trim(),
            cargaHoraria: ch,
            exigeLaboratorio: exigeLabBool,
        });
        res.status(201).json(criada);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao criar disciplina", "escrita");
    }
});

disciplinasRouter.put("/:codigo", async (req: Request, res: Response) => {
    try {
        const codigo = extrairParamString(req.params.codigo).trim().toUpperCase();
        const { nome, cargaHoraria, exigeLaboratorio } = req.body || {};
        const dados: { nome?: string; cargaHoraria?: number; exigeLaboratorio?: boolean } = {};

        if (nome !== undefined) {
            if (typeof nome !== "string" || nome.trim() === "") {
                res.status(400).json({ erro: "Campo 'nome' não pode ser vazio" });
                return;
            }
            dados.nome = nome.trim();
        }
        if (cargaHoraria !== undefined) {
            const ch = parseInteiroPositivoEstrito(cargaHoraria);
            if (ch === null) {
                res.status(400).json({ erro: "Campo 'cargaHoraria' deve ser um inteiro positivo" });
                return;
            }
            dados.cargaHoraria = ch;
        }
        if (exigeLaboratorio !== undefined) {
            const parsed = parseBooleanoEstrito(exigeLaboratorio);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'exigeLaboratorio' deve ser booleano" });
                return;
            }
            dados.exigeLaboratorio = parsed;
        }

        const atualizada = await repo.atualizar(codigo, dados);
        if (!atualizada) {
            res.status(404).json({ erro: `Disciplina '${codigo}' não encontrada` });
            return;
        }
        res.json(atualizada);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao atualizar disciplina", "escrita");
    }
});

disciplinasRouter.delete("/:codigo", async (req: Request, res: Response) => {
    try {
        const codigo = extrairParamString(req.params.codigo).trim().toUpperCase();
        const removida = await repo.deletar(codigo);
        if (!removida) {
            res.status(404).json({ erro: `Disciplina '${codigo}' não encontrada` });
            return;
        }
        res.status(204).end();
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao remover disciplina", "remocao");
    }
});
