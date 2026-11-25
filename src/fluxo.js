// Maquina de estados do atendimento. Sem LLM, sem chamada externa:
// entra estado + texto, sai a decisao. Isso deixa o fluxo testavel isoladamente.

import { textos, montar } from './textos.js';

export const ESTADOS = {
  NOVO: 'novo',
  AGUARDANDO_MENU: 'aguardando_menu',
  AGUARDANDO_QTD: 'aguardando_qtd',
  ENCERRADO: 'encerrado',
  IGNORADO: 'ignorado',
};

// granulado e bastao sao produtos diferentes e seguem caminhos diferentes
// quando a quantidade fica abaixo do minimo.
export const INTERESSES = {
  GRANULADO: 'granulado',
  BASTAO: 'bastao',
  OUTRO: 'outro',
};

const PALAVRAS_GRANULADO = [
  'granulad', 'pellet', 'pelete', 'grão', 'grao', 'graos', 'grãos', 'escama', 'chip',
];

const PALAVRAS_BASTAO = [
  'bastao', 'bastão', 'bastoes', 'bastões', 'refil', 'refis', 'varet', '11mm', '11 mm',
  '7,4', '7.4', 'pistola',
];

// Fala de cola, mas nao disse qual. Precisa escolher no menu.
const PALAVRAS_COLA_GENERICA = [
  'cola', 'colas', 'hot melt', 'hotmelt', 'hot-melt', 'adesivo', 'termoplastic', 'lomba',
];

const PALAVRAS_OUTRO = [
  'outro assunto', 'importacao', 'importação', 'exportacao', 'exportação',
  'financeiro', 'nota fiscal', 'curriculo', 'currículo', 'parceria', 'banheiro', 'vinho',
];

const NUMEROS_POR_EXTENSO = {
  meia: 0.5, meio: 0.5, uma: 1, um: 1, duas: 2, dois: 2, tres: 3, 'três': 3,
  quatro: 4, cinco: 5, dez: 10, vinte: 20, cinquenta: 50, cem: 100,
};

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// "1", "2" e "3" sozinhos sao escolha de menu, nunca quantidade.
// Sem isso, quem responde "1" seria lido como "1 kg" e cairia no link errado.
export function ehRespostaDeMenu(texto) {
  return /^\s*[123]\s*[-.)]?\s*$/.test(normalizar(texto));
}

function contem(t, lista) {
  return lista.some((p) => t.includes(normalizar(p)));
}

/**
 * Devolve: 'granulado' | 'bastao' | 'cola' (nao disse qual) | 'outro' | 'desconhecida'
 */
export function detectarIntencao(texto) {
  const t = normalizar(texto);
  if (!t) return 'desconhecida';

  // Resposta direta do menu
  if (/^\s*1\s*[-.)]?\s*$/.test(t)) return INTERESSES.GRANULADO;
  if (/^\s*2\s*[-.)]?\s*$/.test(t)) return INTERESSES.BASTAO;
  if (/^\s*3\s*[-.)]?\s*$/.test(t)) return INTERESSES.OUTRO;

  const granulado = contem(t, PALAVRAS_GRANULADO);
  const bastao = contem(t, PALAVRAS_BASTAO);

  // Citou os dois: nao da para adivinhar, manda escolher.
  if (granulado && bastao) return 'cola';
  if (granulado) return INTERESSES.GRANULADO;
  if (bastao) return INTERESSES.BASTAO;

  if (contem(t, PALAVRAS_COLA_GENERICA)) return 'cola';
  if (contem(t, PALAVRAS_OUTRO)) return INTERESSES.OUTRO;

  return 'desconhecida';
}

// Extrai quantidade em kg. Entende "50", "50kg", "1 tonelada", "2.000 kg", "2,5 t".
// Devolve null quando nao da para confiar no que veio.
export function extrairQuantidadeKg(texto) {
  const t = normalizar(texto);
  if (!t) return null;

  const porExtenso = t.match(
    /\b(meia|meio|uma|um|duas|dois|tres|quatro|cinco|dez|vinte|cinquenta|cem)\s+(tonelada|toneladas|ton|kg|quilo|quilos)\b/,
  );
  if (porExtenso) {
    const valor = NUMEROS_POR_EXTENSO[porExtenso[1]];
    const ehTonelada = porExtenso[2].startsWith('ton');
    return validar(ehTonelada ? valor * 1000 : valor);
  }

  const comUnidade = t.match(
    /(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(toneladas|tonelada|ton|t|kgs|kg|quilos|quilo|k)?\b/,
  );
  if (!comUnidade) return null;

  let bruto = comUnidade[1];
  if (/^\d{1,3}(\.\d{3})+$/.test(bruto)) bruto = bruto.replace(/\./g, '');
  bruto = bruto.replace(',', '.');

  const valor = Number(bruto);
  if (!Number.isFinite(valor)) return null;

  const unidade = comUnidade[2] || '';
  const ehTonelada = unidade === 't' || unidade.startsWith('ton');

  return validar(ehTonelada ? valor * 1000 : valor);
}

function validar(kg) {
  if (!Number.isFinite(kg) || kg <= 0) return null;
  // Acima disso quase certamente e telefone, CNPJ ou digitacao errada.
  if (kg > 100000) return null;
  return kg;
}

/**
 * Decide o que fazer com a mensagem recebida.
 *
 * @returns {{
 *   resposta: string|null, estado: string, interesse: string|null,
 *   tentativas: number, lead: object|null, entregarAoHumano: boolean, motivo: string
 * }}
 */
export function processar({
  estado,
  tentativas = 0,
  interesse = null,
  texto,
  minimoKg,
  linkBastao11,
  linkBastao74,
}) {
  const nada = {
    resposta: null,
    estado,
    interesse,
    tentativas,
    lead: null,
    entregarAoHumano: false,
    motivo: 'sem_acao',
  };

  if (estado === ESTADOS.ENCERRADO || estado === ESTADOS.IGNORADO) {
    return { ...nada, motivo: `estado_${estado}` };
  }

  const resolverQuantidade = (kg, produto) => {
    if (kg >= minimoKg) {
      return {
        resposta: textos.leadQualificado,
        estado: ESTADOS.ENCERRADO,
        interesse: produto,
        tentativas: 0,
        lead: { interesse: produto, quantidadeKg: kg, desfecho: 'lead' },
        entregarAoHumano: true,
        motivo: 'lead_qualificado',
      };
    }

    // Abaixo do minimo o caminho depende do produto:
    // bastao tem anuncio no Mercado Livre, granulado nao.
    if (produto === INTERESSES.BASTAO) {
      return {
        resposta: montar(textos.bastaoAbaixoDoMinimo, {
          link11: linkBastao11,
          link74: linkBastao74,
        }),
        estado: ESTADOS.ENCERRADO,
        interesse: produto,
        tentativas: 0,
        lead: { interesse: produto, quantidadeKg: kg, desfecho: 'mercado_livre' },
        entregarAoHumano: false,
        motivo: 'bastao_abaixo_do_minimo',
      };
    }

    return {
      resposta: montar(textos.granuladoAbaixoDoMinimo, { minimo: minimoKg }),
      estado: ESTADOS.ENCERRADO,
      interesse: produto,
      tentativas: 0,
      lead: { interesse: produto, quantidadeKg: kg, desfecho: 'granulado_abaixo_minimo' },
      entregarAoHumano: true,
      motivo: 'granulado_abaixo_do_minimo',
    };
  };

  const pedirQuantidade = (produto, motivo, comSaudacao = false) => ({
    resposta: comSaudacao
      ? `${textos.saudacao.split('\n')[0]}\n\n${textos.perguntaQuantidade}`
      : textos.perguntaQuantidade,
    estado: ESTADOS.AGUARDANDO_QTD,
    interesse: produto,
    tentativas: 0,
    lead: null,
    entregarAoHumano: false,
    motivo,
  });

  const mandarMenu = (motivo) => ({
    resposta: textos.saudacao,
    estado: ESTADOS.AGUARDANDO_MENU,
    interesse: null,
    tentativas: 0,
    lead: null,
    entregarAoHumano: false,
    motivo,
  });

  const ehProduto = (i) => i === INTERESSES.GRANULADO || i === INTERESSES.BASTAO;

  // --- primeiro contato -----------------------------------------
  if (estado === ESTADOS.NOVO) {
    const intencao = detectarIntencao(texto);

    if (ehProduto(intencao)) {
      const kg = ehRespostaDeMenu(texto) ? null : extrairQuantidadeKg(texto);
      if (kg !== null) return resolverQuantidade(kg, intencao);
      return pedirQuantidade(intencao, `${intencao}_detectado_no_primeiro_contato`, true);
    }

    // Falou de cola mas nao disse qual, ou nao deu para entender: menu.
    return mandarMenu('saudacao_com_menu');
  }

  // --- esperando a escolha do menu ------------------------------
  if (estado === ESTADOS.AGUARDANDO_MENU) {
    const intencao = detectarIntencao(texto);

    if (ehProduto(intencao)) {
      const kg = ehRespostaDeMenu(texto) ? null : extrairQuantidadeKg(texto);
      if (kg !== null) return resolverQuantidade(kg, intencao);
      return pedirQuantidade(intencao, `escolheu_${intencao}`);
    }

    if (intencao === INTERESSES.OUTRO) {
      return {
        resposta: textos.outroAssunto,
        estado: ESTADOS.ENCERRADO,
        interesse: INTERESSES.OUTRO,
        tentativas: 0,
        lead: { interesse: INTERESSES.OUTRO, quantidadeKg: null, desfecho: 'outro_assunto' },
        entregarAoHumano: true,
        motivo: 'outro_assunto',
      };
    }

    // 'cola' generica tambem cai aqui: precisa escolher 1 ou 2.
    const novasTentativas = tentativas + 1;
    if (novasTentativas >= 2) {
      return {
        resposta: textos.desistoVaiProHumano,
        estado: ESTADOS.ENCERRADO,
        interesse: null,
        tentativas: novasTentativas,
        lead: { interesse: null, quantidadeKg: null, desfecho: 'humano' },
        entregarAoHumano: true,
        motivo: 'nao_entendi_menu_2x',
      };
    }

    return {
      resposta: textos.naoEntendiMenu,
      estado: ESTADOS.AGUARDANDO_MENU,
      interesse: null,
      tentativas: novasTentativas,
      lead: null,
      entregarAoHumano: false,
      motivo: 'nao_entendi_menu',
    };
  }

  // --- esperando a quantidade -----------------------------------
  if (estado === ESTADOS.AGUARDANDO_QTD) {
    const produto = ehProduto(interesse) ? interesse : INTERESSES.GRANULADO;
    const kg = extrairQuantidadeKg(texto);
    if (kg !== null) return resolverQuantidade(kg, produto);

    const novasTentativas = tentativas + 1;
    if (novasTentativas >= 2) {
      return {
        resposta: textos.desistoVaiProHumano,
        estado: ESTADOS.ENCERRADO,
        interesse: produto,
        tentativas: novasTentativas,
        lead: { interesse: produto, quantidadeKg: null, desfecho: 'humano' },
        entregarAoHumano: true,
        motivo: 'nao_entendi_quantidade_2x',
      };
    }

    return {
      resposta: textos.naoEntendiQuantidade,
      estado: ESTADOS.AGUARDANDO_QTD,
      interesse: produto,
      tentativas: novasTentativas,
      lead: null,
      entregarAoHumano: false,
      motivo: 'nao_entendi_quantidade',
    };
  }

  return nada;
}
