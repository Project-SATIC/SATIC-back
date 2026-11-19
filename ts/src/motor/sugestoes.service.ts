/**
 * Carrega turmas, salas e alocações do semestre e chama o motor de sugestões (sugestoes.ts).
 * Só leitura: aplicar uma sugestão é enviar as mudanças para POST /api/alocacoes/confirmar-lote.
 */
import { AlocacaoRepository, SalaRepository, TurmaRepository } from "../db/repositories/index.ts";
import { executorPadrao, type Executor } from "../db/connection.ts";
import { ErroNaoEncontrado } from "../erros.ts";
import { sugerirResolucoes, type OpcoesSugestao, type ResultadoSugestoes } from "./sugestoes.ts";

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

    async sugerir(semestre: string, opcoes: OpcoesSugestao = {}): Promise<ResultadoSugestoes & { semestre: string }> {
        const turmas = await this.#turmaRepo.listarPorSemestre(semestre, this.#db);
        if (turmas.length === 0) throw new ErroNaoEncontrado(`Nenhuma turma encontrada para o semestre '${semestre}'`);
        const salas = await this.#salaRepo.listarAlocaveisPeloIc(this.#db);
        const alocacoes = await this.#alocacaoRepo.listarPorSemestre(semestre, this.#db);
        return { semestre, ...sugerirResolucoes(turmas, salas, alocacoes, opcoes) };
    }

    /** Só o diagnóstico (conflitos e pendências), sem rodar a busca. */
    async conflitos(semestre: string): Promise<Pick<ResultadoSugestoes, "conflitos" | "pendentes"> & { semestre: string }> {
        const r = await this.sugerir(semestre, { alvos: [], maxAlternativas: 0 });
        return { semestre, conflitos: r.conflitos, pendentes: r.pendentes };
    }
}
