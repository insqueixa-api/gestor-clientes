// lib/workout/exercises.ts
// Banco de exercícios de calistenia (treino em casa, sem academia) usado na
// tela de Perfil (/admin/settings/profile). Fica como lista estática no
// código — não em tabela — porque é conteúdo de referência que não muda:
// zero leitura de banco pra montar a tela, zero custo de Vercel/Supabase
// só pra listar exercício. O plano gerado pela IA (Gemini) só guarda o
// `id` de cada exercício escolhido aqui; nome, grupo, instrução e link de
// demonstração vêm sempre desta lista (garante que nunca aparece um
// exercício ou link inventado pela IA).

export type MuscleGroup =
  | "peito_triceps"
  | "costas_biceps"
  | "pernas_gluteos"
  | "core"
  | "ombros"
  | "cardio";

export type Difficulty = "iniciante" | "intermediário" | "avançado";

export type Exercise = {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  difficulty: Difficulty;
  instructions: string;
};

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, { label: string; emoji: string }> = {
  peito_triceps: { label: "Peito & Tríceps", emoji: "💪" },
  costas_biceps: { label: "Costas & Bíceps", emoji: "🔙" },
  pernas_gluteos: { label: "Pernas & Glúteos", emoji: "🦵" },
  core: { label: "Core & Abdômen", emoji: "🎯" },
  ombros: { label: "Ombros", emoji: "🤸" },
  cardio: { label: "Cardio & Full Body", emoji: "🔥" },
};

export const EXERCISES: Exercise[] = [
  // Peito & Tríceps (empurrar)
  {
    id: "flexao-braco",
    name: "Flexão de Braço",
    muscleGroup: "peito_triceps",
    difficulty: "iniciante",
    instructions:
      "Mãos no chão na largura dos ombros, corpo reto da cabeça aos pés. Desça o peito até quase tocar o chão flexionando os cotovelos a ~45° do corpo, depois empurre de volta até estender os braços. Mantenha o abdômen contraído pra não deixar o quadril cair.",
  },
  {
    id: "flexao-joelho",
    name: "Flexão de Joelho",
    muscleGroup: "peito_triceps",
    difficulty: "iniciante",
    instructions:
      "Igual à flexão tradicional, mas apoiando os joelhos no chão em vez dos pés — reduz a carga e é ótima progressão pra quem ainda não faz flexão completa. Mantenha o tronco reto, sem deixar o quadril subir ou cair.",
  },
  {
    id: "flexao-diamante",
    name: "Flexão Diamante",
    muscleGroup: "peito_triceps",
    difficulty: "intermediário",
    instructions:
      "Mesma flexão de braço, mas com as mãos juntas embaixo do peito formando um losango com os polegares e indicadores. Foca mais o tríceps. Desça controlado e empurre de volta mantendo os cotovelos próximos do corpo.",
  },
  {
    id: "flexao-arqueiro",
    name: "Flexão Arqueiro",
    muscleGroup: "peito_triceps",
    difficulty: "avançado",
    instructions:
      "Mãos bem afastadas, mais que a largura dos ombros. Ao descer, transfira o peso pra um lado dobrando esse braço enquanto o outro fica estendido lateralmente (como um arqueiro puxando a corda). Empurre de volta ao centro e alterne o lado.",
  },
  {
    id: "mergulho-banco",
    name: "Mergulho no Banco (Bench Dips)",
    muscleGroup: "peito_triceps",
    difficulty: "iniciante",
    instructions:
      "Sente na borda de um banco/sofá firme, mãos ao lado do quadril, pernas estendidas à frente. Desça o corpo flexionando os cotovelos até formarem ~90°, depois empurre de volta. Mantenha os cotovelos apontando pra trás, não pros lados.",
  },
  {
    id: "paralelas-solo",
    name: "Mergulho em Paralelas (Dips)",
    muscleGroup: "peito_triceps",
    difficulty: "intermediário",
    instructions:
      "Em barras paralelas (ou duas cadeiras firmes lado a lado), apoie as mãos e suspenda o corpo com os braços estendidos. Desça flexionando os cotovelos até o ombro ficar na altura do cotovelo, depois empurre de volta. Tronco levemente inclinado à frente pra proteger o ombro.",
  },

  // Costas & Bíceps (puxar)
  {
    id: "barra-fixa",
    name: "Barra Fixa (Pull-up)",
    muscleGroup: "costas_biceps",
    difficulty: "intermediário",
    instructions:
      "Pegada pronada (palmas pra frente), um pouco mais aberta que os ombros. Puxe o corpo até o queixo passar da barra, sem balançar, e desça controlado até os braços quase estenderem. Comece pelo número de repetições que conseguir com boa forma.",
  },
  {
    id: "barra-fixa-supinada",
    name: "Barra Fixa Supinada (Chin-up)",
    muscleGroup: "costas_biceps",
    difficulty: "intermediário",
    instructions:
      "Pegada supinada (palmas pra você), na largura dos ombros. Puxe até o queixo passar da barra — recruta mais o bíceps que a pegada pronada. Desça controlado sem soltar de repente.",
  },
  {
    id: "remada-invertida",
    name: "Remada Invertida (Australian Pull-up)",
    muscleGroup: "costas_biceps",
    difficulty: "iniciante",
    instructions:
      "Deite embaixo de uma barra baixa (ou mesa firme), segure com as mãos e mantenha o corpo reto com os calcanhares no chão. Puxe o peito em direção à barra apertando as escápulas, depois desça controlado. Quanto mais na horizontal o corpo, mais difícil.",
  },
  {
    id: "barra-negativa",
    name: "Barra Fixa Negativa",
    muscleGroup: "costas_biceps",
    difficulty: "iniciante",
    instructions:
      "Progressão pra quem ainda não faz barra fixa completa: suba com ajuda (pulo ou banco) até o queixo passar da barra e depois desça o mais devagar possível, controlando a descida inteira. Repita — a força pra puxar vem treinando a descida primeiro.",
  },

  // Pernas & Glúteos
  {
    id: "agachamento-livre",
    name: "Agachamento Livre",
    muscleGroup: "pernas_gluteos",
    difficulty: "iniciante",
    instructions:
      "Pés na largura dos ombros, pontas levemente pra fora. Desça como se fosse sentar numa cadeira, quadril pra trás, joelhos alinhados com os pés, até as coxas ficarem paralelas ao chão (ou o quanto a mobilidade permitir). Suba empurrando o chão com os pés.",
  },
  {
    id: "afundo",
    name: "Afundo (Lunge)",
    muscleGroup: "pernas_gluteos",
    difficulty: "iniciante",
    instructions:
      "Dê um passo à frente e desça o corpo até os dois joelhos ficarem a ~90°, sem o joelho de trás bater no chão. Empurre de volta à posição inicial com a perna da frente. Alterne as pernas ou faça uma série inteira de cada lado.",
  },
  {
    id: "agachamento-bulgaro",
    name: "Agachamento Búlgaro",
    muscleGroup: "pernas_gluteos",
    difficulty: "intermediário",
    instructions:
      "Apoie o peito do pé de trás num banco/sofá, perna da frente afastada o suficiente pra manter equilíbrio. Desça o joelho de trás em direção ao chão flexionando a perna da frente, depois suba. Faz uma perna de cada vez — excelente pra glúteo e equilíbrio.",
  },
  {
    id: "ponte-gluteo",
    name: "Ponte de Glúteo",
    muscleGroup: "pernas_gluteos",
    difficulty: "iniciante",
    instructions:
      "Deitado de costas, joelhos dobrados e pés apoiados no chão. Suba o quadril apertando o glúteo até o corpo formar uma linha reta dos ombros aos joelhos, segure um instante e desça controlado.",
  },
  {
    id: "cadeira-parede",
    name: "Cadeira na Parede (Wall Sit)",
    muscleGroup: "pernas_gluteos",
    difficulty: "iniciante",
    instructions:
      "Costas apoiadas na parede, desça até as coxas ficarem paralelas ao chão como se estivesse sentado numa cadeira invisível, joelhos a 90°. Segure a posição isométrica pelo tempo determinado, sem tirar as costas da parede.",
  },
  {
    id: "agachamento-pistol",
    name: "Agachamento Pistol (Uma Perna)",
    muscleGroup: "pernas_gluteos",
    difficulty: "avançado",
    instructions:
      "Em pé numa perna só, a outra estendida à frente sem tocar o chão. Desça o corpo o máximo que conseguir controlando o equilíbrio (pode segurar em algo no início), depois suba na mesma perna. Exige bastante força e mobilidade — vá progredindo aos poucos.",
  },
  {
    id: "elevacao-panturrilha",
    name: "Elevação de Panturrilha",
    muscleGroup: "pernas_gluteos",
    difficulty: "iniciante",
    instructions:
      "Em pé, suba na ponta dos pés o mais alto possível contraindo a panturrilha, segure um instante e desça controlado sem bater o calcanhar no chão. Pode fazer na beirada de um degrau pra ganhar mais amplitude.",
  },

  // Core & Abdômen
  {
    id: "prancha",
    name: "Prancha Abdominal",
    muscleGroup: "core",
    difficulty: "iniciante",
    instructions:
      "Apoie os antebraços e as pontas dos pés no chão, corpo reto da cabeça aos calcanhares, abdômen e glúteo contraídos. Não deixe o quadril subir nem cair. Segure a posição pelo tempo determinado respirando normalmente.",
  },
  {
    id: "prancha-lateral",
    name: "Prancha Lateral",
    muscleGroup: "core",
    difficulty: "iniciante",
    instructions:
      "Deitado de lado, apoie o antebraço no chão alinhado com o ombro e eleve o quadril até o corpo formar uma linha reta. Segure contraindo a lateral do abdômen (oblíquo), depois troque de lado.",
  },
  {
    id: "abdominal-bicicleta",
    name: "Abdominal Bicicleta",
    muscleGroup: "core",
    difficulty: "iniciante",
    instructions:
      "Deitado de costas, mãos atrás da cabeça, pernas elevadas. Leve o cotovelo em direção ao joelho oposto enquanto estende a outra perna, alternando os lados num movimento de pedalada controlado — sem puxar o pescoço com as mãos.",
  },
  {
    id: "elevacao-pernas",
    name: "Elevação de Pernas",
    muscleGroup: "core",
    difficulty: "intermediário",
    instructions:
      "Deitado de costas, mãos ao lado do corpo ou embaixo do quadril pra apoio lombar. Eleve as pernas estendidas até formarem ~90° com o chão, depois desça controlado sem deixar a lombar arquear ou tocar o chão com força.",
  },
  {
    id: "mountain-climber",
    name: "Mountain Climber",
    muscleGroup: "core",
    difficulty: "iniciante",
    instructions:
      "Posição de prancha com braços estendidos. Traga um joelho em direção ao peito e volte, alternando as pernas num ritmo rápido, como se estivesse correndo no lugar na horizontal. Mantenha o quadril baixo e o abdômen contraído.",
  },

  // Ombros
  {
    id: "flexao-pike",
    name: "Flexão Pike",
    muscleGroup: "ombros",
    difficulty: "intermediário",
    instructions:
      "Comece numa posição de V invertido (quadril alto, mãos e pés no chão, como um vira-lata caramelo esticando). Flexione os cotovelos descendo a cabeça em direção ao chão entre as mãos, depois empurre de volta. Foca ombro e tríceps.",
  },
  {
    id: "flexao-parada-mao",
    name: "Flexão em Parada de Mão (na parede)",
    muscleGroup: "ombros",
    difficulty: "avançado",
    instructions:
      "De costas pra parede, suba em parada de mão apoiando os pés na parede pra equilíbrio. Flexione os cotovelos descendo a cabeça em direção ao chão e empurre de volta. Exige bastante força de ombro e controle — só avance pra esse depois de dominar a flexão pike.",
  },

  // Cardio & Full Body
  {
    id: "polichinelo",
    name: "Polichinelo (Jumping Jack)",
    muscleGroup: "cardio",
    difficulty: "iniciante",
    instructions:
      "Em pé, salte abrindo pernas e braços ao mesmo tempo (braços sobem acima da cabeça), depois salte de volta à posição inicial. Ritmo constante, ótimo pra aquecer ou fechar o treino elevando a frequência cardíaca.",
  },
  {
    id: "agachamento-salto",
    name: "Agachamento com Salto",
    muscleGroup: "cardio",
    difficulty: "intermediário",
    instructions:
      "Faça um agachamento normal e, ao subir, impulsione com um salto explosivo, braços ajudando o impulso. Aterrisse suave, flexionando os joelhos, e já entre no próximo agachamento. Alto impacto — bom pra potência e cardio.",
  },
  {
    id: "burpee",
    name: "Burpee",
    muscleGroup: "cardio",
    difficulty: "intermediário",
    instructions:
      "Do agachamento, jogue as pernas pra trás em posição de prancha, faça uma flexão (opcional), volte com as pernas pro agachamento e finalize com um salto vertical. Exercício completo de corpo inteiro, ótimo pra condicionamento.",
  },
];

export function getExerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}

export function exerciseVideoSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`como fazer ${name} corretamente`)}`;
}
