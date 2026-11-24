import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { StateSpaceSearch, type ResultadoBusca } from "./state-space-search.ts";
import { sugerirResolucoes, type OpcoesSugestao, type ResultadoSugestoes } from "./sugestoes.ts";
import type { Alocacao, Sala, Turma } from "../shared/tipos.ts";

export type TarefaWorker =
    | {
        tipo: "gerar";
        turmasParaAlocar: readonly Turma[];
        salasAlocaveis: readonly Sala[];
        preservadas: readonly Alocacao[];
        maxNos?: number;
    }
    | {
        tipo: "sugestoes";
        turmas: readonly Turma[];
        salas: readonly Sala[];
        alocacoes: readonly Alocacao[];
        opcoes?: OpcoesSugestao;
    };

type RespostaWorker<T> = { ok: true; resultado: T } | { ok: false; erro: string };

function executarTarefaLocal(tarefa: TarefaWorker): ResultadoBusca | ResultadoSugestoes {
    if (tarefa.tipo === "gerar") {
        const search = new StateSpaceSearch(
            tarefa.turmasParaAlocar,
            tarefa.salasAlocaveis,
            tarefa.preservadas,
            { maxNos: tarefa.maxNos },
        );
        return search.solve();
    }
    return sugerirResolucoes(tarefa.turmas, tarefa.salas, tarefa.alocacoes, tarefa.opcoes ?? {});
}

if (!isMainThread && parentPort) {
    try {
        const resultado = executarTarefaLocal(workerData as TarefaWorker);
        parentPort.postMessage({ ok: true, resultado } satisfies RespostaWorker<unknown>);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        parentPort.postMessage({ ok: false, erro: msg } satisfies RespostaWorker<never>);
    }
}

/**
 * Executa a busca combinatória (StateSpaceSearch ou sugerirResolucoes) em uma Worker Thread
 * separada, liberando o Event Loop principal do Express durante buscas longas.
 */
export function executarEmWorker<T extends ResultadoBusca | ResultadoSugestoes>(
    tarefa: TarefaWorker,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const worker = new Worker(new URL("./motor-worker.ts", import.meta.url), {
            workerData: tarefa,
        });

        let finalizado = false;

        worker.on("message", (msg: RespostaWorker<T>) => {
            if (finalizado) return;
            finalizado = true;
            if (msg.ok) {
                resolve(msg.resultado);
            } else {
                reject(new Error(msg.erro));
            }
        });

        worker.on("error", (err) => {
            if (finalizado) return;
            finalizado = true;
            reject(err);
        });

        worker.on("exit", (code) => {
            if (finalizado) return;
            finalizado = true;
            if (code !== 0) {
                reject(new Error(`Worker do motor encerrou com código ${code}`));
            }
        });
    });
}
