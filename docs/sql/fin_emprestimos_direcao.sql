-- ✅ JÁ APLICADO no Supabase em 01/10/2026 (via Management API) — não precisa rodar de novo.
--
-- Empréstimos do Financeiro Pessoal passam a ter direção:
--   EMPRESTEI = eu emprestei pra pessoa  → DESPESA aumenta o que ela me deve, RECEITA abate
--   PEGUEI    = peguei emprestado        → RECEITA aumenta o que eu devo,   DESPESA abate
-- Pessoas já cadastradas ficam como EMPRESTEI (default = comportamento antigo).

alter table public.fin_emprestimos
  add column if not exists direcao text not null default 'EMPRESTEI'
  check (direcao in ('EMPRESTEI', 'PEGUEI'));

comment on column public.fin_emprestimos.direcao is
  'EMPRESTEI = eu emprestei (DESPESA aumenta o que me devem, RECEITA abate). PEGUEI = peguei emprestado (RECEITA aumenta o que eu devo, DESPESA abate).';

-- Correção de dado: os R$ 40.000 do Mateus Filho (entrada do In The Park) foram
-- dinheiro que ENTROU (peguei emprestado), mas estavam lançados como DESPESA.
update public.fin_emprestimos
   set direcao = 'PEGUEI'
 where id = 'a0ba20e3-5ee7-46a5-b0f7-e781ec20a1b4';

update public.fin_transacoes
   set tipo = 'RECEITA'
 where id = '6dadabad-9d8e-4d5d-bfd9-cf44c8874866'
   and tipo = 'DESPESA'
   and valor = 40000;
