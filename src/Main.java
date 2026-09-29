import java.util.ArrayList;

public class Main {

    public static void main(String[] args) {

        ArrayList<Turma> turmas = new ArrayList<>();

        Turma p1a = new Turma("Programação 1 - E1");
        Turma p1b = new Turma("Programação 1 - E2");

        Turma logicaA = new Turma("Lógica para Computação - E1");
        Turma logicaB = new Turma("Lógica para Computação - E2");

        Turma eticaA = new Turma("Computação, Sociedade e Ética - E1");
        Turma eticaB = new Turma("Computação, Sociedade e Ética - E2");

        Turma discretaA = new Turma("Matemática Discreta - E1");
        Turma discretaB = new Turma("Matemática Discreta - E2");

        Turma calculoA = new Turma("Cálculo - E1");
        Turma calculoB = new Turma("Cálculo - E2");
        Turma calculoC = new Turma("Cálculo - E3");
        Turma calculoD = new Turma("Cálculo - E4");


        turmas.add(p1a);
        turmas.add(p1b);

        turmas.add(logicaA);
        turmas.add(logicaB);

        turmas.add(eticaA);
        turmas.add(eticaB);

        turmas.add(discretaA);
        turmas.add(discretaB);

        turmas.add(calculoA);
        turmas.add(calculoB);
        turmas.add(calculoC);
        turmas.add(calculoD);


        // Programação 1
        // Professor disponível apenas pela manhã
        // e indisponível na segunda e sexta.

        p1a.setRestricaoPeriodo(Periodo.T);
        p1a.setRestricaoDia(Dia.SEG);
        p1a.setRestricaoDia(Dia.SEX);

        p1b.setRestricaoPeriodo(Periodo.T);
        p1b.setRestricaoDia(Dia.SEG);
        p1b.setRestricaoDia(Dia.SEX);


        // Lógica para Computação
        // Professor prefere tarde.
        // Não pode quinta-feira.

        logicaA.setRestricaoPeriodo(Periodo.M);
        logicaA.setRestricaoDia(Dia.QUI);

        logicaB.setRestricaoPeriodo(Periodo.M);
        logicaB.setRestricaoDia(Dia.QUI);


        // Computação, Sociedade e Ética
        // Apenas tarde.
        // Professor não disponível terça-feira.

        eticaA.setRestricaoPeriodo(Periodo.M);
        eticaA.setRestricaoDia(Dia.TER);

        eticaB.setRestricaoPeriodo(Periodo.M);
        eticaB.setRestricaoDia(Dia.TER);


        // Matemática Discreta
        // Apenas manhã.
        // Professor não pode quarta-feira.

        discretaA.setRestricaoPeriodo(Periodo.T);
        discretaA.setRestricaoDia(Dia.QUA);

        discretaB.setRestricaoPeriodo(Periodo.T);
        discretaB.setRestricaoDia(Dia.QUA);


        // Cálculo
        // Apenas manhã.
        // Professor não disponível sexta-feira.

        calculoA.setRestricaoPeriodo(Periodo.T);
        calculoA.setRestricaoDia(Dia.SEX);

        calculoB.setRestricaoPeriodo(Periodo.T);
        calculoB.setRestricaoDia(Dia.SEX);

        calculoC.setRestricaoPeriodo(Periodo.T);
        calculoC.setRestricaoDia(Dia.SEX);

        calculoD.setRestricaoPeriodo(Periodo.T);
        calculoD.setRestricaoDia(Dia.SEX);

        StateSpaceSearch search = new StateSpaceSearch(turmas);

        long memoriaAntes = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

        long inicio = System.nanoTime();

        search.solve();

        long fim = System.nanoTime();

        long memoriaDepois = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

        double tempoSegundos = (fim - inicio) / 1_000_000_000.0;

        double memoriaMB = (memoriaDepois - memoriaAntes) / (1024.0 * 1024.0);

        System.out.println();

        System.out.println("===== RESULTADO =====");

        System.out.println("Quantidade de eventos: " + turmas.size());

        System.out.printf("Tempo: %.3f segundos%n", tempoSegundos);

        System.out.printf("Variação aproximada de memória: %.2f MB%n", memoriaMB);
    }
}