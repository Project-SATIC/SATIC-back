public enum Horario {

    SegM12(Dia.SEG, Periodo.M),
    SegM34(Dia.SEG, Periodo.M),
    SegM56(Dia.SEG, Periodo.M),

    SegT12(Dia.SEG, Periodo.T),
    SegT34(Dia.SEG, Periodo.T),
    SegT56(Dia.SEG, Periodo.T),

    TerM12(Dia.TER, Periodo.M),
    TerM34(Dia.TER, Periodo.M),
    TerM56(Dia.TER, Periodo.M),

    TerT12(Dia.TER, Periodo.T),
    TerT34(Dia.TER, Periodo.T),
    TerT56(Dia.TER, Periodo.T),

    QuaM12(Dia.QUA, Periodo.M),
    QuaM34(Dia.QUA, Periodo.M),
    QuaM56(Dia.QUA, Periodo.M),

    QuaT12(Dia.QUA, Periodo.T),
    QuaT34(Dia.QUA, Periodo.T),
    QuaT56(Dia.QUA, Periodo.T),

    QuiM12(Dia.QUI, Periodo.M),
    QuiM34(Dia.QUI, Periodo.M),
    QuiM56(Dia.QUI, Periodo.M),

    QuiT12(Dia.QUI, Periodo.T),
    QuiT34(Dia.QUI, Periodo.T),
    QuiT56(Dia.QUI, Periodo.T),

    SexM12(Dia.SEX, Periodo.M),
    SexM34(Dia.SEX, Periodo.M),
    SexM56(Dia.SEX, Periodo.M),

    SexT12(Dia.SEX, Periodo.T),
    SexT34(Dia.SEX, Periodo.T),
    SexT56(Dia.SEX, Periodo.T);

    private final Dia dia;
    private final Periodo periodo;

    Horario(Dia dia, Periodo periodo) {
        this.dia = dia;
        this.periodo = periodo;
    }

    public Dia getDia() {
        return dia;
    }

    public Periodo getPeriodo() {
        return periodo;
    }
}