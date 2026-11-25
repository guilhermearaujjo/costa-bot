// costa-bot — atendimento de primeiro contato no WhatsApp da Costa & Montenegro.
//
// Regras que este arquivo garante, nesta ordem:
//  1. Contato que ja existia antes da instalacao nunca recebe mensagem.
//  2. Grupos, listas e status sao ignorados.
//  3. Assim que um humano (Eliana) responde, o bot se cala naquele contato para sempre.
//  4. No MODO=mudo nada e enviado: o bot so registra o que teria feito.

import express from 'express';
import { config } from './config.js';
import {
  migrar,
  pool,
  buscarContato,
  criarContatoSeNovo,
  atualizarContato,
  marcarPreExistentes,
  registrarMensagemDoBot,
  foiOBot,
  registrarLead,
  registrarEvento,
  listarLeads,
  resumoEventos,
} from './db.js';
import { enviarTexto, mostrarDigitando, listarChats, estadoDaConexao } from './evolution.js';
import { processar, ESTADOS } from './fluxo.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function atrasoAleatorio() {
  const { delayMinMs, delayMaxMs } = config;
  return Math.floor(delayMinMs + Math.random() * (delayMaxMs - delayMinMs));
}

function soNumeros(valor) {
  return String(valor || '').replace(/\D/g, '');
}

// Extrai telefone, texto e metadados do evento da Evolution.
// Devolve null quando o evento nao interessa (grupo, status, sem texto).
function interpretarEvento(corpo) {
  const dados = corpo?.data;
  if (!dados) return null;

  const jid = dados?.key?.remoteJid;
  if (typeof jid !== 'string') return null;

  // Grupos, listas de transmissao e status nao entram no fluxo.
  if (!jid.endsWith('@s.whatsapp.net')) return null;

  const telefone = soNumeros(jid.split('@')[0]);
  if (!telefone) return null;

  const m = dados.message || {};
  const texto =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    '';

  return {
    telefone,
    texto: String(texto || '').trim(),
    fromMe: !!dados?.key?.fromMe,
    messageId: dados?.key?.id || null,
    nome: dados?.pushName || null,
  };
}

// Decide se o bot pode realmente enviar, de acordo com o modo de operacao.
function podeEnviar(telefone) {
  if (config.modo === 'ativo') return true;
  if (config.modo === 'piloto') return config.whitelist.includes(telefone);
  return false; // mudo
}

async function responder(telefone, texto) {
  const atraso = atrasoAleatorio();
  await mostrarDigitando(telefone, atraso);
  await dormir(atraso);
  const messageId = await enviarTexto(telefone, texto);
  await registrarMensagemDoBot(messageId, telefone);
  return messageId;
}

// ---------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------

app.post(`/webhook/:token`, async (req, res) => {
  if (req.params.token !== config.webhookToken) {
    return res.status(404).json({ erro: 'nao encontrado' });
  }

  // Responde rapido: a Evolution nao deve esperar o nosso processamento.
  res.json({ ok: true });

  try {
    await tratarEvento(req.body);
  } catch (erro) {
    console.error('[webhook] falha ao tratar evento:', erro);
  }
});

async function tratarEvento(corpo) {
  const evento = corpo?.event || corpo?.Event;
  if (evento && !String(evento).toLowerCase().includes('messages.upsert')) return;

  const msg = interpretarEvento(corpo);
  if (!msg) return;

  // ---- mensagem SAINDO do numero da empresa --------------------
  if (msg.fromMe) {
    const nossa = await foiOBot(msg.messageId);
    if (nossa) return; // foi o proprio bot, nao e handoff

    // Foi gente de verdade respondendo. O bot some desse contato.
    await criarContatoSeNovo(msg.telefone, null);
    await atualizarContato(msg.telefone, {
      atendimento_humano: true,
      estado: ESTADOS.ENCERRADO,
    });
    await registrarEvento({
      telefone: msg.telefone,
      fromMe: true,
      messageId: msg.messageId,
      texto: msg.texto,
      decisao: 'humano_assumiu',
      enviado: false,
    });
    console.log(`[handoff] humano assumiu ${msg.telefone}, bot silenciado`);
    return;
  }

  // ---- mensagem CHEGANDO ---------------------------------------
  if (!msg.texto) {
    await registrarEvento({
      telefone: msg.telefone,
      fromMe: false,
      messageId: msg.messageId,
      texto: '[sem texto: audio, figurinha ou anexo]',
      decisao: 'ignorado_sem_texto',
      enviado: false,
    });
    return;
  }

  const contato = await criarContatoSeNovo(msg.telefone, msg.nome);

  // Trava 1: contato que ja existia antes do bot.
  if (contato.pre_existente) {
    await registrarEvento({
      telefone: msg.telefone,
      fromMe: false,
      messageId: msg.messageId,
      texto: msg.texto,
      decisao: 'ignorado_contato_pre_existente',
      enviado: false,
    });
    return;
  }

  // Trava 2: humano ja assumiu.
  if (contato.atendimento_humano) {
    await registrarEvento({
      telefone: msg.telefone,
      fromMe: false,
      messageId: msg.messageId,
      texto: msg.texto,
      decisao: 'ignorado_atendimento_humano',
      enviado: false,
    });
    return;
  }

  const decisao = processar({
    estado: contato.estado,
    tentativas: contato.tentativas,
    interesse: contato.interesse,
    texto: msg.texto,
    minimoKg: config.minimoKg,
    linkBastao11: config.linkBastao11,
    linkBastao74: config.linkBastao74,
  });

  const vaiEnviar = !!decisao.resposta && podeEnviar(msg.telefone);

  await registrarEvento({
    telefone: msg.telefone,
    fromMe: false,
    messageId: msg.messageId,
    texto: msg.texto,
    decisao: `${decisao.motivo}${decisao.resposta ? '' : ' (sem resposta)'}`,
    enviado: vaiEnviar,
  });

  if (!decisao.resposta) return;

  // No modo mudo / fora da whitelist a gente para aqui: ja registrou o que faria.
  if (!vaiEnviar) {
    console.log(`[${config.modo}] NAO enviei para ${msg.telefone} | decisao: ${decisao.motivo}`);
    return;
  }

  await atualizarContato(msg.telefone, {
    estado: decisao.estado,
    tentativas: decisao.tentativas,
    interesse: decisao.interesse,
    ultima_saudacao_em: contato.ultima_saudacao_em || new Date(),
  });

  if (decisao.lead) {
    await registrarLead({
      telefone: msg.telefone,
      nome: msg.nome || contato.nome,
      interesse: decisao.lead.interesse,
      quantidadeKg: decisao.lead.quantidadeKg,
      desfecho: decisao.lead.desfecho,
    });
  }

  await responder(msg.telefone, decisao.resposta);
  console.log(`[enviado] ${msg.telefone} | ${decisao.motivo}`);
}

// ---------------------------------------------------------------
// Rotas administrativas
// ---------------------------------------------------------------

function exigirAdmin(req, res, next) {
  const token = req.query.token || req.get('x-admin-token');
  if (token !== config.adminToken) return res.status(404).json({ erro: 'nao encontrado' });
  next();
}

app.get('/saude', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true, modo: config.modo, minimoKg: config.minimoKg });
  } catch (erro) {
    res.status(500).json({ ok: false, erro: erro.message });
  }
});

// Congela quem ja era contato antes do bot existir.
// RODAR UMA VEZ, logo depois de conectar o numero e ANTES de sair do modo mudo.
app.post('/admin/congelar-antigos', exigirAdmin, async (_req, res) => {
  try {
    const telefones = await listarChats();
    const total = await marcarPreExistentes(telefones);
    console.log(`[bootstrap] ${telefones.length} chats existentes congelados`);
    res.json({ ok: true, chatsEncontrados: telefones.length, linhasGravadas: total });
  } catch (erro) {
    res.status(500).json({ ok: false, erro: erro.message });
  }
});

app.get('/admin/conexao', exigirAdmin, async (_req, res) => {
  try {
    res.json(await estadoDaConexao());
  } catch (erro) {
    res.status(500).json({ ok: false, erro: erro.message });
  }
});

app.get('/admin/eventos', exigirAdmin, async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, 2000);
  res.json(await resumoEventos(limite));
});

app.get('/admin/leads.csv', exigirAdmin, async (_req, res) => {
  const linhas = await listarLeads(5000);
  const cabecalho = 'telefone;nome;interesse;quantidade_kg;desfecho;criado_em';
  const corpo = linhas
    .map((l) =>
      [
        l.telefone,
        (l.nome || '').replace(/;/g, ','),
        l.interesse || '',
        l.quantidade_kg ?? '',
        l.desfecho,
        new Date(l.criado_em).toISOString(),
      ].join(';'),
    )
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads-costa.csv"');
  res.send(`${cabecalho}\n${corpo}`);
});

// ---------------------------------------------------------------

async function iniciar() {
  await migrar();
  app.listen(config.porta, () => {
    console.log(`costa-bot ouvindo na porta ${config.porta}`);
    console.log(`MODO: ${config.modo.toUpperCase()}  |  minimo: ${config.minimoKg} kg`);
    if (config.modo === 'mudo') {
      console.log('>> Nenhuma mensagem sera enviada. Consulte /admin/eventos para ver as decisoes.');
    }
    if (config.modo === 'piloto') {
      console.log(`>> Respondendo apenas: ${config.whitelist.join(', ')}`);
    }
  });
}

iniciar().catch((erro) => {
  console.error('Falha ao iniciar o costa-bot:', erro);
  process.exit(1);
});
