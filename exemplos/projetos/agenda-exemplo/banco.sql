-- Banco de exemplo do projeto agenda-exemplo: Postgres puro, sem API exposta.
-- O leitor do Meraki não tem SELECT aqui: a fonte roda em modo catálogo (E06 desligada).

create extension if not exists pg_stat_statements;

create table public.profissionais (
  id serial primary key,
  nome text not null,
  especialidade text,
  criado_em timestamptz not null default now()
);

create table public.clientes (
  id serial primary key,
  nome text not null,
  telefone text,
  criado_em timestamptz not null default now()
);

create table public.agendamentos (
  id serial primary key,
  profissional_id integer not null references public.profissionais (id),
  cliente_id integer not null references public.clientes (id),
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'marcado',
  criado_em timestamptz not null default now()
);

-- Cópia antiga que ficou para trás.
create table public.agendamentos_backup (
  id integer,
  profissional_id integer,
  cliente_id integer,
  inicio timestamptz,
  fim timestamptz,
  status text,
  criado_em timestamptz
);

create table public.lembretes (
  id serial primary key,
  agendamento_id integer not null references public.agendamentos (id) on delete cascade,
  canal text not null,
  enviado_em timestamptz,
  criado_em timestamptz not null default now()
);

create function public.agendar(p_profissional integer, p_cliente integer, p_inicio timestamptz, p_duracao interval)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_id integer;
begin
  insert into public.agendamentos (profissional_id, cliente_id, inicio, fim)
  values (p_profissional, p_cliente, p_inicio, p_inicio + p_duracao)
  returning id into v_id;
  return v_id;
end $$;

create function public.proximos_agendamentos(p_horas integer) returns setof public.agendamentos
language sql stable
set search_path = ''
as $$ select * from public.agendamentos a where a.inicio between now() and now() + make_interval(hours => p_horas) $$;

grant usage on schema public to app_n8n;
grant select, insert, update on all tables in schema public to app_n8n;
grant usage, select on all sequences in schema public to app_n8n;

insert into public.profissionais (nome, especialidade) values
  ('Dra. Helena Prado', 'Dermatologia'), ('Dr. Caio Mendes', 'Clínica geral'), ('Dra. Lia Torres', 'Nutrição');

insert into public.clientes (nome, telefone)
select 'Cliente ' || g, '+55 21 9' || lpad(g::text, 8, '0') from generate_series(1, 40) g;

insert into public.agendamentos (profissional_id, cliente_id, inicio, fim, status)
select 1 + g % 3, 1 + g % 40, now() + make_interval(hours => g * 5), now() + make_interval(hours => g * 5, mins => 40),
       case when g % 7 = 0 then 'cancelado' else 'marcado' end
  from generate_series(1, 60) g;

analyze;
