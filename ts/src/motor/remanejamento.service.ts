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

export class RemanejamentoService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository()
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;
    }

    async validar(req: RequisicaoValidacao): Promise<ResultadoValidacao> {
        if (!req.turmaId || Number.isNaN(Number(req.turmaId))) {
            throw new Error("turmaId é obrigatório e deve ser numérico");
        }
        if (!req.salaId || Number.isNaN(Number(req.salaId))) {
            throw new Error("salaId é obrigatório e deve ser numérico");
        }

        const turma = await this.#turmaRepo.buscarPorId(Number(req.turmaId));
        if (!turma) {
            throw new Error(`Turma de ID ${req.turmaId} não encontrada`);
        }

        const sala = await this.#salaRepo.buscarPorId(Number(req.salaId));
        if (!sala) {
            throw new Error(`Sala de ID ${req.salaId} não encontrada`);
        }

        const horario = req.horario && req.horario.trim() !== "" ? req.horario.trim() : turma.horarioSigaa;
        const semestre = req.semestre || turma.semestre;

        // Busca alocações salvas no semestre para checar choques de sala e docentes
        const alocacoesAtuais = await this.#alocacaoRepo.listarPorSemestre(semestre);

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
        const validacao = await this.validar({
            turmaId: req.turmaId,
            salaId: req.salaId,
            horario: req.horario,
        });

        if (!validacao.valida) {
            return {
                sucesso: false,
                mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                violacoes: validacao.violacoes,
            };
        }

        const turma = (await this.#turmaRepo.buscarPorId(Number(req.turmaId)))!;
        const sala = (await this.#salaRepo.buscarPorId(Number(req.salaId)))!;
        const status = req.status || "DEFINITIVA";
        const horario = validacao.horario;

        // Confere se já existe alocação registrada para a turma movida
        const alocacaoExistente = await this.#alocacaoRepo.buscarPorTurmaId(turma.id!);

        if (alocacaoExistente && alocacaoExistente.id != null) {
            // Atualiza SOMENTE a turma movida (as demais turmas não são alteradas)
            await this.#alocacaoRepo.atualizarSalaEHorario(alocacaoExistente.id, sala.id!, horario, status);
            return {
                sucesso: true,
                mensagem: "Alocação remanejada e atualizada com sucesso.",
                alocacao: {
                    ...alocacaoExistente,
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
        const salva = await this.#alocacaoRepo.inserir(novaAlocacao);

        return {
            sucesso: true,
            mensagem: "Alocação confirmada e salva com sucesso.",
            alocacao: salva,
        };
    }
}
