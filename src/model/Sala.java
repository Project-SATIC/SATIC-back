package model;

import java.util.Objects;

/**
 * Entidade de Domínio representando um espaço físico utilizável (IC, BL12, IM ou Externo).
 */
public class Sala {

    private Integer id;
    private String nome;
    private int capacidade;
    private String tipoEspaco; // "Sala", "Laboratório", "Auditório"
    private String bloco;      // "IC", "BL12", "IM", "CTEC", "IF"
    private boolean alocavelIc;

    public Sala() {
    }

    public Sala(Integer id, String nome, int capacidade,
                String tipoEspaco, String bloco, boolean alocavelIc) {
        this.id = id;
        this.nome = nome;
        this.capacidade = capacidade;
        this.tipoEspaco = tipoEspaco;
        this.bloco = bloco;
        this.alocavelIc = alocavelIc;
    }

    public Sala(String nome, int capacidade,
                String tipoEspaco, String bloco, boolean alocavelIc) {
        this(null, nome, capacidade, tipoEspaco, bloco, alocavelIc);
    }

    public Sala(String nome, int capacidade, String tipoEspaco) {
        this(null, nome, capacidade, tipoEspaco, "IC", true);
    }

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public String getNome() {
        return nome;
    }

    public void setNome(String nome) {
        this.nome = nome;
    }

    public int getCapacidade() {
        return capacidade;
    }

    public void setCapacidade(int capacidade) {
        this.capacidade = capacidade;
    }

    /**
     * Atributo derivado de {@code tipoEspaco} (evita redundância de coluna no banco).
     */
    public boolean isLaboratorio() {
        return tipoEspaco != null
                && ("Laboratório".equalsIgnoreCase(tipoEspaco) || "Laboratorio".equalsIgnoreCase(tipoEspaco));
    }

    public String getTipoEspaco() {
        return tipoEspaco;
    }

    public void setTipoEspaco(String tipoEspaco) {
        this.tipoEspaco = tipoEspaco;
    }

    public String getBloco() {
        return bloco;
    }

    public void setBloco(String bloco) {
        this.bloco = bloco;
    }

    public boolean isAlocavelIc() {
        return alocavelIc;
    }

    public void setAlocavelIc(boolean alocavelIc) {
        this.alocavelIc = alocavelIc;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Sala sala = (Sala) o;
        if (nome != null && sala.nome != null) {
            return Objects.equals(nome, sala.nome);
        }
        return id != null && Objects.equals(id, sala.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(nome != null ? nome : id);
    }

    @Override
    public String toString() {
        return "Sala{" +
                "id=" + id +
                ", nome='" + nome + '\'' +
                ", cap=" + capacidade +
                ", tipo='" + tipoEspaco + '\'' +
                ", bloco='" + bloco + '\'' +
                ", alocavelIC=" + alocavelIc +
                '}';
    }
}
