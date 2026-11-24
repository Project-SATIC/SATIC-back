import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { bloquearSemestre, comTransacao, executorPadrao, type Executor, type ExecutorTransacional } from "../db/connection.ts";
import { obterConjuntoSlots } from "../shared/horario-sigaa.ts";
import { StateSpaceSearch } from "./state-space-search.ts";
import { chaveTurma } from "../shared/tipos.ts";
import type { Alocacao, StatusAlocacao, Turma } from "../shared/tipos.ts";
import { ErroNaoEncontrado } from "../erros.ts";

export const SEMESTRE_PADRAO = "2026.2";

export interface OpcoesGeracaoAlocacao {
    semestre?: string;
    persistir?: boolean;
    limiteNos?: number;
    semSalas?: string[];
    /**
     * true (padrão): alocações DEFINITIVA (remanejamentos confirmados pela secretaria) entram no motor
     * como pré-existentes e não são recalculadas. false: elas são descartadas e refeitas pelo motor.
     */
    preservarDefinitivas?: boolean;
}

export interface ResumoAlocacaoResponse {
    completo: boolean;
    /** Turmas que o motor tentou alocar nesta execução. */
    totalTurmas: number;
    alocadas: number;
    pendentes: number;
    /** Alocações EXTERNA_FIXA e DEFINITIVA mantidas como estavam. */
    preservadas: number;
    podas: number;
    nosVisitados: number;
    tempoMs: number;
}

export interface RespostaGeracaoAlocacao {
    sucesso: boolean;
    semestre: string;
    persistido: boolean;
    resumo: ResumoAlocacaoResponse;
    alocacoes: Alocacao[];
    preservadas: Alocacao[];
    pendentes: Turma[];
    /** Turmas com horário SIGAA ilegível, deixadas fora da busca (também listadas em `pendentes`). */
    horariosInvalidos: string[];
}

function horarioLegivel(turma: Turma): boolean {
    try {
        return obterConjuntoSlots(turma.horarioSigaa).size > 0;
    } catch {
        return false;
    }
}

export class AlocadorService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;
    readonly #transacao: ExecutorTransacional;
    readonly #db: Executor;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository(),
        transacao: ExecutorTransacional = comTransacao,
        db: Executor = executorPadrao,
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;
        this.#transacao = transacao;
        this.#db = db;
    }

    async gerarAlocacao(opcoes: OpcoesGeracaoAlocacao = {}): Promise<RespostaGeracaoAlocacao> {
        const semestre = opcoes.semestre || SEMESTRE_PADRAO;
        const persistir = opcoes.persistir ?? true;

        // Com persistência, leitura + busca + gravação acontecem sob o lock do semestre,
        // para que um /confirmar concorrente não seja sobrescrito nem gere choque.
        if (persistir) {
            return this.#transacao(async (db) => {
                await bloquearSemestre(db, semestre);
                return this.#gerar(semestre, opcoes, true, db);
            });
        }
        return this.#gerar(semestre, opcoes, false, this.#db);
    }

    async #gerar(semestre: string, opcoes: OpcoesGeracaoAlocacao, persistir: boolean, db: Executor): Promise<RespostaGeracaoAlocacao> {
        const preservarDefinitivas = opcoes.preservarDefinitivas ?? true;
        const semSalas = new Set((opcoes.semSalas || []).map((s) => s.trim().toLowerCase()));

        // 1. Turmas do semestre (com docentes e indisponibilidades hidratados)
        const todasTurmas = await this.#turmaRepo.listarPorSemestre(semestre, db);
        if (todasTurmas.length === 0) {
            throw new ErroNaoEncontrado(`Nenhuma turma encontrada no banco para o semestre '${semestre}'. Execute o seed primeiro ('npm run db:seed').`);
        }

        // 2. Salas do pool do IC, sem as removidas na simulação
        let salasAlocaveis = await this.#salaRepo.listarAlocaveisPeloIc(db);
        if (semSalas.size > 0) {
            salasAlocaveis = salasAlocaveis.filter((s) => !semSalas.has(s.nome.toLowerCase()));
        }

        // 3. Alocações que o motor não deve mexer: reservas EXTERNA_FIXA e, por padrão, as DEFINITIVA
        const statusPreservados = new Set<StatusAlocacao>(preservarDefinitivas ? ["EXTERNA_FIXA", "DEFINITIVA"] : ["EXTERNA_FIXA"]);
        const existentes = await this.#alocacaoRepo.listarPorSemestre(semestre, db);
        const preservadas = existentes.filter((a) => statusPreservados.has(a.status));
        const turmasPreservadas = new Set(preservadas.map((a) => a.turma.id));

        // 4. Turmas para a busca: requerem o IC, ainda não fixadas e com horário legível
        const turmasParaAlocar: Turma[] = [];
        const horariosInvalidos: Turma[] = [];
        for (const t of todasTurmas) {
            if (!t.requerAlocacaoIc || turmasPreservadas.has(t.id)) continue;
            if (horarioLegivel(t)) turmasParaAlocar.push(t);
            else horariosInvalidos.push(t);
        }

        // 5. Busca em espaço de estados (MRV + Best-Fit + recuperação parcial)
        const search = new StateSpaceSearch(turmasParaAlocar, salasAlocaveis, preservadas, {
            maxNos: opcoes.limiteNos,
        });
        const resultado = search.solve();

        // 6. Troca atômica: apaga os rascunhos antigos (e as DEFINITIVA, se não preservadas) e grava os novos
        if (persistir) {
            const statusRemovidos: StatusAlocacao[] = preservarDefinitivas ? ["RASCUNHO"] : ["RASCUNHO", "DEFINITIVA"];
            await this.#alocacaoRepo.limparPorSemestre(semestre, statusRemovidos, db);
            await this.#alocacaoRepo.inserirMuitas(resultado.alocacoes, db);
        }

        const pendentes = [...resultado.turmasPendentes, ...horariosInvalidos];
        return {
            sucesso: true,
            semestre,
            persistido: persistir,
            resumo: {
                completo: resultado.completo && horariosInvalidos.length === 0,
                totalTurmas: turmasParaAlocar.length + horariosInvalidos.length,
                alocadas: resultado.alocacoes.length,
                pendentes: pendentes.length,
                preservadas: preservadas.length,
                podas: resultado.podas,
                nosVisitados: resultado.nosVisitados,
                tempoMs: Number(resultado.tempoMs.toFixed(2)),
            },
            alocacoes: resultado.alocacoes,
            preservadas,
            pendentes,
            horariosInvalidos: horariosInvalidos.map(chaveTurma),
        };
    }
}
