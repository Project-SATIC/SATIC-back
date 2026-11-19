import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";
import { AlocadorService, SEMESTRE_PADRAO } from "../../motor/alocador.service.ts";
import { RemanejamentoService } from "../../motor/remanejamento.service.ts";
import { MAX_NOS_BUSCA } from "../../motor/state-space-search.ts";
import {
    lerBooleanoOpcional,
    lerCorpo,
    lerInteiroOpcional,
    lerListaDeTextosOpcional,
    lerSemestre,
} from "../../entrada.ts";

/** Teto do limite de nós aceito pela API (10x o padrão do motor) para uma requisição não travar o servidor. */
export const LIMITE_NOS_MAXIMO_API = MAX_NOS_BUSCA * 10;

export interface ServicosAlocacao {
    alocacaoRepo: Pick<AlocacaoRepository, "listarPorSemestre" | "listarTodas">;
    alocador: Pick<AlocadorService, "gerarAlocacao">;
    remanejamento: Pick<RemanejamentoService, "validar" | "confirmar">;
}

/** Erros lançados nos handlers (ErroHttp, JSON inválido etc.) seguem para o handler global em app.ts. */
export function criarAlocacoesRouter(servicos: Partial<ServicosAlocacao> = {}): Router {
    const alocacaoRepo = servicos.alocacaoRepo ?? new AlocacaoRepository();
    const alocador = servicos.alocador ?? new AlocadorService();
    const remanejamento = servicos.remanejamento ?? new RemanejamentoService();
    const router = Router();

    router.get("/", async (req: Request, res: Response) => {
        const semestre = typeof req.query.semestre === "string" && req.query.semestre.trim() !== ""
            ? lerSemestre(req.query.semestre)
            : undefined;
        res.json(semestre ? await alocacaoRepo.listarPorSemestre(semestre) : await alocacaoRepo.listarTodas());
    });

    router.post("/gerar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const resultado = await alocador.gerarAlocacao({
            semestre: lerSemestre(body.semestre, SEMESTRE_PADRAO),
            persistir: lerBooleanoOpcional(body.persistir, "persistir") ?? true,
            limiteNos: lerInteiroOpcional(body.limiteNos, "limiteNos", 1, LIMITE_NOS_MAXIMO_API),
            semSalas: lerListaDeTextosOpcional(body.semSalas, "semSalas"),
            preservarDefinitivas: lerBooleanoOpcional(body.preservarDefinitivas, "preservarDefinitivas") ?? true,
        });
        res.json(resultado);
    });

    router.post("/validar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        res.json(await remanejamento.validar({ turmaId: body.turmaId, salaId: body.salaId, horario: body.horario }));
    });

    router.post("/confirmar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const resultado = await remanejamento.confirmar({
            turmaId: body.turmaId,
            salaId: body.salaId,
            horario: body.horario,
            status: body.status,
        });
        res.status(resultado.sucesso ? 200 : 409).json(resultado);
    });

    return router;
}
