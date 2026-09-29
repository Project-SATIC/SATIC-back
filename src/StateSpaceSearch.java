import com.sun.source.tree.IfTree;

import java.util.ArrayList;

public class StateSpaceSearch {
    private ArrayList<Turma> turmas;
    public long podas = 0;

    public StateSpaceSearch(ArrayList<Turma> turmas){
        this.turmas = turmas;
    }

    public void solve(){
        if(! search(0, new ArrayList<Horario>())){
            System.out.println("Combinação Impossível!");
        }
        System.out.println("Podas: " + podas);

    }

    public boolean search(int height, ArrayList<Horario> horariosEscolhidos) {
        if (height == turmas.size()) {
            System.out.println(horariosEscolhidos);
            return true;
        }

        Turma turma = turmas.get(height);

        for (Horario schedule : Horario.values()) {

            if (validate(turma, schedule, horariosEscolhidos)) {

                horariosEscolhidos.add(schedule);

                if (search(height + 1, horariosEscolhidos)) {
                    return true;
                }

                horariosEscolhidos.remove(horariosEscolhidos.size() - 1);
            }else {
                podas++;
            }
        }

        return false;
    }

    public boolean validate(Turma turma, Horario horario, ArrayList<Horario> horariosEscolhidos) {
        return !horariosEscolhidos.contains(horario) && !turma.getRestricaoPeriodo().contains(horario.getPeriodo()) && !turma.getRestricaoDia().contains(horario.getDia());
    }
}
