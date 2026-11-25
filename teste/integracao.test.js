// Teste de integracao: sobe o bot de verdade contra uma Evolution falsa
// e um Postgres de teste, e verifica as quatro travas de seguranca.
//
// Uso:
//   DATABASE_URL=postgres://... node teste/integracao.test.js

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORTA_EVOLUTION = 4555;
const PORTA_BOT = 4556;
const TOKEN = 'tk-teste';
const ADMIN = 'ad-teste';
const L11 = 'https://ml.exemplo/bastao-11mm';
const L74 = 'https://ml.exemplo/bastao-74mm';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/costabot';

let passou = 0;
let falhou = 0;

async function teste(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  ok   ${nome}`);
  } catch (erro) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${erro.message}`);
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Evolution falsa -------------------------------------------

const enviadas = [];
let chatsExistentes = [];
let contadorId = 0;

const evolucaoFalsa = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    const dados = corpo ? JSON.parse(corpo) : {};
    res.setHeader('Content-Type', 'application/json');

    if (req.url.startsWith('/message/sendText')) {
      contadorId += 1;
      const id = `BOT_${contadorId}`;
      enviadas.push({ numero: dados.number, texto: dados.text, id });
      return res.end(JSON.stringify({ key: { id } }));
    }
    if (req.url.startsWith('/chat/sendPresence')) return res.end(JSON.stringify({ ok: true }));
    if (req.url.startsWith('/chat/findChats')) {
      return res.end(
        JSON.stringify(chatsExistentes.map((t) => ({ remoteJid: `${t}@s.whatsapp.net` }))),
      );
    }
    if (req.url.startsWith('/instance/connectionState')) {
      return res.end(JSON.stringify({ state: 'open' }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});

// --- helpers ---------------------------------------------------

async function enviarWebhook({ telefone, texto, fromMe = false, messageId, jid }) {
  const corpo = {
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: jid || `${telefone}@s.whatsapp.net`,
        fromMe,
        id: messageId || `MSG_${Math.random().toString(36).slice(2)}`,
      },
      pushName: 'Cliente Teste',
      message: { conversation: texto },
    },
  };

  const resposta = await fetch(`http://127.0.0.1:${PORTA_BOT}/webhook/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  assert.equal(resposta.status, 200);
  await dormir(300); // o webhook responde antes de processar
}

function enviadasPara(telefone) {
  return enviadas.filter((e) => e.numero === telefone);
}

async function esperarEnvio(telefone, quantidade, limiteMs = 3000) {
  const ate = Date.now() + limiteMs;
  while (Date.now() < ate) {
    if (enviadasPara(telefone).length >= quantidade) return;
    await dormir(100);
  }
}

// --- execucao --------------------------------------------------

let bot;

async function subirBot(modo = 'ativo', extra = {}) {
  bot = spawn('node', ['src/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORTA_BOT),
      MODO: modo,
      EVOLUTION_URL: `http://127.0.0.1:${PORTA_EVOLUTION}`,
      EVOLUTION_APIKEY: 'k',
      EVOLUTION_INSTANCE: 'costa',
      WEBHOOK_TOKEN: TOKEN,
      ADMIN_TOKEN: ADMIN,
      DATABASE_URL,
      MINIMO_KG: '25',
      LINK_ML_BASTAO_11MM: L11,
      LINK_ML_BASTAO_74MM: L74,
      DELAY_MIN_MS: '0',
      DELAY_MAX_MS: '1',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  bot.stderr.on('data', (d) => process.stderr.write(`[bot] ${d}`));

  const ate = Date.now() + 15000;
  while (Date.now() < ate) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA_BOT}/saude`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await dormir(200);
  }
  throw new Error('bot nao subiu a tempo');
}

async function limparBanco() {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  await pool.query(`
    drop table if exists eventos, leads, mensagens_bot, contatos cascade;
  `);
  await pool.end();
}

async function principal() {
  await limparBanco();
  await new Promise((r) => evolucaoFalsa.listen(PORTA_EVOLUTION, r));

  const ANTIGO = '5511900000001';
  const NOVO = '5511900000002';
  const PEQUENO = '5511900000003';
  const HANDOFF = '5511900000004';

  chatsExistentes = [ANTIGO];

  await subirBot('ativo');

  console.log('\n-- trava 1: contato pre-existente --');

  await teste('congelar-antigos registra os chats que ja existiam', async () => {
    const r = await fetch(
      `http://127.0.0.1:${PORTA_BOT}/admin/congelar-antigos?token=${ADMIN}`,
      { method: 'POST' },
    );
    const dados = await r.json();
    assert.equal(dados.ok, true);
    assert.equal(dados.chatsEncontrados, 1);
  });

  await teste('contato antigo escreve e NAO recebe resposta', async () => {
    await enviarWebhook({ telefone: ANTIGO, texto: 'oi, quero cola' });
    await dormir(500);
    assert.equal(enviadasPara(ANTIGO).length, 0);
  });

  console.log('\n-- trava 2: grupos --');

  await teste('mensagem de grupo e ignorada', async () => {
    await enviarWebhook({
      telefone: NOVO,
      texto: 'oi',
      jid: '120363000000000000@g.us',
    });
    await dormir(400);
    assert.equal(enviadas.length, 0);
  });

  console.log('\n-- fluxo completo, contato novo --');

  await teste('"oi" recebe o menu', async () => {
    await enviarWebhook({ telefone: NOVO, texto: 'oi' });
    await esperarEnvio(NOVO, 1);
    const [msg] = enviadasPara(NOVO);
    assert.ok(msg, 'nenhuma mensagem enviada');
    assert.match(msg.texto, /Cola hot melt/);
  });

  await teste('"1" pergunta a quantidade e NAO manda link', async () => {
    await enviarWebhook({ telefone: NOVO, texto: '1' });
    await esperarEnvio(NOVO, 2);
    const msgs = enviadasPara(NOVO);
    assert.equal(msgs.length, 2);
    assert.match(msgs[1].texto, /quantidade/i);
    assert.ok(!msgs[1].texto.includes(L11), 'nao pode mandar link aqui');
  });

  await teste('quantidade acima do minimo vira lead', async () => {
    await enviarWebhook({ telefone: NOVO, texto: '200' });
    await esperarEnvio(NOVO, 3);
    const msgs = enviadasPara(NOVO);
    assert.match(msgs[2].texto, /atendente/i);
  });

  await teste('depois de encerrado o bot nao fala mais', async () => {
    await enviarWebhook({ telefone: NOVO, texto: 'oi de novo' });
    await dormir(500);
    assert.equal(enviadasPara(NOVO).length, 3);
  });

  console.log('\n-- abaixo do minimo --');

  await teste('bastao pequeno recebe os dois links do Mercado Livre', async () => {
    await enviarWebhook({ telefone: PEQUENO, texto: 'queria 5kg de bastao de cola quente' });
    await esperarEnvio(PEQUENO, 1);
    const [msg] = enviadasPara(PEQUENO);
    assert.ok(msg.texto.includes(L11), 'faltou o 11mm');
    assert.ok(msg.texto.includes(L74), 'faltou o 7,4mm');
  });

  await teste('granulado pequeno NAO recebe link de bastao', async () => {
    const GRAN = '5511900000006';
    await enviarWebhook({ telefone: GRAN, texto: 'queria 5kg de cola granulada' });
    await esperarEnvio(GRAN, 1);
    const [msg] = enviadasPara(GRAN);
    assert.ok(!msg.texto.includes(L11), 'mandou link errado');
    assert.ok(!msg.texto.includes(L74), 'mandou link errado');
    assert.match(msg.texto, /atendente/i);
  });

  console.log('\n-- trava 3: a Eliana assume --');

  await teste('contato novo recebe o menu', async () => {
    await enviarWebhook({ telefone: HANDOFF, texto: 'bom dia' });
    await esperarEnvio(HANDOFF, 1);
    assert.equal(enviadasPara(HANDOFF).length, 1);
  });

  await teste('resposta humana silencia o bot naquele contato', async () => {
    // fromMe com ID que o bot nao conhece = foi gente de verdade
    await enviarWebhook({
      telefone: HANDOFF,
      texto: 'Oi! Aqui e a Eliana, pode falar',
      fromMe: true,
      messageId: 'HUMANO_1',
    });
    await enviarWebhook({ telefone: HANDOFF, texto: '1' });
    await dormir(600);
    assert.equal(enviadasPara(HANDOFF).length, 1, 'o bot falou depois do humano');
  });

  await teste('eco da propria mensagem do bot nao conta como humano', async () => {
    const ECO = '5511900000005';
    await enviarWebhook({ telefone: ECO, texto: 'oi' });
    await esperarEnvio(ECO, 1);
    const idDoBot = enviadasPara(ECO)[0].id;

    // a Evolution devolve a mensagem do proprio bot como fromMe
    await enviarWebhook({ telefone: ECO, texto: 'menu', fromMe: true, messageId: idDoBot });
    await enviarWebhook({ telefone: ECO, texto: '1' });
    await esperarEnvio(ECO, 2);
    assert.equal(enviadasPara(ECO).length, 2, 'o bot se calou por engano');
  });

  console.log('\n-- leads --');

  await teste('csv de leads traz os desfechos', async () => {
    const r = await fetch(`http://127.0.0.1:${PORTA_BOT}/admin/leads.csv?token=${ADMIN}`);
    const csv = await r.text();
    assert.match(csv, /lead/);
    assert.match(csv, /mercado_livre/);
    assert.match(csv, /granulado_abaixo_minimo/);
  });

  await teste('rota admin sem token nao responde', async () => {
    const r = await fetch(`http://127.0.0.1:${PORTA_BOT}/admin/leads.csv`);
    assert.equal(r.status, 404);
  });

  await teste('webhook com token errado nao responde', async () => {
    const r = await fetch(`http://127.0.0.1:${PORTA_BOT}/webhook/errado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 404);
  });

  console.log('\n-- trava 4: modo mudo --');

  bot.kill();
  await dormir(500);
  enviadas.length = 0;
  await subirBot('mudo');

  await teste('em modo mudo nada e enviado', async () => {
    await enviarWebhook({ telefone: '5511900000009', texto: 'oi, quero cola' });
    await dormir(700);
    assert.equal(enviadas.length, 0);
  });

  await teste('mas a decisao fica registrada no log', async () => {
    const r = await fetch(`http://127.0.0.1:${PORTA_BOT}/admin/eventos?token=${ADMIN}`);
    const eventos = await r.json();
    const meu = eventos.find((e) => e.telefone === '5511900000009');
    assert.ok(meu, 'evento nao registrado');
    assert.equal(meu.enviado, false);
    assert.ok(meu.decisao, 'sem decisao registrada');
  });

  bot.kill();
  evolucaoFalsa.close();

  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

principal().catch((erro) => {
  console.error(erro);
  if (bot) bot.kill();
  process.exit(1);
});
