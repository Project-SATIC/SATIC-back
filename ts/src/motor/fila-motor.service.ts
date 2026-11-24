import { randomUUID } from "node:crypto";
import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import {
    bloquearSemestre,
    comTransacao,
    executorPadrao,
    type Executor,
    type ExecutorTransacional,
} from "../db/connection.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../erros.ts";
import {
    executarComContexto,
    logger,
    obterAutorAtual,
    obterContextoRequisicao,
    obterRequestIdAtual,
    type ContextoRequisicao,
} from "../logger.ts";
import { obterConjuntoSlots } from "../shared/horario-sigaa.ts";
import { chaveTurma, type Alocacao, type StatusAlocacao, type Turma } from "../shared/tipos.ts";
import {
    SEMESTRE_PADRAO,
    type OpcoesGeracaoAlocacao,
    type RespostaGeracaoAlocacao,
} from "./alocador.service.ts";
import { executarEmWorker } from "./motor-worker.ts";
import { aplicarRascunho, type MovimentoRascunho } from "./sugestoes.service.ts";
import type { OpcoesSugestao, ResultadoSugestoes } from "./sugestoes.ts";
import type { ResultadoBusca } from "./state-space-search.ts";

export type TipoJobMotor = "gerar" | "sugestoes";
export type StatusJobMotor = "PENDENTE" | "EXECUTANDO" | "CONCLUIDO" | "FALHOU";

export interface JobMotor<R = unknown> {
    jobId: string;
    tipo: TipoJobMotor;
    semestre: string;
    status: StatusJobMotor;
    autor: string;
    requestId: string | null;
    criadoEm: string;
    iniciadoEm: string | null;
    concluidoEm: string | null;
    duracaoMs: number | null;
    resultado?: R;
    erro?: string;
}

interface ItemFilaInterno {
    job: JobMotor;
    contexto: ContextoRequisicao;
    executar: () => Promise<unknown>;
    resolverConclusao: (job: JobMotor) => void;
}

function horarioLegivel(turma: Turma): boolean {
    try {
        return obterConjuntoSlots(turma.horarioSigaa).size > 0;
    } catch {
        return false;
    }
}

export interface OpcoesFilaMotor {
    concorrenciaMaxima?: number;
    limiteHistorico?: number;
    maxPendentes?: number;
    usarWorkerThread?: boolean;
}

export class FilaMotorService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;
    readonly #transacao: ExecutorTransacional;
    readonly #db: Executor;
    readonly #concorrenciaMaxima: number;
    readonly #limiteHistorico: number;
    readonly #maxPendentes: number;
    readonly #usarWorkerThread: boolean;

    readonly #jobs = new Map<string, JobMotor>();
    readonly #promessasConclusao = new Map<string, Promise<JobMotor>>();
    readonly #filaPendentes: ItemFilaInterno[] = [];
    #ativos = 0;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository(),
        transacao: ExecutorTransacional = comTransacao,
        db: Executor = executorPadrao,
        opcoes: OpcoesFilaMotor = {},
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;
        this.#transacao = transacao;
        this.#db = db;
        this.#concorrenciaMaxima = Math.max(1, opcoes.concorrenciaMaxima ?? 2);
        this.#limiteHistorico = Math.max(10, opcoes.limiteHistorico ?? 100);
        this.#maxPendentes = Math.max(5, opcoes.maxPendentes ?? 50);
        this.#usarWorkerThread = opcoes.usarWorkerThread ?? true;
    }

    enfileirarGeracao(
        opcoes: OpcoesGeracaoAlocacao = {},
        aoPersistir?: (semestre: string) => Promise<void>,
    ): JobMotor<RespostaGeracaoAlocacao> {
        const semestre = opcoes.semestre || SEMESTRE_PADRAO;
        return this.#enfileirar("gerar", semestre, async () => {
            const res = await this.#executarGeracaoWorker(semestre, opcoes);
            if ((opcoes.persistir ?? true) && aoPersistir) {
                await aoPersistir(semestre);
            }
            return res;
        }) as JobMotor<RespostaGeracaoAlocacao>;
    }

    enfileirarSugestoes(
        semestre: string,
        opcoes: OpcoesSugestao = {},
        movimentos: readonly MovimentoRascunho[] = [],
    ): JobMotor<ResultadoSugestoes & { semestre: string }> {
        return this.#enfileirar("sugestoes", semestre, () =>
            this.#executarSugestoesWorker(semestre, opcoes, movimentos),
        ) as JobMotor<ResultadoSugestoes & { semestre: string }>;
    }

    buscarJob(jobId: string): JobMotor | null {
        return this.#jobs.get(jobId) ?? null;
    }

    /** Aguarda a conclusão de um job específico (útil em testes e integrações). */
    async aguardarJob(jobId: string): Promise<JobMotor | null> {
        const p = this.#promessasConclusao.get(jobId);
        if (p) return p;
        return this.buscarJob(jobId);
    }

    listarJobs(filtros: { semestre?: string; status?: StatusJobMotor } = {}): JobMotor[] {
        const todos = [...this.#jobs.values()].reverse();
        return todos.filter((j) => {
            if (filtros.semestre && j.semestre !== filtros.semestre) return false;
            if (filtros.status && j.status !== filtros.status) return false;
            return true;
        });
    }

    #enfileirar(tipo: TipoJobMotor, semestre: string, executar: () => Promise<unknown>): JobMotor {
        if (this.#filaPendentes.length >= this.#maxPendentes) {
            throw new ErroRequisicao(`Fila do motor cheia (${this.#maxPendentes} tarefas pendentes). Tente novamente em instantes.`);
        }

        const ctxAtual = obterContextoRequisicao();
        const jobId = randomUUID();
        const autor = obterAutorAtual();
        const requestId = obterRequestIdAtual();

        const job: JobMotor = {
            jobId,
            tipo,
            semestre,
            status: "PENDENTE",
            autor,
            requestId,
            criadoEm: new Date().toISOString(),
            iniciadoEm: null,
            concluidoEm: null,
            duracaoMs: null,
        };

        const contexto: ContextoRequisicao = ctxAtual ?? {
            requestId: requestId ?? jobId,
            autor,
            iniciadoEmMs: performance.now(),
        };

        let resolverConclusao!: (j: JobMotor) => void;
        const promessa = new Promise<JobMotor>((resolve) => {
            resolverConclusao = resolve;
        });

        this.#jobs.set(jobId, job);
        this.#promessasConclusao.set(jobId, promessa);
        this.#podarHistorico();

        this.#filaPendentes.push({ job, contexto, executar, resolverConclusao });
        logger.info("job_motor_enfileirado", { jobId, tipo, semestre });

        queueMicrotask(() => this.#processarFila());
        return { ...job };
    }

    #processarFila(): void {
        while (this.#ativos < this.#concorrenciaMaxima && this.#filaPendentes.length > 0) {
            const item = this.#filaPendentes.shift()!;
            this.#ativos++;
            const inicio = performance.now();
            item.job.status = "EXECUTANDO";
            item.job.iniciadoEm = new Date().toISOString();

            executarComContexto(item.contexto, async () => {
                try {
                    const resultado = await item.executar();
                    item.job.status = "CONCLUIDO";
                    item.job.resultado = resultado;
                    item.job.concluidoEm = new Date().toISOString();
                    item.job.duracaoMs = Number((performance.now() - inicio).toFixed(2));
                    logger.info("job_motor_concluido", {
                        jobId: item.job.jobId,
                        tipo: item.job.tipo,
                        semestre: item.job.semestre,
                        duracaoMs: item.job.duracaoMs,
                    });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    item.job.status = "FALHOU";
                    item.job.erro = msg;
                    item.job.concluidoEm = new Date().toISOString();
                    item.job.duracaoMs = Number((performance.now() - inicio).toFixed(2));
                    logger.error("job_motor_falhou", {
                        jobId: item.job.jobId,
                        tipo: item.job.tipo,
                        semestre: item.job.semestre,
                        erro: msg,
                        duracaoMs: item.job.duracaoMs,
                    });
                } finally {
                    this.#ativos--;
                    item.resolverConclusao(item.job);
                    this.#processarFila();
                }
            });
        }
    }

    #podarHistorico(): void {
        if (this.#jobs.size <= this.#limiteHistorico) return;
        for (const [id, job] of this.#jobs) {
            if (this.#jobs.size <= this.#limiteHistorico) break;
            if (job.status === "CONCLUIDO" || job.status === "FALHOU") {
                this.#jobs.delete(id);
                this.#promessasConclusao.delete(id);
            }
        }
    }

    async #executarGeracaoWorker(
        semestre: string,
        opcoes: OpcoesGeracaoAlocacao,
    ): Promise<RespostaGeracaoAlocacao> {
        const persistir = opcoes.persistir ?? true;
        if (persistir) {
            return this.#transacao(async (db) => {
                await bloquearSemestre(db, semestre);
                return this.#gerarInterno(semestre, opcoes, true, db);
            });
        }
        return this.#gerarInterno(semestre, opcoes, false, this.#db);
    }

    async #gerarInterno(
        semestre: string,
        opcoes: OpcoesGeracaoAlocacao,
        persistir: boolean,
        db: Executor,
    ): Promise<RespostaGeracaoAlocacao> {
        const preservarDefinitivas = opcoes.preservarDefinitivas ?? true;
        const semSalas = new Set((opcoes.semSalas || []).map((s) => s.trim().toLowerCase()));

        const todasTurmas = await this.#turmaRepo.listarPorSemestre(semestre, db);
        if (todasTurmas.length === 0) {
            throw new ErroNaoEncontrado(
                `Nenhuma turma encontrada no banco para o semestre '${semestre}'. Execute o seed primeiro ('npm run db:seed').`,
            );
        }

        let salasAlocaveis = await this.#salaRepo.listarAlocaveisPeloIc(db);
        if (semSalas.size > 0) {
            salasAlocaveis = salasAlocaveis.filter((s) => !semSalas.has(s.nome.toLowerCase()));
        }

        const statusPreservados = new Set<StatusAlocacao>(
            preservarDefinitivas ? ["EXTERNA_FIXA", "DEFINITIVA"] : ["EXTERNA_FIXA"],
        );
        const existentes = await this.#alocacaoRepo.listarPorSemestre(semestre, db);
        const preservadas = existentes.filter((a) => statusPreservados.has(a.status));
        const turmasPreservadas = new Set(preservadas.map((a) => a.turma.id));

        const turmasParaAlocar: Turma[] = [];
        const horariosInvalidos: Turma[] = [];
        for (const t of todasTurmas) {
            if (!t.requerAlocacaoIc || turmasPreservadas.has(t.id)) continue;
            if (horarioLegivel(t)) turmasParaAlocar.push(t);
            else horariosInvalidos.push(t);
        }

        const resultado = await executarEmWorker<ResultadoBusca>({
            tipo: "gerar",
            turmasParaAlocar,
            salasAlocaveis,
            preservadas,
            maxNos: opcoes.limiteNos,
        });

        if (persistir) {
            const statusRemovidos: StatusAlocacao[] = preservarDefinitivas
                ? ["RASCUNHO"]
                : ["RASCUNHO", "DEFINITIVA"];
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

    async #executarSugestoesWorker(
        semestre: string,
        opcoes: OpcoesSugestao,
        movimentos: readonly MovimentoRascunho[],
    ): Promise<ResultadoSugestoes & { semestre: string }> {
        const turmas = await this.#turmaRepo.listarPorSemestre(semestre, this.#db);
        if (turmas.length === 0) {
            throw new ErroNaoEncontrado(`Nenhuma turma encontrada para o semestre '${semestre}'`);
        }
        const salas = await this.#salaRepo.listarAlocaveisPeloIc(this.#db);
        let alocacoes: Alocacao[] = await this.#alocacaoRepo.listarPorSemestre(semestre, this.#db);
        if (movimentos.length > 0) {
            const todasSalas = await this.#salaRepo.listarTodas(this.#db);
            alocacoes = aplicarRascunho(turmas, todasSalas, alocacoes, movimentos);
        }

        const res = await executarEmWorker<ResultadoSugestoes>({
            tipo: "sugestoes",
            turmas,
            salas,
            alocacoes,
            opcoes,
        });
        return { semestre, ...res };
    }
}
