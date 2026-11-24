/**
 * Carrega turmas, salas e alocações do semestre e chama o motor de sugestões (sugestoes.ts).
 * Só leitura: aplicar uma sugestão é enviar as mudanças para POST /api/alocacoes/confirmar-lote.
 */
import { AlocacaoRepository, SalaRepository, TurmaRepository } from "../db/repositories/index.ts";
import { executorPadrao, type Executor } from "../db/connection.ts";
import { ErroNaoEncontrado } from "../erros.ts";
import { LIMITE_MOVIMENTOS_LOTE } from "./remanejamento.service.ts";
import { sugerirResolucoes, type OpcoesSugestao, type ResultadoSugestoes } from "./sugestoes.ts";
import { ErroRequisicao } from "../erros.ts";
import { lerHorarioOpcional, lerId } from "../entrada.ts";
import { mesmaTurma } from "../shared/tipos.ts";
import type { Alocacao, Sala, Turma } from "../shared/tipos.ts";

export interface MovimentoRascunho {
    turmaId: number;
    salaId?: number;
    horario?: string;
    acao?: "mover" | "remover";
}

/** Lê os movimentos do rascunho enviados pelo front (mesmo formato do /confirmar-lote). */
export function lerMovimentosRascunho(valor: unknown): MovimentoRascunho[] {
    if (valor == null) return [];
    if (!Array.isArray(valor)) throw new ErroRequisicao("movimentos deve ser uma lista");
    if (valor.length > LIMITE_MOVIMENTOS_LOTE) {
        throw new ErroRequisicao(`no máximo ${LIMITE_MOVIMENTOS_LOTE} movimentos no rascunho`);
    }
    return valor.map((m, i) => {
        const item = (m ?? {}) as Record<string, unknown>;
        if (item.acao != null && item.acao !== "mover" && item.acao !== "remover") {
            throw new ErroRequisicao(`movimentos[${i}].acao deve ser "mover" ou "remover"`);
        }
        try {
            const acao = item.acao === "remover" ? "remover" : "mover";
            return {
                turmaId: lerId(item.turmaId, "turmaId"),
                salaId: item.salaId != null && item.salaId !== "" ? lerId(item.salaId, "salaId") : undefined,
                horario: lerHorarioOpcional(item.horario),
                acao,
            };
        } catch (err) {
            if (err instanceof ErroRequisicao) throw new ErroRequisicao(`movimentos[${i}]: ${err.message}`);
            throw err;
        }
    });
}

/** Alocações como ficariam com o rascunho aplicado (só em memória). */
export function aplicarRascunho(
    turmas: readonly Turma[], salas: readonly Sala[], alocacoes: readonly Alocacao[], movimentos: readonly MovimentoRascunho[],
): Alocacao[] {
    let resultado = [...alocacoes];
    for (const m of movimentos) {
        const turma = turmas.find((t) => t.id === m.turmaId);
        if (!turma) continue;
        const atual = resultado.find((a) => mesmaTurma(a.turma, turma));
        resultado = resultado.filter((a) => a !== atual);
        if (m.acao === "remover") continue;
        const sala = m.salaId != null ? salas.find((s) => s.id === m.salaId) : atual?.sala;
        const horario = m.horario ?? atual?.horarioCodigo ?? turma.horarioSigaa;
        if (!sala || !horario) continue; // sem sala: vira pendente para o motor
        resultado.push({ id: atual?.id ?? null, turma, sala, horarioCodigo: horario, status: atual?.status === "EXTERNA_FIXA" ? "EXTERNA_FIXA" : "RASCUNHO" });
    }
    return resultado;
}

export class SugestoesService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;
    readonly #db: Executor;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository(),
        db: Executor = executorPadrao,
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;
        this.#db = db;
    }

    /**
     * @param movimentos rascunho do front ainda não confirmado: aplicado só em memória antes da busca,
     *   para o motor enxergar os conflitos que a secretaria criou no navegador. Nada é gravado.
     */
    async sugerir(semestre: string, opcoes: OpcoesSugestao = {}, movimentos: readonly MovimentoRascunho[] = []): Promise<ResultadoSugestoes & { semestre: string }> {
        const turmas = await this.#turmaRepo.listarPorSemestre(semestre, this.#db);
        if (turmas.length === 0) throw new ErroNaoEncontrado(`Nenhuma turma encontrada para o semestre '${semestre}'`);
        const salas = await this.#salaRepo.listarAlocaveisPeloIc(this.#db);
        let alocacoes = await this.#alocacaoRepo.listarPorSemestre(semestre, this.#db);
        if (movimentos.length > 0) {
            const todasSalas = await this.#salaRepo.listarTodas(this.#db);
            alocacoes = aplicarRascunho(turmas, todasSalas, alocacoes, movimentos);
        }
        return { semestre, ...sugerirResolucoes(turmas, salas, alocacoes, opcoes) };
    }

    /** Só o diagnóstico (conflitos e pendências), sem rodar a busca. */
    async conflitos(semestre: string): Promise<Pick<ResultadoSugestoes, "conflitos" | "pendentes"> & { semestre: string }> {
        const r = await this.sugerir(semestre, { alvos: [], maxAlternativas: 0 });
        return { semestre, conflitos: r.conflitos, pendentes: r.pendentes };
    }
}
