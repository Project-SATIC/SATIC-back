/**
 * Monta a entrada do motor a partir da base (porte do trecho inicial de Main.java):
 *  - só turmas com requerAlocacaoIc = true entram na busca;
 *  - turmas externas que já ocupam uma sala do pool do IC (ex: IF0001-05 na Sala 207 BL12)
 *    viram reservas EXTERNA_FIXA, que bloqueiam o horário daquela sala.
 *
 * Observação: como no Java, a sala dessas reservas vem do gabarito do SIGAA carregado no seed.
 * Quando houver persistência, essas reservas devem vir da tabela `alocacoes` (status EXTERNA_FIXA).
 */
import { chaveTurma } from "../shared/tipos.ts";
import type { Alocacao, Sala, Turma } from "../shared/tipos.ts";
import { salasAlocaveisPeloIc } from "../seed/seeder.ts";
import type { BaseSatic } from "../seed/seeder.ts";

export interface ProblemaAlocacao {
    turmasParaAlocar: Turma[];
    salasAlocaveis: Sala[];
    reservasFixasExternas: Alocacao[];
}

export function montarProblema(base: BaseSatic): ProblemaAlocacao {
    const salaPorNome = new Map(base.salas.map((s) => [s.nome, s]));
    const turmasParaAlocar: Turma[] = [];
    const reservasFixasExternas: Alocacao[] = [];

    for (const t of base.turmas) {
        if (t.requerAlocacaoIc) {
            turmasParaAlocar.push(t);
            continue;
        }
        const nomeSala = base.gabaritoSigaa.get(chaveTurma(t));
        const sala = nomeSala != null ? salaPorNome.get(nomeSala) : undefined;
        if (sala && sala.alocavelIc) {
            reservasFixasExternas.push({ turma: t, sala, horarioCodigo: t.horarioSigaa, status: "EXTERNA_FIXA" });
        }
    }

    return { turmasParaAlocar, salasAlocaveis: salasAlocaveisPeloIc(base.salas), reservasFixasExternas };
}
