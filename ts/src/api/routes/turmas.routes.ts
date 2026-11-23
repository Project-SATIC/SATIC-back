import { Router, type Request, type Response } from "express";
import {
    DisciplinaRepository,
    TurmaRepository,
    type DadosAtualizacaoTurma,
} from "../../db/repositories/index.ts";
import { obterConjuntoSlots } from "../../shared/horario-sigaa.ts";
import { responderErroBanco } from "../pg-errors.ts";
import {
    parseBooleanoEstrito,
    parseIdParam,
    parseInteiroNaoNegativoEstrito,
    parseInteiroPositivoEstrito,
    parseQueryBooleano,
} from "../validation.ts";

export const turmasRouter = Router();
const repo = new TurmaRepository();
const discRepo = new DisciplinaRepository();

function parseProfessoresPayload(
    raw: unknown
): { matriculaSiape: string; cargaHoraria?: number }[] | null {
    if (!Array.isArray(raw)) return null;
    const resultado: { matriculaSiape: string; cargaHoraria?: number }[] = [];
    for (const item of raw) {
        if (typeof item === "string" && item.trim() !== "") {
            resultado.push({ matriculaSiape: item.trim() });
            continue;
        }
        if (item && typeof item === "object") {
            const obj = item as { matriculaSiape?: unknown; cargaHoraria?: unknown };
            if (typeof obj.matriculaSiape !== "string" || obj.matriculaSiape.trim() === "") {
                return null;
            }
            if (obj.cargaHoraria !== undefined) {
                const ch = parseInteiroPositivoEstrito(obj.cargaHoraria);
                if (ch === null) return null;
                resultado.push({ matriculaSiape: obj.matriculaSiape.trim(), cargaHoraria: ch });
            } else {
                resultado.push({ matriculaSiape: obj.matriculaSiape.trim() });
            }
            continue;
        }
        return null;
    }
    return resultado;
}

turmasRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { semestre, requer_ic } = req.query;

        const filtros: { semestre?: string; requerAlocacaoIc?: boolean } = {};
        if (semestre !== undefined) {
            if (typeof semestre !== "string") {
                res.status(400).json({ erro: "Query 'semestre' deve ser uma string" });
                return;
            }
            if (semestre.trim() !== "") {
                filtros.semestre = semestre.trim();
            }
        }
        const parsedRequerIc = parseQueryBooleano(requer_ic);
        if (parsedRequerIc.definido) {
            if ("invalido" in parsedRequerIc) {
                res.status(400).json({ erro: "Query 'requer_ic' deve ser 'true', 'false', '1' ou '0'" });
                return;
            }
            filtros.requerAlocacaoIc = parsedRequerIc.valor;
        }

        const turmas = await repo.listar(filtros);
        res.json(turmas);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao listar turmas", "leitura");
    }
});

turmasRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const turma = await repo.buscarPorId(id);
        if (!turma) {
            res.status(404).json({ erro: `Turma de id ${id} não encontrada` });
            return;
        }
        res.json(turma);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao buscar turma", "leitura");
    }
});

turmasRouter.post("/", async (req: Request, res: Response) => {
    try {
        const {
            disciplinaCodigo,
            codigoTurma,
            semestre,
            cursosOfertados,
            vagas,
            matriculados,
            requerAlocacaoIc,
            horarioSigaa,
            professores,
        } = req.body || {};

        if (typeof disciplinaCodigo !== "string" || disciplinaCodigo.trim() === "") {
            res.status(400).json({ erro: "Campo 'disciplinaCodigo' é obrigatório" });
            return;
        }
        if (typeof codigoTurma !== "string" || codigoTurma.trim() === "") {
            res.status(400).json({ erro: "Campo 'codigoTurma' é obrigatório" });
            return;
        }
        if (typeof semestre !== "string" || semestre.trim() === "") {
            res.status(400).json({ erro: "Campo 'semestre' é obrigatório" });
            return;
        }
        if (typeof cursosOfertados !== "string" || cursosOfertados.trim() === "") {
            res.status(400).json({ erro: "Campo 'cursosOfertados' é obrigatório" });
            return;
        }
        if (typeof horarioSigaa !== "string" || horarioSigaa.trim() === "") {
            res.status(400).json({ erro: "Campo 'horarioSigaa' é obrigatório" });
            return;
        }
        try {
            obterConjuntoSlots(horarioSigaa.trim());
        } catch (e: unknown) {
            res.status(400).json({
                erro: "Campo 'horarioSigaa' inválido",
                detalhes: e instanceof Error ? e.message : String(e),
            });
            return;
        }

        const vagasNum = parseInteiroNaoNegativoEstrito(vagas);
        const matNum = matriculados === undefined ? 0 : parseInteiroNaoNegativoEstrito(matriculados);
        if (vagasNum === null) {
            res.status(400).json({ erro: "Campo 'vagas' deve ser um inteiro maior ou igual a 0" });
            return;
        }
        if (matNum === null) {
            res.status(400).json({ erro: "Campo 'matriculados' deve ser um inteiro maior ou igual a 0" });
            return;
        }

        let requerIcBool = true;
        if (requerAlocacaoIc !== undefined) {
            const parsed = parseBooleanoEstrito(requerAlocacaoIc);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'requerAlocacaoIc' deve ser booleano" });
                return;
            }
            requerIcBool = parsed;
        }

        const profsParsed = professores === undefined ? [] : parseProfessoresPayload(professores);
        if (profsParsed === null) {
            res.status(400).json({ erro: "Campo 'professores' inválido" });
            return;
        }

        const disciplina = await discRepo.buscarPorCodigo(disciplinaCodigo.trim().toUpperCase());
        if (!disciplina) {
            res.status(400).json({ erro: `Disciplina '${disciplinaCodigo}' não encontrada` });
            return;
        }

        const cargaHorariaPorDocente: Record<string, number> = {};
        for (const p of profsParsed) {
            cargaHorariaPorDocente[p.matriculaSiape] = p.cargaHoraria ?? disciplina.cargaHoraria;
        }

        const criada = await repo.criar({
            disciplina,
            codigoTurma: codigoTurma.trim(),
            semestre: semestre.trim(),
            cursosOfertados: cursosOfertados.trim(),
            vagas: vagasNum,
            matriculados: matNum,
            requerAlocacaoIc: requerIcBool,
            horarioSigaa: horarioSigaa.trim().toUpperCase(),
            professores: profsParsed.map((p) => ({
                matriculaSiape: p.matriculaSiape,
                nome: "",
                indisponibilidades: [],
            })),
            cargaHorariaPorDocente,
        });

        const hidratada = criada.id != null ? await repo.buscarPorId(criada.id) : criada;
        res.status(201).json(hidratada ?? criada);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao criar turma", "escrita");
    }
});

turmasRouter.put("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const {
            disciplinaCodigo,
            codigoTurma,
            semestre,
            cursosOfertados,
            vagas,
            matriculados,
            requerAlocacaoIc,
            horarioSigaa,
            professores,
        } = req.body || {};

        const dados: DadosAtualizacaoTurma = {};

        if (disciplinaCodigo !== undefined) {
            if (typeof disciplinaCodigo !== "string" || disciplinaCodigo.trim() === "") {
                res.status(400).json({ erro: "Campo 'disciplinaCodigo' não pode ser vazio" });
                return;
            }
            dados.disciplinaCodigo = disciplinaCodigo.trim().toUpperCase();
        }
        if (codigoTurma !== undefined) {
            if (typeof codigoTurma !== "string" || codigoTurma.trim() === "") {
                res.status(400).json({ erro: "Campo 'codigoTurma' não pode ser vazio" });
                return;
            }
            dados.codigoTurma = codigoTurma.trim();
        }
        if (semestre !== undefined) {
            if (typeof semestre !== "string" || semestre.trim() === "") {
                res.status(400).json({ erro: "Campo 'semestre' não pode ser vazio" });
                return;
            }
            dados.semestre = semestre.trim();
        }
        if (cursosOfertados !== undefined) {
            if (typeof cursosOfertados !== "string" || cursosOfertados.trim() === "") {
                res.status(400).json({ erro: "Campo 'cursosOfertados' não pode ser vazio" });
                return;
            }
            dados.cursosOfertados = cursosOfertados.trim();
        }
        if (horarioSigaa !== undefined) {
            if (typeof horarioSigaa !== "string" || horarioSigaa.trim() === "") {
                res.status(400).json({ erro: "Campo 'horarioSigaa' não pode ser vazio" });
                return;
            }
            try {
                obterConjuntoSlots(horarioSigaa.trim());
            } catch (e: unknown) {
                res.status(400).json({
                    erro: "Campo 'horarioSigaa' inválido",
                    detalhes: e instanceof Error ? e.message : String(e),
                });
                return;
            }
            dados.horarioSigaa = horarioSigaa.trim().toUpperCase();
        }
        if (vagas !== undefined) {
            const v = parseInteiroNaoNegativoEstrito(vagas);
            if (v === null) {
                res.status(400).json({ erro: "Campo 'vagas' deve ser um inteiro maior ou igual a 0" });
                return;
            }
            dados.vagas = v;
        }
        if (matriculados !== undefined) {
            const m = parseInteiroNaoNegativoEstrito(matriculados);
            if (m === null) {
                res.status(400).json({ erro: "Campo 'matriculados' deve ser um inteiro maior ou igual a 0" });
                return;
            }
            dados.matriculados = m;
        }
        if (requerAlocacaoIc !== undefined) {
            const parsed = parseBooleanoEstrito(requerAlocacaoIc);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'requerAlocacaoIc' deve ser booleano" });
                return;
            }
            dados.requerAlocacaoIc = parsed;
        }
        if (professores !== undefined) {
            const parsed = parseProfessoresPayload(professores);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'professores' inválido" });
                return;
            }
            dados.professores = parsed;
        }

        const atualizada = await repo.atualizar(id, dados);
        if (!atualizada) {
            res.status(404).json({ erro: `Turma de id ${id} não encontrada` });
            return;
        }
        res.json(atualizada);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao atualizar turma", "escrita");
    }
});

turmasRouter.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const removida = await repo.deletar(id);
        if (!removida) {
            res.status(404).json({ erro: `Turma de id ${id} não encontrada` });
            return;
        }
        res.status(204).end();
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao remover turma", "remocao");
    }
});
