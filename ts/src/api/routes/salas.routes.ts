import { Router, type Request, type Response } from "express";
import { SalaRepository } from "../../db/repositories/index.ts";
import { responderErroBanco } from "../pg-errors.ts";
import {
    parseBooleanoEstrito,
    parseIdParam,
    parseInteiroPositivoEstrito,
    parseQueryBooleano,
} from "../validation.ts";

export const salasRouter = Router();
const repo = new SalaRepository();

const TIPOS_ESPACO_VALIDOS = new Set(["Sala", "Laboratório", "Auditório"]);

function normalizarTipoEspaco(valor: unknown): string | null {
    if (typeof valor !== "string") return null;
    const limpo = valor.trim();
    const lower = limpo.toLowerCase();
    if (lower === "sala") return "Sala";
    if (lower === "laboratório" || lower === "laboratorio") return "Laboratório";
    if (lower === "auditório" || lower === "auditorio") return "Auditório";
    return TIPOS_ESPACO_VALIDOS.has(limpo) ? limpo : null;
}

salasRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { alocavel_ic, bloco } = req.query;

        const filtros: { alocavelIc?: boolean; bloco?: string } = {};
        const parsedAlocavel = parseQueryBooleano(alocavel_ic);
        if (parsedAlocavel.definido) {
            if ("invalido" in parsedAlocavel) {
                res.status(400).json({ erro: "Query 'alocavel_ic' deve ser 'true', 'false', '1' ou '0'" });
                return;
            }
            filtros.alocavelIc = parsedAlocavel.valor;
        }
        if (bloco !== undefined) {
            if (typeof bloco !== "string") {
                res.status(400).json({ erro: "Query 'bloco' deve ser uma string" });
                return;
            }
            if (bloco.trim() !== "") {
                filtros.bloco = bloco.trim();
            }
        }

        const salas = await repo.listar(filtros);
        res.json(salas);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao listar salas", "leitura");
    }
});

salasRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const sala = await repo.buscarPorId(id);
        if (!sala) {
            res.status(404).json({ erro: `Sala de id ${id} não encontrada` });
            return;
        }
        res.json(sala);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao buscar sala", "leitura");
    }
});

salasRouter.post("/", async (req: Request, res: Response) => {
    try {
        const { nome, capacidade, tipoEspaco, bloco, alocavelIc } = req.body || {};

        if (typeof nome !== "string" || nome.trim() === "") {
            res.status(400).json({ erro: "Campo 'nome' é obrigatório" });
            return;
        }
        const capNum = parseInteiroPositivoEstrito(capacidade);
        if (capNum === null) {
            res.status(400).json({ erro: "Campo 'capacidade' deve ser um inteiro positivo" });
            return;
        }
        const tipoNormalizado = tipoEspaco === undefined ? "Sala" : normalizarTipoEspaco(tipoEspaco);
        if (!tipoNormalizado) {
            res.status(400).json({ erro: "Campo 'tipoEspaco' deve ser 'Sala', 'Laboratório' ou 'Auditório'" });
            return;
        }
        let blocoLimpo = "IC";
        if (bloco !== undefined) {
            if (typeof bloco !== "string" || bloco.trim() === "") {
                res.status(400).json({ erro: "Campo 'bloco' não pode ser vazio" });
                return;
            }
            blocoLimpo = bloco.trim();
        }
        let alocavelBool = true;
        if (alocavelIc !== undefined) {
            const parsed = parseBooleanoEstrito(alocavelIc);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'alocavelIc' deve ser booleano" });
                return;
            }
            alocavelBool = parsed;
        }

        const criada = await repo.criar({
            nome: nome.trim(),
            capacidade: capNum,
            tipoEspaco: tipoNormalizado,
            bloco: blocoLimpo,
            alocavelIc: alocavelBool,
        });
        res.status(201).json(criada);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao criar sala", "escrita");
    }
});

salasRouter.put("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const { nome, capacidade, tipoEspaco, bloco, alocavelIc } = req.body || {};
        const dados: {
            nome?: string;
            capacidade?: number;
            tipoEspaco?: string;
            bloco?: string;
            alocavelIc?: boolean;
        } = {};

        if (nome !== undefined) {
            if (typeof nome !== "string" || nome.trim() === "") {
                res.status(400).json({ erro: "Campo 'nome' não pode ser vazio" });
                return;
            }
            dados.nome = nome.trim();
        }
        if (capacidade !== undefined) {
            const capNum = parseInteiroPositivoEstrito(capacidade);
            if (capNum === null) {
                res.status(400).json({ erro: "Campo 'capacidade' deve ser um inteiro positivo" });
                return;
            }
            dados.capacidade = capNum;
        }
        if (tipoEspaco !== undefined) {
            const tipoNormalizado = normalizarTipoEspaco(tipoEspaco);
            if (!tipoNormalizado) {
                res.status(400).json({ erro: "Campo 'tipoEspaco' deve ser 'Sala', 'Laboratório' ou 'Auditório'" });
                return;
            }
            dados.tipoEspaco = tipoNormalizado;
        }
        if (bloco !== undefined) {
            if (typeof bloco !== "string" || bloco.trim() === "") {
                res.status(400).json({ erro: "Campo 'bloco' não pode ser vazio" });
                return;
            }
            dados.bloco = bloco.trim();
        }
        if (alocavelIc !== undefined) {
            const parsed = parseBooleanoEstrito(alocavelIc);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'alocavelIc' deve ser booleano" });
                return;
            }
            dados.alocavelIc = parsed;
        }

        const atualizada = await repo.atualizar(id, dados);
        if (!atualizada) {
            res.status(404).json({ erro: `Sala de id ${id} não encontrada` });
            return;
        }
        res.json(atualizada);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao atualizar sala", "escrita");
    }
});

salasRouter.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const removida = await repo.deletar(id);
        if (!removida) {
            res.status(404).json({ erro: `Sala de id ${id} não encontrada` });
            return;
        }
        res.status(204).end();
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao remover sala", "remocao");
    }
});
