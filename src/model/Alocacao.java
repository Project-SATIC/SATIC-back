package model;

import java.util.Objects;

/**
 * Entidade Associativa representando uma proposta ou definição de alocação física.
 * Liga uma Turma a uma Sala em um bloco de horário específico.
 */
public class Alocacao {

    private Integer id;
    private Turma turma;
    private Sala sala;
    private String horarioCodigo;
    private String status; // "RASCUNHO", "DEFINITIVA"
    private String dataGeracao;

    public Alocacao() {
        this.status = "RASCUNHO";
    }

    public Alocacao(Integer id, Turma turma, Sala sala, String horarioCodigo, String status, String dataGeracao) {
        this.id = id;
        this.turma = turma;
        this.sala = sala;
        this.horarioCodigo = horarioCodigo;
        this.status = status != null ? status : "RASCUNHO";
        this.dataGeracao = dataGeracao;
    }

    public Alocacao(Turma turma, Sala sala, String horarioCodigo, String status) {
        this(null, turma, sala, horarioCodigo, status, null);
    }

    public Alocacao(Turma turma, Sala sala, String horarioCodigo) {
        this(null, turma, sala, horarioCodigo, "RASCUNHO", null);
    }

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public Turma getTurma() {
        return turma;
    }

    public void setTurma(Turma turma) {
        this.turma = turma;
    }

    public Sala getSala() {
        return sala;
    }

    public void setSala(Sala sala) {
        this.sala = sala;
    }

    public String getHorarioCodigo() {
        return horarioCodigo;
    }

    public void setHorarioCodigo(String horarioCodigo) {
        this.horarioCodigo = horarioCodigo;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getDataGeracao() {
        return dataGeracao;
    }

    public void setDataGeracao(String dataGeracao) {
        this.dataGeracao = dataGeracao;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Alocacao alocacao = (Alocacao) o;
        return Objects.equals(id, alocacao.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public String toString() {
        return "Alocacao{" +
                "id=" + id +
                ", turma=" + (turma != null ? turma.getIdentificadorExibicao() : "null") +
                ", sala=" + (sala != null ? sala.getNome() : "null") +
                ", horario='" + horarioCodigo + '\'' +
                ", status='" + status + '\'' +
                '}';
    }
}
