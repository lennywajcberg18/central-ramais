-- Fecha a API REST pública do Supabase.
--
-- O Supabase publica o schema `public` numa API REST acessível com a chave
-- anônima — que é pública por desenho, feita para ficar dentro de um navegador.
-- E ele mantém DEFAULT PRIVILEGES concedendo acesso a `anon` e `authenticated`
-- em toda tabela nova criada pelo papel `postgres`. Como é o `postgres` que roda
-- as migrations, cada tabela que o Prisma criou nasceu publicada.
--
-- Medido neste banco antes desta migration: GET /rest/v1/users devolvia o
-- `password_hash` dos administradores, /rest/v1/entry_links devolvia os
-- `entry_code` (que são o segundo nível de autorização do produto),
-- /rest/v1/external_contacts devolvia telefone de paciente. E POST /rest/v1/tenants
-- respondeu 201: escrita, não só leitura.
--
-- Esta aplicação NÃO usa a API REST do Supabase. Ela fala com o Postgres pelo
-- Prisma, como o papel `postgres`. Então o acesso de `anon` e `authenticated`
-- aqui não é uma funcionalidade a preservar: é superfície que nunca deveria ter
-- existido.
--
-- São duas camadas independentes de propósito. Revogar privilégio é o que fecha
-- hoje; ligar RLS é o que segura se alguém reconceder por engano — e ligar RLS
-- sem criar policy nenhuma nega tudo para quem não tem `rolbypassrls`. O papel
-- `postgres` tem, e é por isso que a aplicação não sente nada.
--
-- Não use FORCE ROW LEVEL SECURITY: ele aplicaria RLS também ao dono da tabela,
-- e aí sim a aplicação pararia.

-- Camada 1: RLS em tudo que existe no schema, sem policy nenhuma.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Camada 2: tira os privilégios dos papéis da API pública, e tira também das
-- tabelas que as PRÓXIMAS migrations criarem — sem isso o buraco reabre sozinho
-- no próximo `prisma migrate`.
--
-- O IF EXISTS não é decoração: `anon` e `authenticated` são papéis do Supabase e
-- não existem no Postgres do docker-compose, onde esta migration também roda.
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', papel);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', papel);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', papel);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', papel);
    END IF;
  END LOOP;
END $$;
