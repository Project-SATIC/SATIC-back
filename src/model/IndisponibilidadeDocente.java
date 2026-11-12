package model;

import java.util.Objects;

/**
 * Entidade que modela uma janela temporal bloqueada para um docente (RN-02).
 */
public class IndisponibilidadeDocente {

    private Integer id;
    private String professorMatricula;
    private String diaSemana;      // ex: "SEG", "TER", "2", "3"
    private String turno;          // ex: "M", "T", "N"
    private String indiceHorario;  // ex: "12", "34", "56"

    public IndisponibilidadeDocente() {
    }

    public IndisponibilidadeDocente(Integer id, String professorMatricula, String diaSemana, String turno, String indiceHorario) {
        this.id = id;
        this.professorMatricula = professorMatricula;
        this.diaSemana = diaSemana;
        this.turno = turno;
        this.indiceHorario = indiceHorario;
    }

    public IndisponibilidadeDocente(String professorMatricula, String diaSemana, String turno, String indiceHorario) {
        this(null, professorMatricula, diaSemana, turno, indiceHorario);
    }

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public String getProfessorMatricula() {
        return professorMatricula;
    }

    public void setProfessorMatricula(String professorMatricula) {
        this.professorMatricula = professorMatricula;
    }

    public String getDiaSemana() {
        return diaSemana;
    }

    public void setDiaSemana(String diaSemana) {
        this.diaSemana = diaSemana;
    }

    public String getTurno() {
        return turno;
    }

    public void setTurno(String turno) {
        this.turno = turno;
    }

    public String getIndiceHorario() {
        return indiceHorario;
    }

    public void setIndiceHorario(String indiceHorario) {
        this.indiceHorario = indiceHorario;
    }

    /**
     * Expande esta janela de indisponibilidade para o padrão atômico "DIA-TURNO+HORA"
     * (ex: "SEX-T5", "SEX-T6"), compatível com o SigaaHorarioParser.
     */
    public java.util.List<String> toSlotsAtomicos() {
        java.util.List<String> slots = new java.util.ArrayList<>();
        if (diaSemana == null || turno == null || indiceHorario == null) {
            return slots;
        }
        String diaPadrao = diaSemana.trim().toUpperCase();
        if (diaPadrao.length() == 1 && Character.isDigit(diaPadrao.charAt(0))) {
            diaPadrao = DiaSemana.fromCodigoSigaa(diaPadrao.charAt(0)).name();
        }
        String turnoPadrao = turno.trim().toUpperCase();
        String indices = indiceHorario.trim();
        for (int i = 0; i < indices.length(); i++) {
            char c = indices.charAt(i);
            if (Character.isDigit(c)) {
                slots.add(diaPadrao + "-" + turnoPadrao + c);
            }
        }
        return slots;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        IndisponibilidadeDocente that = (IndisponibilidadeDocente) o;
        return Objects.equals(professorMatricula, that.professorMatricula) &&
                Objects.equals(diaSemana, that.diaSemana) &&
                Objects.equals(turno, that.turno) &&
                Objects.equals(indiceHorario, that.indiceHorario);
    }

    @Override
    public int hashCode() {
        return Objects.hash(professorMatricula, diaSemana, turno, indiceHorario);
    }

    @Override
    public String toString() {
        return "IndisponibilidadeDocente{" +
                "id=" + id +
                ", professorMatricula='" + professorMatricula + '\'' +
                ", diaSemana='" + diaSemana + '\'' +
                ", turno='" + turno + '\'' +
                ", indiceHorario='" + indiceHorario + '\'' +
                '}';
    }
}
