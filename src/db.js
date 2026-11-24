// Camada de banco. Postgres, sem ORM.
// O schema e aplicado na subida (idempotente), entao nao existe passo manual de migracao.

import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30000,
});

const SCHEMA = `
create table if not exists contatos (
  telefone              text primary key,
  nome                  text,
  pre_existente         boolean     not null default false,
  atendimento_humano    boolean     not null default false,
  estado                text        not null default 'novo',
  tentativas            integer     not null default 0,
  interesse             text,
  primeiro_contato_em   timestamptz not null default now(),
  ultima_interacao_em   timestamptz not null default now(),
  ultima_saudacao_em    timestamptz
);

create table if not exists leads (
  id            bigserial primary key,
  telefone      text not null,
  nome          text,
  interesse     text,
  quantidade_kg numeric,
  desfecho      text not null,
  criado_em     timestamptz not null default now()
);
create index if not exists leads_criado_em_idx on leads (criado_em desc);

-- IDs das mensagens que o proprio bot enviou.
-- Serve para distinguir "o bot falou" de "a Eliana falou".
create table if not exists mensagens_bot (
  message_id text primary key,
  telefone   text,
  criado_em  timestamptz not null default now()
);

-- Log cru de tudo que passa pelo webhook. E o que a gente le no modo mudo.
create table if not exists eventos (
  id         bigserial primary key,
  telefone   text,
  from_me    boolean,
  message_id text,
  texto      text,
  decisao    text,
  enviado    boolean not null default false,
  criado_em  timestamptz not null default now()
);
create index if not exists eventos_criado_em_idx on eventos (criado_em desc);
create index if not exists eventos_telefone_idx  on eventos (telefone);
`;

export async function migrar() {
  await pool.query(SCHEMA);
}

// --- contatos ---------------------------------------------------

export async function buscarContato(telefone) {
  const { rows } = await pool.query('select * from contatos where telefone = $1', [telefone]);
  return rows[0] || null;
}

export async function criarContatoSeNovo(telefone, nome, preExistente = false) {
  const { rows } = await pool.query(
    `insert into contatos (telefone, nome, pre_existente)
     values ($1, $2, $3)
     on conflict (telefone) do update
       set nome = coalesce(excluded.nome, contatos.nome),
           ultima_interacao_em = now()
     returning *`,
    [telefone, nome || null, preExistente],
  );
  return rows[0];
}

export async function atualizarContato(telefone, campos) {
  const permitidos = [
    'nome',
    'pre_existente',
    'atendimento_humano',
    'estado',
    'tentativas',
    'interesse',
    'ultima_saudacao_em',
  ];
  const entradas = Object.entries(campos).filter(([k]) => permitidos.includes(k));
  if (entradas.length === 0) return;

  const sets = entradas.map(([k], i) => `${k} = $${i + 2}`);
  sets.push('ultima_interacao_em = now()');

  await pool.query(
    `update contatos set ${sets.join(', ')} where telefone = $1`,
    [telefone, ...entradas.map(([, v]) => v)],
  );
}

// Marca em lote os contatos que ja existiam antes da instalacao.
// Esses nunca recebem mensagem do bot.
export async function marcarPreExistentes(telefones) {
  if (!telefones.length) return 0;
  const { rowCount } = await pool.query(
    `insert into contatos (telefone, pre_existente, estado)
     select unnest($1::text[]), true, 'ignorado'
     on conflict (telefone) do update set pre_existente = true`,
    [telefones],
  );
  return rowCount;
}

// --- mensagens enviadas pelo bot --------------------------------

export async function registrarMensagemDoBot(messageId, telefone) {
  if (!messageId) return;
  await pool.query(
    `insert into mensagens_bot (message_id, telefone) values ($1, $2)
     on conflict (message_id) do nothing`,
    [messageId, telefone],
  );
}

export async function foiOBot(messageId) {
  if (!messageId) return false;
  const { rowCount } = await pool.query(
    'select 1 from mensagens_bot where message_id = $1',
    [messageId],
  );
  return rowCount > 0;
}

// --- leads e log ------------------------------------------------

export async function registrarLead({ telefone, nome, interesse, quantidadeKg, desfecho }) {
  await pool.query(
    `insert into leads (telefone, nome, interesse, quantidade_kg, desfecho)
     values ($1, $2, $3, $4, $5)`,
    [telefone, nome || null, interesse || null, quantidadeKg ?? null, desfecho],
  );
}

export async function registrarEvento({ telefone, fromMe, messageId, texto, decisao, enviado }) {
  await pool.query(
    `insert into eventos (telefone, from_me, message_id, texto, decisao, enviado)
     values ($1, $2, $3, $4, $5, $6)`,
    [telefone || null, !!fromMe, messageId || null, texto || null, decisao || null, !!enviado],
  );
}

export async function listarLeads(limite = 1000) {
  const { rows } = await pool.query(
    `select telefone, nome, interesse, quantidade_kg, desfecho, criado_em
       from leads order by criado_em desc limit $1`,
    [limite],
  );
  return rows;
}

export async function resumoEventos(limite = 200) {
  const { rows } = await pool.query(
    `select e.criado_em, e.telefone, e.from_me, e.texto, e.decisao, e.enviado,
            c.pre_existente, c.atendimento_humano, c.estado
       from eventos e
       left join contatos c on c.telefone = e.telefone
      order by e.criado_em desc
      limit $1`,
    [limite],
  );
  return rows;
}
