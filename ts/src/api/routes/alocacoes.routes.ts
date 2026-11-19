import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";
import { AlocadorService, SEMESTRE_PADRAO } from "../../motor/alocador.service.ts";
import { RemanejamentoService } from "../../motor/remanejamento.service.ts";
import { MAX_NOS_BUSCA } from "../../motor/state-space-search.ts";
import { SugestoesService, lerMovimentosRascunho } from "../../motor/sugestoes.service.ts";
import { LIMITE_NOS_SUGESTOES } from "../../motor/sugestoes.ts";
import {
    lerBooleanoOpcional,
    lerCorpo,
    lerInteiroOpcional,
    lerListaDeIdsOpcional,
    lerListaDeTextosOpcional,
    lerSemestre,
    lerSemestreOpcionalQuery,
} from "../../entrada.ts";

/** Teto do limite de nós aceito pela API (2x o padrão do motor) para uma requisição não travar o servidor. */
export const LIMITE_NOS_MAXIMO_API = MAX_NOS_BUSCA * 2;

export interface ServicosAlocacao {
    alocacaoRepo: Pick<AlocacaoRepository, "listarPorSemestre" | "listarTodas">;
    alocador: Pick<AlocadorService, "gerarAlocacao">;
    remanejamento: Pick<RemanejamentoService, "validar" | "confirmar" | "confirmarLote">;
    sugestoes: Pick<SugestoesService, "sugerir" | "conflitos">;
}

/** Erros lançados nos handlers (ErroHttp, JSON inválido etc.) seguem para o handler global em app.ts. */
export function criarAlocacoesRouter(servicos: Partial<ServicosAlocacao> = {}): Router {
    const alocacaoRepo = servicos.alocacaoRepo ?? new AlocacaoRepository();
    const alocador = servicos.alocador ?? new AlocadorService();
    const remanejamento = servicos.remanejamento ?? new RemanejamentoService();
    const sugestoes = servicos.sugestoes ?? new SugestoesService();
    const router = Router();

    /** Conflitos e pendências do semestre, como o servidor enxerga (Central de Conflitos). */
    router.get("/conflitos", async (req: Request, res: Response) => {
        res.json(await sugestoes.conflitos(lerSemestre(req.query.semestre, SEMESTRE_PADRAO)));
    });

    /**
     * Motor de sugestões (horário + sala) para os conflitos e pendências. Não grava nada:
     * para aplicar, o front envia as mudanças escolhidas para /confirmar-lote.
     * Corpo: { semestre?, alvos?: turmaId[], permitirMudarFormato?: turmaId[], limiteNos?, maxAlternativas?,
     *          movimentos?: rascunho do front (mesmo formato do /confirmar-lote), aplicado só em memória }
     */
    router.post("/sugestoes", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        res.json(await sugestoes.sugerir(lerSemestre(body.semestre, SEMESTRE_PADRAO), {
            alvos: lerListaDeIdsOpcional(body.alvos, "alvos"),
            permitirMudarFormato: lerListaDeIdsOpcional(body.permitirMudarFormato, "permitirMudarFormato"),
            limiteNos: lerInteiroOpcional(body.limiteNos, "limiteNos", 1, LIMITE_NOS_SUGESTOES * 2),
            maxAlternativas: lerInteiroOpcional(body.maxAlternativas, "maxAlternativas", 0, 10),
        }, lerMovimentosRascunho(body.movimentos)));
    });

    router.get("/", async (req: Request, res: Response) => {
        const semestre = lerSemestreOpcionalQuery(req.query.semestre);
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

    /**
     * "Confirmar tudo" do rascunho do front: { movimentos: [{ turmaId, salaId?, horario?, status?, acao? }] }.
     * 200 quando todos foram aceitos; 207 (Multi-Status) quando parte foi recusada; 409 quando nenhum foi.
     */
    router.post("/confirmar-lote", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const resultado = await remanejamento.confirmarLote(body.movimentos);
        const status = resultado.recusados === 0 ? 200 : resultado.aceitos === 0 ? 409 : 207;
        res.status(status).json(resultado);
    });

    // ---------------------------------------------------------------------------------------------
    // Rotas reservadas (ainda não implementadas). Hoje o front faz isso só na sessão do navegador.
    // Decisão de 19/11/2026: deixar aqui o lembrete do que falta no back.
    //
    // Motor de sugestões: falta ainda a etapa "mudar o HORÁRIO de outras turmas" (hoje a etapa C só
    //   troca a sala de uma outra turma) e as preferências de docente ("preferencial") como critério.
    //
    // POST /api/alocacoes/publicar        { semestre }
    //   Consolida a grade do semestre (marca como publicada, congela as DEFINITIVA) para enviar ao SIGAA.
    //
    // GET  /api/alocacoes/exportar?semestre=&formato=ics|csv|pdf
    //   Exportação gerada no servidor. Hoje ICS, CSV e PDF da grade oficial (impressão) são
    //   gerados no navegador. "Grade por professor (PDF)" e "Planilha SIAP (XLSX)" estão pendentes
    //   / fora do escopo atual (não implementadas).
    // ---------------------------------------------------------------------------------------------

    return router;
}
