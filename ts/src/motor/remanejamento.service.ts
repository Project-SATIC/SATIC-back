import { comTransacao, type QueryExecutor } from "../db/connection.ts";
import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { diagnosticarViolacoes, type Violacao } from "../shared/validador.ts";
import type { Alocacao, StatusAlocacao } from "../shared/tipos.ts";

export interface RequisicaoValidacao {
    turmaId: number;
    salaId: number;
    horario?: string;
    semestre?: string;
}

export interface ResultadoValidacao {
    valida: boolean;
    turmaId: number;
    salaId: number;
    horario: string;
    violacoes: Violacao[];
}

export interface RequisicaoConfirmacao {
    turmaId: number;
    salaId: number;
    horario?: string;
    status?: StatusAlocacao;
}

export interface ResultadoConfirmacao {
    sucesso: boolean;
    mensagem: string;
    alocacao?: Alocacao;
    violacoes?: Violacao[];
}

export type ExecutorTransacao = <T>(fn: (executor?: QueryExecutor) => Promise<T>) => Promise<T>;

export class RemanejamentoService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;
    readonly #executarTransacao: ExecutorTransacao;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository(),
        executarTransacao?: ExecutorTransacao
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;

        const usaRepositoriosReais =
            turmaRepo instanceof TurmaRepository &&
            salaRepo instanceof SalaRepository &&
            alocacaoRepo instanceof AlocacaoRepository;

        this.#executarTransacao =
            executarTransacao ??
            (usaRepositoriosReais
                ? <T>(fn: (executor?: QueryExecutor) => Promise<T>) => comTransacao((client) => fn(client))
                : <T>(fn: (executor?: QueryExecutor) => Promise<T>) => fn(undefined));
    }

    async validar(req: RequisicaoValidacao, executor?: QueryExecutor): Promise<ResultadoValidacao> {
        const { turmaId, salaId } = this.validarIds(req.turmaId, req.salaId);

        const turma = await this.#turmaRepo.buscarPorId(turmaId, executor);
        if (!turma) {
            throw new Error(`Turma de ID ${req.turmaId} não encontrada`);
        }

        const sala = await this.#salaRepo.buscarPorId(salaId, executor);
        if (!sala) {
            throw new Error(`Sala de ID ${req.salaId} não encontrada`);
        }

        const horario = req.horario && req.horario.trim() !== "" ? req.horario.trim() : turma.horarioSigaa;
        const semestre = req.semestre || turma.semestre;

        // Busca alocações salvas no semestre (com professores hidratados) para checar choques de sala e docentes
        const alocacoesAtuais = await this.#alocacaoRepo.listarPorSemestre(semestre, executor);

        const violacoes = diagnosticarViolacoes(turma, sala, alocacoesAtuais, horario);

        return {
            valida: violacoes.length === 0,
            turmaId: turma.id!,
            salaId: sala.id!,
            horario,
            violacoes,
        };
    }

    async confirmar(req: RequisicaoConfirmacao): Promise<ResultadoConfirmacao> {
        const { turmaId, salaId } = this.validarIds(req.turmaId, req.salaId);

        return this.#executarTransacao(async (tx) => {
            const turma = await this.#turmaRepo.buscarPorId(turmaId, tx);
            if (!turma) {
                throw new Error(`Turma de ID ${req.turmaId} não encontrada`);
            }

            const sala = await this.#salaRepo.buscarPorId(salaId, tx);
            if (!sala) {
                throw new Error(`Sala de ID ${req.salaId} não encontrada`);
            }

            if (tx) {
                await tx.query("SELECT pg_advisory_xact_lock(hashtext($1));", [`satic:alocacao:${turma.semestre}`]);
            }

            const horario = req.horario && req.horario.trim() !== "" ? req.horario.trim() : turma.horarioSigaa;
            const alocacoesAtuais = await this.#alocacaoRepo.listarPorSemestre(turma.semestre, tx);
            const violacoes = diagnosticarViolacoes(turma, sala, alocacoesAtuais, horario);

            if (violacoes.length > 0) {
                return {
                    sucesso: false,
                    mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                    violacoes,
                };
            }

            const status = req.status || "DEFINITIVA";
            const alocacaoExistente = await this.#alocacaoRepo.buscarPorTurmaId(turma.id!, tx);

            if (alocacaoExistente && alocacaoExistente.id != null) {
                // Atualiza SOMENTE a turma movida (as demais turmas não são alteradas)
                await this.#alocacaoRepo.atualizarSalaEHorario(
                    alocacaoExistente.id,
                    sala.id!,
                    horario,
                    status,
                    tx
                );
                return {
                    sucesso: true,
                    mensagem: "Alocação remanejada e atualizada com sucesso.",
                    alocacao: {
                        ...alocacaoExistente,
                        turma,
                        sala,
                        horarioCodigo: horario,
                        status,
                    },
                };
            }

            // Se a turma ainda não estava alocada, insere novo registro
            const novaAlocacao: Alocacao = {
                turma,
                sala,
                horarioCodigo: horario,
                status,
            };
            const salva = await this.#alocacaoRepo.inserir(novaAlocacao, tx);

            return {
                sucesso: true,
                mensagem: "Alocação confirmada e salva com sucesso.",
                alocacao: salva,
            };
        });
    }

    private validarIds(turmaIdRaw: number, salaIdRaw: number): { turmaId: number; salaId: number } {
        if (!turmaIdRaw || Number.isNaN(Number(turmaIdRaw))) {
            throw new Error("turmaId é obrigatório e deve ser numérico");
        }
        if (!salaIdRaw || Number.isNaN(Number(salaIdRaw))) {
            throw new Error("salaId é obrigatório e deve ser numérico");
        }
        return { turmaId: Number(turmaIdRaw), salaId: Number(salaIdRaw) };
    }
}
