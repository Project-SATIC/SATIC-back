import java.util.ArrayList;
import java.util.EnumSet;

public class Turma {
    public String name;
    private EnumSet<Dia> diasRestritos;
    private EnumSet<Periodo> periodosRestritos;

    public Turma(String name){
        this.name = name;
        this.diasRestritos = EnumSet.noneOf(Dia.class);
        this.periodosRestritos = EnumSet.noneOf(Periodo.class);
    }

    public void setRestricaoDia(Dia dia) {
        diasRestritos.add(dia);
    }

    public void setRestricaoPeriodo(Periodo periodo) {
        periodosRestritos.add(periodo);
    }

    public EnumSet<Dia> getRestricaoDia() {
        return diasRestritos;
    }

    public EnumSet<Periodo> getRestricaoPeriodo() {
        return periodosRestritos;
    }
}
