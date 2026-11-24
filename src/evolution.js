// Cliente minimo da Evolution API.
// So usa o que o bot precisa: enviar texto, mostrar "digitando" e listar chats.

import { config } from './config.js';

const BASE = config.evolution.url;
const INSTANCIA = config.evolution.instancia;

async function chamar(caminho, { metodo = 'POST', corpo } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.evolution.apikey,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const bruto = await resposta.text();
  let dados = null;
  try {
    dados = bruto ? JSON.parse(bruto) : null;
  } catch {
    dados = bruto;
  }

  if (!resposta.ok) {
    throw new Error(
      `Evolution ${metodo} ${caminho} respondeu ${resposta.status}: ${
        typeof dados === 'string' ? dados.slice(0, 300) : JSON.stringify(dados).slice(0, 300)
      }`,
    );
  }

  return dados;
}

// Envia texto e devolve o ID da mensagem, para a gente saber depois que foi o bot.
export async function enviarTexto(telefone, texto, { delayMs = 0 } = {}) {
  const dados = await chamar(`/message/sendText/${INSTANCIA}`, {
    corpo: {
      number: telefone,
      text: texto,
      delay: delayMs,
      linkPreview: false,
    },
  });

  return dados?.key?.id || dados?.messageId || null;
}

// Mostra "digitando..." por alguns segundos antes da resposta.
// Se falhar, nao e motivo para abortar o atendimento.
export async function mostrarDigitando(telefone, duracaoMs) {
  try {
    await chamar(`/chat/sendPresence/${INSTANCIA}`, {
      corpo: { number: telefone, presence: 'composing', delay: duracaoMs },
    });
  } catch (erro) {
    console.warn('[evolution] nao consegui enviar presenca:', erro.message);
  }
}

// Lista todos os chats da instancia. Usado uma unica vez, na instalacao,
// para congelar quem ja era contato antes do bot existir.
export async function listarChats() {
  const dados = await chamar(`/chat/findChats/${INSTANCIA}`, { corpo: {} });
  const lista = Array.isArray(dados) ? dados : dados?.chats || [];
  return lista
    .map((c) => c?.remoteJid || c?.id || c?.jid)
    .filter((jid) => typeof jid === 'string')
    .filter((jid) => jid.endsWith('@s.whatsapp.net'))
    .map((jid) => jid.split('@')[0].replace(/\D/g, ''))
    .filter(Boolean);
}

export async function estadoDaConexao() {
  return chamar(`/instance/connectionState/${INSTANCIA}`, { metodo: 'GET' });
}
