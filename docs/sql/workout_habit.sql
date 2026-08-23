-- Hábito de treino em casa (calistenia) na tela de Perfil
-- (/admin/settings/profile).
--
-- Contexto: o Márcio não gosta de academia, treina calistenia em casa. A
-- IA (Gemini, já integrado no projeto — lib/whatsapp/gemini-client.ts)
-- gera o plano de treino UMA VEZ, sob demanda (botão "Gerar treino"), e o
-- resultado fica salvo aqui — a tela nunca chama a IA sozinha no
-- carregamento, só lê esses dois campos do profiles, pra não gastar
-- function invocation da Vercel à toa a cada visita.
--
-- Os exercícios (nome, grupo muscular, instrução de como fazer, link de
-- demonstração) NÃO ficam em tabela — vivem como lista estática em
-- lib/workout/exercises.ts (zero leitura de banco pra montar a lista,
-- zero custo). O plano gerado só guarda o `id` de cada exercício
-- escolhido; a tela resolve nome/instrução/link localmente a partir
-- desse arquivo, então a IA nunca consegue inventar um link quebrado.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS workout_plan jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS workout_checkins jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN profiles.workout_plan IS 'Plano de treino de calistenia gerado pelo Gemini: { generated_at, level, frequency_days, days: [ { label, exercises: [ { exercise_id, sets, reps } ] } ] }. exercise_id referencia lib/workout/exercises.ts, não uma tabela.';
COMMENT ON COLUMN profiles.workout_checkins IS 'Array de datas (YYYY-MM-DD) em que o usuário marcou "treinei hoje" — usado pro streak/calendário de hábito na tela de Perfil.';
