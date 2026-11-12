package service;

import model.DiaSemana;
import model.Turno;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parser oficial para notação de horários do SIGAA/UFAL.
 * Converte expressões simples ou compostas (ex: "35M34", "2T56 6T12", "2345M3456", "7M45", "4N1234")
 * em slots atômicos padronizados no formato "DIA-TURNO+HORA" (ex: "TER-M3", "TER-M4").
 */
public class SigaaHorarioParser {

    private static final Pattern BLOCK_PATTERN = Pattern.compile("^([2-7]+)([MTN])([1-6]+)$");
    private static final Map<String, Set<String>> CACHE_SLOTS = new ConcurrentHashMap<>();

    /**
     * Expande uma expressão de horário SIGAA em uma lista ordenada e sem duplicatas de slots atômicos.
     */
    public static List<String> expandirParaSlotsAtomicos(String horarioSigaa) {
        return new ArrayList<>(obterConjuntoSlots(horarioSigaa));
    }

    /**
     * Retorna o conjunto imutável (com cache) dos slots atômicos de um horário SIGAA.
     */
    public static Set<String> obterConjuntoSlots(String horarioSigaa) {
        if (horarioSigaa == null || horarioSigaa.isBlank()) {
            return Collections.emptySet();
        }
        String chave = horarioSigaa.trim().toUpperCase();
        return CACHE_SLOTS.computeIfAbsent(chave, k -> {
            Set<String> slots = new LinkedHashSet<>();
            String[] tokens = k.split("\\s+");
            for (String token : tokens) {
                Matcher matcher = BLOCK_PATTERN.matcher(token);
                if (!matcher.matches()) {
                    throw new IllegalArgumentException("Formato de horário SIGAA não reconhecido: '" + token + "' em '" + horarioSigaa + "'");
                }

                String diasStr = matcher.group(1);
                Turno turno = Turno.fromChar(matcher.group(2).charAt(0));
                String horasStr = matcher.group(3);

                for (int i = 0; i < diasStr.length(); i++) {
                    DiaSemana dia = DiaSemana.fromCodigoSigaa(diasStr.charAt(i));
                    for (int j = 0; j < horasStr.length(); j++) {
                        char hora = horasStr.charAt(j);
                        slots.add(dia.name() + "-" + turno.name() + hora);
                    }
                }
            }
            return Collections.unmodifiableSet(slots);
        });
    }

    /**
     * Verifica se duas expressões de horário SIGAA possuem ao menos um slot atômico em comum (conflito).
     */
    public static boolean haSobreposicao(String horarioA, String horarioB) {
        if (horarioA == null || horarioB == null) {
            return false;
        }
        Set<String> slotsA = obterConjuntoSlots(horarioA);
        Set<String> slotsB = obterConjuntoSlots(horarioB);
        for (String slot : slotsA) {
            if (slotsB.contains(slot)) {
                return true;
            }
        }
        return false;
    }
}
