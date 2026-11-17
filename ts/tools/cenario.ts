/**
 * Monta e executa um cenário do motor sobre a base 2026.2, com as mesmas opções de
 * estresse aceitas por tools/GoldenDump.java ("sem=<sala>" e "indisp=<siape>:<dia>:<turno>:<idx>").
 */
import { montarProblema } from "../src/motor/montar-problema.ts";
import { resumir } from "../src/motor/resumo.ts";
import type { ResumoMotor } from "../src/motor/resumo.ts";
import { StateSpaceSearch } from "../src/motor/state-space-search.ts";
import type { ResultadoBusca } from "../src/motor/state-space-search.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";

export interface ExecucaoCenario {
    resultado: ResultadoBusca;
    resumo: ResumoMotor;
}

export function executarCenario(opcoes: readonly string[] = []): ExecucaoCenario {
    const base = carregarBase2026_2();
    const problema = montarProblema(base);
    let salas = problema.salasAlocaveis;

    for (const op of opcoes) {
        if (op.startsWith("sem=")) {
            const nome = op.slice(4);
            salas = salas.filter((s) => s.nome !== nome);
        } else if (op.startsWith("indisp=")) {
            const [siape, diaSemana, turno, indiceHorario] = op.slice(7).split(":");
            const prof = base.professores.find((p) => p.matriculaSiape === siape);
            if (!prof) throw new Error(`Docente inexistente no cenário: ${siape}`);
            prof.indisponibilidades.push({ professorMatricula: siape, diaSemana, turno, indiceHorario });
        } else {
            throw new Error(`Opção de cenário desconhecida: ${op}`);
        }
    }

    const resultado = new StateSpaceSearch(problema.turmasParaAlocar, salas, problema.reservasFixasExternas).solve();
    return { resultado, resumo: resumir(base.turmas, problema.reservasFixasExternas, resultado) };
}
