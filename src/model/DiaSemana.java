package model;

/**
 * Dias da semana no padrão SIGAA/UFAL (2=Seg até 7=Sáb).
 */
public enum DiaSemana {
    SEG('2', "Segunda"),
    TER('3', "Terça"),
    QUA('4', "Quarta"),
    QUI('5', "Quinta"),
    SEX('6', "Sexta"),
    SAB('7', "Sábado");

    private final char codigoSigaa;
    private final String nome;

    DiaSemana(char codigoSigaa, String nome) {
        this.codigoSigaa = codigoSigaa;
        this.nome = nome;
    }

    public char getCodigoSigaa() {
        return codigoSigaa;
    }

    public String getNome() {
        return nome;
    }

    public static DiaSemana fromCodigoSigaa(char codigo) {
        for (DiaSemana d : values()) {
            if (d.codigoSigaa == codigo) {
                return d;
            }
        }
        throw new IllegalArgumentException("Código de dia SIGAA inválido: " + codigo);
    }
}
