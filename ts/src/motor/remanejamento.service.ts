import { comTransacao, type QueryExecutor } from "../db/connection.ts";
import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { ErroConflito, ErroNaoEncontrado, ErroValidacao } from "../shared/erros.ts";
import { obterConjuntoSlots } from "../shared/horario-sigaa.ts";
import { diagnosticarViolacoes, type Violacao } from "../shared/validador.ts";
import type { Alocacao, StatusAlocacao } from "../shared/tipos.ts";

const MAX_PG_INT4 = 2147483647;

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

        if (req.semestre !== undefined && (typeof req.semestre !== "string" || req.semestre.trim() === "")) {
            throw new ErroValidacao("Campo 'semestre' deve ser uma string não vazia");
        }

        const turma = await this.#turmaRepo.buscarPorId(turmaId, executor);
        if (!turma) {
            throw new ErroNaoEncontrado(`Turma de ID ${req.turmaId} não encontrada`);
        }

        const sala = await this.#salaRepo.buscarPorId(salaId, executor);
        if (!sala) {
            throw new ErroNaoEncontrado(`Sala de ID ${req.salaId} não encontrada`);
        }

        const horario = this.resolverEValidarHorario(req.horario, turma.horarioSigaa);
        const semestre = (req.semestre ? req.semestre.trim() : turma.semestre.trim());

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
        const status = this.validarStatusConfirmacao(req.status);

        return this.#executarTransacao(async (tx) => {
            const turma = await this.#turmaRepo.buscarPorId(turmaId, tx);
            if (!turma) {
                throw new ErroNaoEncontrado(`Turma de ID ${req.turmaId} não encontrada`);
            }

            const sala = await this.#salaRepo.buscarPorId(salaId, tx);
            if (!sala) {
                throw new ErroNaoEncontrado(`Sala de ID ${req.salaId} não encontrada`);
            }

            const horario = this.resolverEValidarHorario(req.horario, turma.horarioSigaa);
            const semestre = turma.semestre.trim();

            if (tx) {
                await tx.query("SELECT pg_advisory_xact_lock(hashtext($1));", [`satic:alocacao:${semestre}`]);
            }

            const alocacaoExistente = await this.#alocacaoRepo.buscarPorTurmaId(turma.id!, tx);
            if (alocacaoExistente?.status === "EXTERNA_FIXA") {
                throw new ErroConflito("Alocações com status EXTERNA_FIXA não podem ser alteradas via API.");
            }

            const alocacoesAtuais = await this.#alocacaoRepo.listarPorSemestre(semestre, tx);
            const violacoes = diagnosticarViolacoes(turma, sala, alocacoesAtuais, horario);

            if (violacoes.length > 0) {
                return {
                    sucesso: false,
                    mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                    violacoes,
                };
            }

            if (alocacaoExistente && alocacaoExistente.id != null) {
                // Atualiza SOMENTE a turma movida (as demais turmas não são alteradas)
                let atualizado: boolean;
                let atualizadoEm: string | null = null;

                if (typeof this.#alocacaoRepo.atualizarComTimestamp === "function") {
                    const resUpdate = await this.#alocacaoRepo.atualizarComTimestamp(
                        alocacaoExistente.id,
                        sala.id!,
                        horario,
                        status,
                        tx
                    );
                    atualizado = resUpdate.atualizado;
                    atualizadoEm = resUpdate.atualizadoEm;
                } else {
                    atualizado = await this.#alocacaoRepo.atualizarSalaEHorario(
                        alocacaoExistente.id,
                        sala.id!,
                        horario,
                        status,
                        tx
                    );
                }

                if (!atualizado) {
                    throw new ErroConflito("A alocação não pôde ser atualizada pois foi removida concorrentemente.");
                }

                return {
                    sucesso: true,
                    mensagem: "Alocação remanejada e atualizada com sucesso.",
                    alocacao: {
                        ...alocacaoExistente,
                        turma,
                        sala,
                        horarioCodigo: horario,
                        status,
                        atualizadoEm: atualizadoEm ?? alocacaoExistente.atualizadoEm ?? new Date().toISOString(),
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

    private validarIds(turmaIdRaw: unknown, salaIdRaw: unknown): { turmaId: number; salaId: number } {
        const turmaId = this.parseIdEstrito(turmaIdRaw);
        if (turmaId === null) {
            throw new ErroValidacao("turmaId é obrigatório e deve ser um inteiro positivo");
        }
        const salaId = this.parseIdEstrito(salaIdRaw);
        if (salaId === null) {
            throw new ErroValidacao("salaId é obrigatório e deve ser um inteiro positivo");
        }
        return { turmaId, salaId };
    }

    private parseIdEstrito(valor: unknown): number | null {
        if (typeof valor === "number") {
            return Number.isInteger(valor) && valor > 0 && valor <= MAX_PG_INT4 ? valor : null;
        }
        if (typeof valor === "string") {
            const limpo = valor.trim();
            if (!/^\d+$/.test(limpo)) return null;
            const n = Number(limpo);
            return Number.isSafeInteger(n) && n > 0 && n <= MAX_PG_INT4 ? n : null;
        }
        return null;
    }

    private resolverEValidarHorario(horarioRaw: unknown, fallback: string): string {
        if (horarioRaw !== undefined && typeof horarioRaw !== "string") {
            throw new ErroValidacao("Campo 'horario' deve ser uma string no formato SIGAA");
        }
        const escolhido = (horarioRaw && horarioRaw.trim() !== "" ? horarioRaw : fallback).trim().toUpperCase();
        if (escolhido === "") {
            throw new ErroValidacao("Campo 'horario' não pode ser vazio");
        }
        try {
            const slots = obterConjuntoSlots(escolhido);
            if (slots.size === 0) {
                throw new ErroValidacao(`Horário SIGAA inválido: '${escolhido}'`);
            }
        } catch (err: unknown) {
            if (err instanceof ErroValidacao) throw err;
            throw new ErroValidacao(err instanceof Error ? err.message : `Horário SIGAA inválido: '${escolhido}'`);
        }
        return escolhido;
    }

    private validarStatusConfirmacao(statusRaw: unknown): StatusAlocacao {
        if (statusRaw === undefined) {
            return "DEFINITIVA";
        }
        if (typeof statusRaw !== "string") {
            throw new ErroValidacao("Campo 'status' deve ser 'RASCUNHO' ou 'DEFINITIVA'");
        }
        const normalizado = statusRaw.trim().toUpperCase();
        if (normalizado === "EXTERNA_FIXA") {
            throw new ErroConflito("Não é permitido atribuir status EXTERNA_FIXA via confirmação.");
        }
        if (normalizado !== "RASCUNHO" && normalizado !== "DEFINITIVA") {
            throw new ErroValidacao("Campo 'status' deve ser 'RASCUNHO' ou 'DEFINITIVA'");
        }
        return normalizado;
    }
}
