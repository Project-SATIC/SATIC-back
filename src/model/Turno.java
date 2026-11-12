package model;

/**
 * Turnos acadêmicos no padrão SIGAA/UFAL (M=Manhã, T=Tarde, N=Noite).
 */
public enum Turno {
    M("Manhã"),
    T("Tarde"),
    N("Noite");

    private final String descricao;

    Turno(String descricao) {
        this.descricao = descricao;
    }

    public String getDescricao() {
        return descricao;
    }

    public static Turno fromChar(char c) {
        return switch (Character.toUpperCase(c)) {
            case 'M' -> M;
            case 'T' -> T;
            case 'N' -> N;
            default -> throw new IllegalArgumentException("Turno SIGAA inválido: " + c);
        };
    }
}
